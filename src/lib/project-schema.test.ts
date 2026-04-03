import { describe, expect, test } from "vitest";
import { createEmptyManifest, createId, nowIso } from "./project-ops";
import { projectManifestSchema } from "./project-schema";

describe("project schema", () => {
  test("defaults usePreviousFrameAsReference to false for older manifests", () => {
    const manifest = createEmptyManifest("legacy-project");
    const timestamp = nowIso();

    const parsed = projectManifestSchema.parse({
      ...manifest,
      frames: [
        {
          id: createId("frame"),
          position: 0,
          title: "Legacy frame",
          imagePrompt: "A windswept lighthouse at dusk",
          referenceImages: [],
          notes: "",
          approvedVersionId: null,
          versions: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    expect(parsed.frames[0]?.usePreviousFrameAsReference).toBe(false);
  });
});
