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
});
