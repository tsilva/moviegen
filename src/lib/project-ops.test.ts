import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildProjectSnapshot,
  createEmptyManifest,
  createId,
  nowIso,
  reconcileTransitions,
  reorderFrames,
} from "./project-ops";
import { deleteFrameFromProject, deleteTransitionFromProject } from "./delete-ops";

function frame(title: string) {
  const timestamp = nowIso();
  return {
    id: createId("frame"),
    position: 0,
    title,
    imagePrompt: `${title} prompt`,
    referenceImages: [],
    notes: "",
    approvedVersionId: null,
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("project transition reconciliation", () => {
  test("creates active adjacency transitions in frame order", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);

    expect(manifest.transitions).toHaveLength(2);
    expect(manifest.transitions.map((transition) => [transition.fromFrameId, transition.toFrameId])).toEqual([
      [first.id, second.id],
      [second.id, third.id],
    ]);
  });

  test("archives invalidated transition and creates new pair after reorder", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);

    reorderFrames(manifest, [first.id, third.id, second.id]);
    reconcileTransitions(manifest);

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions.map((transition) => [transition.fromFrame.title, transition.toFrame.title])).toEqual([
      ["A", "C"],
      ["C", "B"],
    ]);
    expect(
      manifest.transitions.filter((transition) => transition.sequenceScope === "archived").length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("deleting a frame archives frame and touching transition assets, then removes JSON entries", async () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-delete-frame-"));
    await fs.mkdir(path.join(tempDir, "frames", second.id), { recursive: true });
    await fs.mkdir(path.join(tempDir, "transitions", manifest.transitions[0]!.id), { recursive: true });
    await fs.mkdir(path.join(tempDir, "transitions", manifest.transitions[1]!.id), { recursive: true });
    await fs.writeFile(path.join(tempDir, "frames", second.id, "candidate.svg"), "<svg />");

    await deleteFrameFromProject(manifest, tempDir, second.id);

    expect(manifest.frames.map((item) => item.id)).toEqual([first.id, third.id]);
    expect(manifest.transitions.filter((transition) => transition.sequenceScope === "active")).toHaveLength(1);
    expect(manifest.transitions[0]?.fromFrameId).toBe(first.id);
    expect(manifest.transitions[0]?.toFrameId).toBe(third.id);

    const deletedFrameEntries = await fs.readdir(path.join(tempDir, "deleted", "frames"));
    const deletedTransitionEntries = await fs.readdir(path.join(tempDir, "deleted", "transitions"));
    expect(deletedFrameEntries.some((entry) => entry.startsWith(second.id))).toBe(true);
    expect(deletedTransitionEntries).toHaveLength(2);
  });

  test("deleting a transition archives its assets and creates a fresh blank transition for the same adjacency", async () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);
    const [transition] = manifest.transitions;
    if (!transition) {
      throw new Error("Transition not created");
    }
    transition.transitionPrompt = "Old transition prompt";

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-delete-transition-"));
    await fs.mkdir(path.join(tempDir, "transitions", transition.id), { recursive: true });
    await fs.writeFile(path.join(tempDir, "transitions", transition.id, "clip.svg"), "<svg />");

    await deleteTransitionFromProject(manifest, tempDir, transition.id);

    expect(manifest.transitions).toHaveLength(1);
    expect(manifest.transitions[0]?.id).not.toBe(transition.id);
    expect(manifest.transitions[0]?.transitionPrompt).toBe("");
    const deletedTransitionEntries = await fs.readdir(path.join(tempDir, "deleted", "transitions"));
    expect(deletedTransitionEntries.some((entry) => entry.startsWith(transition.id))).toBe(true);
  });
});
