import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEmptyManifest, createId, nowIso } from "./project-ops";
import {
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
});
