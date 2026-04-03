import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const { enqueueFrameGenerationMock } = vi.hoisted(() => ({
  enqueueFrameGenerationMock: vi.fn(),
}));

vi.mock("@/lib/job-runner", () => ({
  enqueueFrameGeneration: enqueueFrameGenerationMock,
}));

import { POST } from "./route";
import { createEmptyManifest, createId, nowIso } from "@/lib/project-ops";
import { readProjectSnapshot, saveManifest, setCurrentProjectPath } from "@/lib/project-store";
import type { Frame, ProjectManifest } from "@/lib/types";

function createFrame(name: string, position: number, overrides: Partial<Frame> = {}): Frame {
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
    ...overrides,
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
    enqueueFrameGenerationMock.mockReset();
    delete (globalThis as Record<string, unknown>).__moviegenRuntimeState__;
    delete (globalThis as Record<string, unknown>).__moviegenJobRunnerState__;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  });

  test("queues newly created frames that are immediately actionable", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-bulk-create-"));
    tempDirs.push(projectPath);

    await seedProject(projectPath, () => createEmptyManifest("moviegen"));
    enqueueFrameGenerationMock.mockImplementation(async () => readProjectSnapshot(projectPath));

    await POST(
      new Request("http://localhost/api/frames/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: [{ imagePrompt: "First shot" }, { imagePrompt: "Second shot" }],
        }),
      }),
    );

    expect(enqueueFrameGenerationMock).toHaveBeenCalledTimes(1);
    expect(enqueueFrameGenerationMock.mock.calls[0]?.[0]).toHaveLength(1);
  });

  test("does not queue blocked newly created frames", async () => {
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

    expect(enqueueFrameGenerationMock).not.toHaveBeenCalled();
  });
});
