import { describe, expect, test } from "vitest";
import { sanitizeGenerationSettings } from "./generation-config";
import {
  MODEL_REGISTRY,
  PRO_FRAME_MODEL_ID,
  getModelDefaultSettings,
  getModelDefinition,
} from "./generation-models";

describe("generation model settings", () => {
  test("wan pro image edit exposes editable resolution settings", () => {
    expect(getModelDefinition(PRO_FRAME_MODEL_ID)?.settings).toEqual([
      expect.objectContaining({
        key: "resolution",
        defaultValue: "720p",
      }),
    ]);

    expect(getModelDefaultSettings(PRO_FRAME_MODEL_ID)).toEqual({
      resolution: "720p",
    });

    expect(
      sanitizeGenerationSettings(PRO_FRAME_MODEL_ID, {
        resolution: "1080p",
      }),
    ).toEqual({
      resolution: "1080p",
    });
  });

  test("every registered model has valid editable settings metadata", () => {
    for (const [modelId, definition] of Object.entries(MODEL_REGISTRY)) {
      const defaults = getModelDefaultSettings(modelId);

      expect(sanitizeGenerationSettings(modelId, defaults)).toEqual(defaults);

      for (const setting of definition.settings) {
        expect(defaults).toHaveProperty(setting.key, setting.defaultValue);

        if (setting.kind === "select") {
          expect(setting.options?.some((option) => option.value === setting.defaultValue)).toBe(true);
        }
      }
    }
  });
});
