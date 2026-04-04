import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { POST } from "./route";
import { createEmptyManifest, createId, nowIso } from "@/lib/project-ops";
import { readProjectSnapshot, saveManifest, setCurrentProjectPath } from "@/lib/project-store";
import type { Frame, ProjectManifest } from "@/lib/types";

function createFrame(name: string, position: number): Frame {
  const timestamp = nowIso();
  return {
    id: createId("frame"),
    position,
    imagePrompt: `${name} prompt`,
    referenceImages: [],
    usePreviousFrameAsReference: position > 0,
    approvedVersionId: null,
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function seedProject(projectPath: string, manifestFactory: () => ProjectManifest) {
  const manifest = manifestFactory();
  await saveManifest(projectPath, manifest);
  setCurrentProjectPath(projectPath);
  return manifest;
}

describe("POST /api/tracks", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).__moviegenRuntimeState__;
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  });

  test("creates the first track as two frames with one derived transition", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-tracks-route-"));
    tempDirs.push(projectPath);

    await seedProject(projectPath, () => createEmptyManifest("moviegen"));

    const response = await POST(
      new Request("http://localhost/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insertAtTrackIndex: 0 }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.frames).toHaveLength(2);
    expect(data.transitions).toHaveLength(1);
    expect(data.tracks).toHaveLength(1);
  });

  test("inserts one shared-boundary frame when adding a track into an existing sequence", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-tracks-route-"));
    tempDirs.push(projectPath);

    await seedProject(projectPath, () => {
      const manifest = createEmptyManifest("moviegen");
      manifest.frames = [createFrame("A", 0), createFrame("B", 1), createFrame("C", 2)];
      return manifest;
    });

    await POST(
      new Request("http://localhost/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insertAtTrackIndex: 1 }),
      }),
    );

    const snapshot = await readProjectSnapshot(projectPath);

    expect(snapshot.frames).toHaveLength(4);
    expect(snapshot.transitions).toHaveLength(3);
    expect(snapshot.tracks).toHaveLength(3);
    expect(snapshot.frames.map((frame) => frame.position)).toEqual([0, 1, 2, 3]);
    expect(snapshot.frames[2]?.imagePrompt).toBe("");
  });
});
