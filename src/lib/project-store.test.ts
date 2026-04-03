import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEmptyManifest, createId, nowIso } from "./project-ops";
import {
  clearProject,
  openProject,
  readProjectSnapshot,
  saveManifest,
  setCurrentProjectPath,
  mutateProject,
} from "./project-store";
import type { Frame, GenerationJob } from "./types";

function createFrame(name: string, position: number): Frame {
  const timestamp = nowIso();
  return {
    id: createId("frame"),
    position,
    imagePrompt: `${name} prompt`,
    referenceImages: [],
    usePreviousFrameAsReference: false,
    approvedVersionId: null,
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createJob(
  targetParentId: string,
  status: GenerationJob["status"],
  overrides: Partial<GenerationJob> = {},
): GenerationJob {
  const timestamp = nowIso();
  return {
    id: createId("job"),
    kind: "frame_image",
    targetId: createId("framecand"),
    targetParentId,
    provider: "atlas",
    model: "test-model",
    status,
    requestPayload: {},
    providerPredictionId: null,
    errorMessage: null,
    startedAt: status === "running" ? timestamp : null,
    completedAt: status === "completed" || status === "error" ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("project store concurrency", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    delete (globalThis as Record<string, unknown>).__moviegenRuntimeState__;
  });

  test("concurrent manifest saves use independent temp files", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-project-store-"));
    tempDirs.push(projectPath);

    const manifest = createEmptyManifest("moviegen");
    await Promise.all([
      saveManifest(projectPath, structuredClone(manifest)),
      saveManifest(projectPath, structuredClone(manifest)),
      saveManifest(projectPath, structuredClone(manifest)),
    ]);

    await expect(openProject(projectPath, false)).resolves.toMatchObject({
      projectPath,
      manifest: expect.objectContaining({
        project: expect.objectContaining({ name: "moviegen" }),
      }),
    });
  });

  test("concurrent project mutations are serialized per project", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-project-store-"));
    tempDirs.push(projectPath);

    const manifest = createEmptyManifest("moviegen");
    await saveManifest(projectPath, manifest);
    setCurrentProjectPath(projectPath);

    await Promise.all([
      mutateProject(projectPath, async (draft) => {
        draft.frames.push(createFrame("First", draft.frames.length));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }),
      mutateProject(projectPath, (draft) => {
        draft.frames.push(createFrame("Second", draft.frames.length));
      }),
    ]);

    const snapshot = await readProjectSnapshot(projectPath);
    expect(snapshot.manifest.frames).toHaveLength(2);
    expect(snapshot.manifest.frames.map((frame) => frame.position)).toEqual([0, 1]);
  });

  test("opening a project discards persisted queued and running jobs", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-project-store-"));
    tempDirs.push(projectPath);

    const manifest = createEmptyManifest("moviegen");
    const activeFrame = createFrame("First", 0);
    const terminalFrame = createFrame("Second", 1);
    manifest.frames.push(activeFrame, terminalFrame);
    manifest.jobs.push(
      createJob(activeFrame.id, "queued"),
      createJob(activeFrame.id, "running"),
      createJob(terminalFrame.id, "completed"),
      createJob(terminalFrame.id, "error"),
    );
    await saveManifest(projectPath, manifest);

    const snapshot = await openProject(projectPath, false);

    expect(snapshot.manifest.jobs.map((job) => job.status)).toEqual(["completed", "error"]);
    expect(snapshot.frames[0]?.status).toBe("draft");
    expect(snapshot.frames[1]?.status).toBe("error");

    const reloadedSnapshot = await readProjectSnapshot(projectPath);
    expect(reloadedSnapshot.manifest.jobs.map((job) => job.status)).toEqual(["completed", "error"]);
  });

  test("clearing a project removes Moviegen-managed assets and recreates an empty manifest", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-project-store-"));
    tempDirs.push(projectPath);

    const manifest = createEmptyManifest("moviegen");
    manifest.frames = [createFrame("Opening shot", 0)];
    manifest.jobs.push(createJob(manifest.frames[0]!.id, "completed"));
    await saveManifest(projectPath, manifest);
    await fs.mkdir(path.join(projectPath, "frames", "frame_a"), { recursive: true });
    await fs.writeFile(path.join(projectPath, "frames", "frame_a", "image.png"), "frame");
    await fs.mkdir(path.join(projectPath, "transitions", "transition_a"), { recursive: true });
    await fs.writeFile(path.join(projectPath, "transitions", "transition_a", "clip.mp4"), "transition");
    await fs.mkdir(path.join(projectPath, "deleted", "frames", "old_frame"), { recursive: true });
    await fs.writeFile(path.join(projectPath, "deleted", "frames", "old_frame", "image.png"), "deleted");
    await fs.writeFile(path.join(projectPath, "notes.txt"), "keep me");

    const snapshot = await clearProject(projectPath);

    expect(snapshot.projectPath).toBe(projectPath);
    expect(snapshot.manifest.project.name).toBe(path.basename(projectPath));
    expect(snapshot.manifest.frames).toEqual([]);
    expect(snapshot.manifest.transitions).toEqual([]);
    expect(snapshot.manifest.jobs).toEqual([]);
    await expect(fs.access(path.join(projectPath, "moviegen.project.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(projectPath, "frames"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(projectPath, "transitions"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(projectPath, "deleted"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(projectPath, "notes.txt"))).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(projectPath, "notes.txt"), "utf8")).toBe("keep me");
  });
});
