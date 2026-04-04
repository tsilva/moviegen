import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const { enqueueFrameGenerationMock, enqueueProjectStartupGenerationMock } = vi.hoisted(() => ({
  enqueueFrameGenerationMock: vi.fn(),
  enqueueProjectStartupGenerationMock: vi.fn(),
}));

vi.mock("@/lib/job-runner", () => ({
  enqueueFrameGeneration: enqueueFrameGenerationMock,
  enqueueProjectStartupGeneration: enqueueProjectStartupGenerationMock,
}));

import { POST } from "./route";
import { createEmptyManifest, createId, nowIso } from "@/lib/project-ops";
import { readProjectSnapshot, saveManifest, setCurrentProjectPath } from "@/lib/project-store";
import type { Frame, ProjectManifest } from "@/lib/types";

function createFrame(name: string, position: number, overrides: Partial<Frame> = {}): Frame {
  const timestamp = nowIso();
  const generationOverrides = overrides.generationOverrides ?? {};
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
    ...overrides,
    generationOverrides,
  };
}

async function seedProject(projectPath: string, manifestFactory: () => ProjectManifest) {
  const manifest = manifestFactory();
  await saveManifest(projectPath, manifest);
  setCurrentProjectPath(projectPath);
  return manifest;
}

describe("POST /api/frames/bulk-create", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).__moviegenRuntimeState__;
    delete (globalThis as Record<string, unknown>).__moviegenJobRunnerState__;
    enqueueFrameGenerationMock.mockReset();
    enqueueProjectStartupGenerationMock.mockReset();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  });

  test("creates storyboard frames and auto-starts generation when the chain can begin immediately", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-bulk-create-"));
    tempDirs.push(projectPath);

    await seedProject(projectPath, () => createEmptyManifest("moviegen"));
    enqueueProjectStartupGenerationMock.mockImplementation(async () => readProjectSnapshot(projectPath));

    await POST(
      new Request("http://localhost/api/frames/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: [{ imagePrompt: "First shot" }, { imagePrompt: "Second shot" }],
        }),
      }),
    );

    const snapshot = await readProjectSnapshot(projectPath);
    expect(snapshot.frames).toHaveLength(2);
    expect(snapshot.manifest.jobs).toHaveLength(0);
    expect(snapshot.frames.map((frame) => frame.nextAction)).toEqual(["generate", null]);
    expect(enqueueProjectStartupGenerationMock).toHaveBeenCalledWith({
      frameIds: snapshot.frames.map((frame) => frame.id),
      transitionIds: snapshot.transitions.map((transition) => transition.id),
      frameOptions: {
        candidateCount: 1,
        size: "1280x720",
        seedMode: "random",
      },
      transitionOptions: {
        duration: 4,
        size: "1280x720",
        fps: 24,
      },
    });
    expect(enqueueFrameGenerationMock).not.toHaveBeenCalled();
  });

  test("keeps anchored storyboard frames unqueued when inserted after an existing frame", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-bulk-create-"));
    tempDirs.push(projectPath);

    await seedProject(projectPath, () => {
      const manifest = createEmptyManifest("moviegen");
      manifest.frames = [createFrame("Existing", 0)];
      return manifest;
    });

    await POST(
      new Request("http://localhost/api/frames/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: [{ imagePrompt: "Blocked follow-up", usePreviousFrameAsReference: true }],
        }),
      }),
    );

    const snapshot = await readProjectSnapshot(projectPath);
    expect(snapshot.manifest.jobs).toHaveLength(0);
    expect(snapshot.frames[1]?.status).toBe("blocked_upstream");
    expect(enqueueFrameGenerationMock).not.toHaveBeenCalled();
  });

  test("preserves blank placeholder frames for later generation", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-bulk-create-"));
    tempDirs.push(projectPath);

    await seedProject(projectPath, () => createEmptyManifest("moviegen"));

    await POST(
      new Request("http://localhost/api/frames/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: [{ imagePrompt: "" }],
        }),
      }),
    );

    const snapshot = await readProjectSnapshot(projectPath);

    expect(snapshot.manifest.jobs).toHaveLength(0);
    expect(snapshot.frames[0]?.imagePrompt).toBe("");
    expect(snapshot.frames[0]?.nextAction).toBe("write_prompt");
    expect(enqueueFrameGenerationMock).not.toHaveBeenCalled();
  });

  test("inserts newly created frames at the requested index", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-bulk-create-"));
    tempDirs.push(projectPath);

    await seedProject(projectPath, () => {
      const manifest = createEmptyManifest("moviegen");
      manifest.frames = [createFrame("First", 0), createFrame("Second", 1)];
      return manifest;
    });

    await POST(
      new Request("http://localhost/api/frames/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insertAtIndex: 1,
          rows: [{ imagePrompt: "Inserted shot", usePreviousFrameAsReference: false }],
        }),
      }),
    );

    const snapshot = await readProjectSnapshot(projectPath);

    expect(snapshot.frames.map((frame) => frame.imagePrompt)).toEqual([
      "First prompt",
      "Inserted shot",
      "Second prompt",
    ]);
    expect(snapshot.frames.map((frame) => frame.position)).toEqual([0, 1, 2]);
    expect(enqueueFrameGenerationMock).toHaveBeenCalledWith(
      [snapshot.frames[1]!.id],
      {
        candidateCount: 1,
        size: "1280x720",
        seedMode: "random",
      },
    );
  });
});
