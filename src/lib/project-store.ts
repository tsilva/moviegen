import fs from "node:fs/promises";
import path from "node:path";
import { projectManifestSchema } from "@/lib/project-schema";
import {
  MANIFEST_FILENAME,
  buildProjectSnapshot,
  createEmptyManifest,
  deepClone,
  nowIso,
} from "@/lib/project-ops";
import type { ProjectManifest, ProjectSnapshot } from "@/lib/types";

type RuntimeState = {
  currentProjectPath: string | null;
  undoStacks: Map<string, ProjectManifest[]>;
  projectLocks: Map<string, Promise<void>>;
};

const PROJECT_CONTENT_DIRECTORIES = ["frames", "transitions", path.join("deleted")] as const;
const WORKSPACE_ROOT = path.resolve(process.cwd());

declare global {
  var __moviegenRuntimeState__: RuntimeState | undefined;
}

const SENSITIVE_URL_QUERY_PARAMS = new Set([
  "OSSAccessKeyId",
  "Signature",
  "X-Tos-Algorithm",
  "X-Tos-Credential",
  "X-Tos-Date",
  "X-Tos-Expires",
  "X-Tos-Signature",
  "X-Tos-SignedHeaders",
]);

function getRuntimeState(): RuntimeState {
  if (!global.__moviegenRuntimeState__) {
    global.__moviegenRuntimeState__ = {
      currentProjectPath: null,
      undoStacks: new Map(),
      projectLocks: new Map(),
    };
  }

  return global.__moviegenRuntimeState__;
}

function isPathInsideWorkspace(projectPath: string) {
  const relativePath = path.relative(WORKSPACE_ROOT, projectPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveProjectPath(projectPathInput: string) {
  const trimmedProjectPath = projectPathInput.trim();
  if (!trimmedProjectPath) {
    throw new Error("Project path is required");
  }

  if (!path.isAbsolute(trimmedProjectPath)) {
    throw new Error("Project path must be an absolute path");
  }

  const projectPath = path.resolve(trimmedProjectPath);
  if (isPathInsideWorkspace(projectPath)) {
    throw new Error("Project path must be outside the Moviegen app workspace");
  }

  return projectPath;
}

export function setCurrentProjectPath(projectPath: string | null | undefined) {
  getRuntimeState().currentProjectPath = projectPath?.trim() ? resolveProjectPath(projectPath) : null;
}

export function getCurrentProjectPath() {
  return getRuntimeState().currentProjectPath;
}

export function getManifestPath(projectPath: string) {
  return path.join(resolveProjectPath(projectPath), MANIFEST_FILENAME);
}

async function ensureProjectDirectories(projectPath: string) {
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, "frames"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "transitions"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "deleted", "frames"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "deleted", "transitions"), { recursive: true });
}

export async function loadManifest(projectPath: string) {
  const manifestPath = getManifestPath(projectPath);
  const contents = await fs.readFile(manifestPath, "utf8");
  return projectManifestSchema.parse(JSON.parse(contents));
}

function sanitizePersistedUrl(value: string) {
  if (!/^https?:\/\//i.test(value) || !value.includes("?")) {
    return value;
  }

  try {
    const url = new URL(value);
    let changed = false;

    for (const key of [...url.searchParams.keys()]) {
      if (!SENSITIVE_URL_QUERY_PARAMS.has(key)) {
        continue;
      }

      url.searchParams.delete(key);
      changed = true;
    }

    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

function sanitizeManifestForPersistence<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizePersistedUrl(value) as T;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = sanitizeManifestForPersistence(value[index]);
    }
    return value;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      (value as Record<string, unknown>)[key] = sanitizeManifestForPersistence(nested);
    }
  }

  return value;
}

