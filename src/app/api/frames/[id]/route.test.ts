import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { PATCH } from "./route";
import { createEmptyManifest, createId, nowIso } from "@/lib/project-ops";
import { readProjectSnapshot, saveManifest, setCurrentProjectPath } from "@/lib/project-store";
import type { Frame } from "@/lib/types";

function createFrame(position: number): Frame {
  const timestamp = nowIso();

  return {
    id: "frame_123",
    position,
    imagePrompt: "Original frame prompt",
    referenceImages: ["frames/references/original.png"],
    usePreviousFrameAsReference: position > 0,
    approvedVersionId: null,
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("PATCH /api/frames/[id]", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).__moviegenRuntimeState__;
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  });

  test("updates dropped reference images on a frame", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-frame-route-"));
    tempDirs.push(projectPath);

    const manifest = createEmptyManifest("moviegen");
    manifest.project.id = createId("project");
    manifest.frames = [createFrame(1)];
    await saveManifest(projectPath, manifest);
    setCurrentProjectPath(projectPath);

    const response = await PATCH(
      new Request("http://localhost/api/frames/frame_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceImages: [
            "frames/references/original.png",
            "frames/references/dropped-a.png",
            "frames/references/dropped-b.png",
          ],
          usePreviousFrameAsReference: false,
        }),
      }),
      { params: Promise.resolve({ id: "frame_123" }) },
    );

    expect(response.status).toBe(200);

    const snapshot = await readProjectSnapshot(projectPath);
    expect(snapshot.frames[0]?.referenceImages).toEqual([
      "frames/references/original.png",
      "frames/references/dropped-a.png",
      "frames/references/dropped-b.png",
    ]);
    expect(snapshot.frames[0]?.usePreviousFrameAsReference).toBe(false);
  });
});
