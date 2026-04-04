import { describe, expect, test } from "vitest";
import { createEmptyManifest, createId, nowIso } from "./project-ops";
import { projectManifestSchema } from "./project-schema";

describe("project schema", () => {
  test("defaults usePreviousFrameAsReference to true for older manifests", () => {
    const manifest = createEmptyManifest("legacy-project");
    const timestamp = nowIso();

    const parsed = projectManifestSchema.parse({
      ...manifest,
      frames: [
        {
          id: createId("frame"),
          position: 0,
          imagePrompt: "A windswept lighthouse at dusk",
          referenceImages: [],
          approvedVersionId: null,
          versions: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    expect(parsed.frames[0]?.usePreviousFrameAsReference).toBe(true);
    expect(parsed.frames[0]).not.toHaveProperty("title");
    expect(parsed.frames[0]).not.toHaveProperty("notes");
  });

  test("maps legacy UI filters onto needsRepair", () => {
    const manifest = createEmptyManifest("legacy-project");

    const parsed = projectManifestSchema.parse({
      ...manifest,
      ui: {
        ...manifest.ui,
        filter: "needsAttention",
      },
    });

    expect(parsed.ui.filter).toBe("needsRepair");
  });

  test("preserves play mode and maps legacy table mode back to sequence", () => {
    const manifest = createEmptyManifest("legacy-project");

    const playParsed = projectManifestSchema.parse({
      ...manifest,
      ui: {
        ...manifest.ui,
        viewMode: "play",
      },
    });

    const legacyParsed = projectManifestSchema.parse({
      ...manifest,
      ui: {
        ...manifest.ui,
        viewMode: "table",
      },
    });

    expect(playParsed.ui.viewMode).toBe("play");
    expect(legacyParsed.ui.viewMode).toBe("sequence");
  });

  test("accepts persisted selected slot state", () => {
    const manifest = createEmptyManifest("slot-project");

    const parsed = projectManifestSchema.parse({
      ...manifest,
      ui: {
        ...manifest.ui,
        selectedSlot: {
          trackId: "transition_1",
          slotKind: "transition",
        },
      },
    });

    expect(parsed.ui.selectedSlot).toEqual({
      trackId: "transition_1",
      slotKind: "transition",
    });
  });

  test("tolerates legacy selection fields while defaulting selectedSlot", () => {
    const manifest = createEmptyManifest("legacy-selection-project");

    const parsed = projectManifestSchema.parse({
      ...manifest,
      ui: {
        ...manifest.ui,
        selectedFrameId: "frame_1",
        selectedTransitionId: null,
      },
    });

    expect(parsed.ui.selectedSlot).toBeNull();
  });
});