export async function saveManifest(projectPath: string, manifest: ProjectManifest) {
  const manifestPath = getManifestPath(projectPath);
  const tempPath = `${manifestPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  manifest.project.updatedAt = nowIso();
  manifest.ui = {
    themeMode: manifest.ui.themeMode,
    viewMode: manifest.ui.viewMode,
    selectedSlot: manifest.ui.selectedSlot,
    filter: manifest.ui.filter,
  };
  sanitizeManifestForPersistence(manifest);
  await fs.writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, manifestPath);
}

async function withProjectLock<T>(projectPath: string, task: () => Promise<T> | T) {
  const runtimeState = getRuntimeState();
  const previous = runtimeState.projectLocks.get(projectPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => {}).then(() => current);
  runtimeState.projectLocks.set(projectPath, chain);

  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    release();
    if (runtimeState.projectLocks.get(projectPath) === chain) {
      runtimeState.projectLocks.delete(projectPath);
    }
  }
}

export async function openProject(projectPathInput: string, createIfMissing = true): Promise<ProjectSnapshot> {
  const projectPath = resolveProjectPath(projectPathInput);
  await ensureProjectDirectories(projectPath);
  const manifest = await withProjectLock(projectPath, async () => {
    try {
      return await loadManifest(projectPath);
    } catch (error) {
      if (!createIfMissing) {
        throw error;
      }

      const nextManifest = createEmptyManifest(path.basename(projectPath));
      await saveManifest(projectPath, nextManifest);
      return nextManifest;
    }
  });

  setCurrentProjectPath(projectPath);
  return buildProjectSnapshot(manifest, projectPath);
}

export async function clearProject(projectPathInput: string) {
  const projectPath = resolveProjectPath(projectPathInput);

  const manifest = await withProjectLock(projectPath, async () => {
    const existingManifest = await loadManifest(projectPath).catch(() => createEmptyManifest(path.basename(projectPath)));

    await Promise.all(
      PROJECT_CONTENT_DIRECTORIES.map((directory) =>
        fs.rm(path.join(projectPath, directory), { recursive: true, force: true }),
      ),
    );

    await ensureProjectDirectories(projectPath);
    const nextManifest: ProjectManifest = {
      ...existingManifest,
      frames: [],
      transitions: [],
      jobs: [],
      ui: {
        ...existingManifest.ui,
        selectedSlot: null,
      },
    };
    await saveManifest(projectPath, nextManifest);
    getRuntimeState().undoStacks.delete(projectPath);
    return nextManifest;
  });

  setCurrentProjectPath(projectPath);
  return buildProjectSnapshot(manifest, projectPath);
}

export async function readCurrentProjectSnapshot() {
  const projectPath = getCurrentProjectPath();
  if (!projectPath) {
    throw new Error("No project is currently open");
  }

  return readProjectSnapshot(projectPath);
}

export async function readProjectSnapshot(projectPathInput: string) {
  const projectPath = resolveProjectPath(projectPathInput);
  const manifest = await loadManifest(projectPath);
  return buildProjectSnapshot(manifest, projectPath);
}

export async function mutateProject<T>(
  projectPathInput: string,
  mutator: (manifest: ProjectManifest, projectPath: string) => Promise<T> | T,
) {
  const projectPath = resolveProjectPath(projectPathInput);
  return withProjectLock(projectPath, async () => {
    const manifest = await loadManifest(projectPath);
    const before = deepClone(manifest);
    const undoStack = getRuntimeState().undoStacks.get(projectPath) ?? [];
    undoStack.push(before);
    getRuntimeState().undoStacks.set(projectPath, undoStack);

    const result = await mutator(manifest, projectPath);
    await saveManifest(projectPath, manifest);
    return {
      result,
      snapshot: buildProjectSnapshot(manifest, projectPath),
      previous: before,
      projectPath,
    };
  });
}

export async function mutateCurrentProject<T>(
  mutator: (manifest: ProjectManifest, projectPath: string) => Promise<T> | T,
) {
  const projectPath = getCurrentProjectPath();
  if (!projectPath) {
    throw new Error("No project is currently open");
  }

  return mutateProject(projectPath, mutator);
}

export async function undoCurrentProject() {
  const projectPath = getCurrentProjectPath();
  if (!projectPath) {
    throw new Error("No project is currently open");
  }

  return withProjectLock(projectPath, async () => {
    const undoStack = getRuntimeState().undoStacks.get(projectPath) ?? [];
    const previous = undoStack.pop();
    if (!previous) {
      throw new Error("Nothing to undo");
    }

    getRuntimeState().undoStacks.set(projectPath, undoStack);
    await saveManifest(projectPath, previous);
    return buildProjectSnapshot(previous, projectPath);
  });
}

export async function archiveProjectSubtree(
  projectPath: string,
  sourceRelativePath: string,
  bucket: "frames" | "transitions",
) {
  const sourcePath = path.resolve(projectPath, sourceRelativePath);

  try {
    await fs.access(sourcePath);
  } catch {
    return null;
  }

  if (!sourcePath.startsWith(projectPath)) {
    throw new Error("Invalid archive source path");
  }

  const leafName = path.basename(sourcePath);
  const timestamp = nowIso().replaceAll(":", "-");
  let destinationPath = path.join(projectPath, "deleted", bucket, `${leafName}__${timestamp}`);
  let counter = 1;

  while (true) {
    try {
      await fs.access(destinationPath);
      destinationPath = path.join(
        projectPath,
        "deleted",
        bucket,
        `${leafName}__${timestamp}_${counter}`,
      );
      counter += 1;
    } catch {
      break;
    }
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.rename(sourcePath, destinationPath);
  return destinationPath;
}
