import { describe, expect, test } from "vitest";
import { sanitizeGenerationSettings } from "./generation-config";
import {
  DEFAULT_FRAME_MODEL_ID,
  MODEL_REGISTRY,
  PRO_FRAME_MODEL_ID,
  QWEN_FRAME_MODEL_ID,
  getAtlasFrameRequestModel,
  getDefaultModelIdForAssetKind,
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

  test("qwen image edit exposes editable resolution settings", () => {
    expect(getModelDefinition(QWEN_FRAME_MODEL_ID)?.settings).toEqual([
      expect.objectContaining({
        key: "resolution",
        defaultValue: "720p",
      }),
    ]);

    expect(getModelDefaultSettings(QWEN_FRAME_MODEL_ID)).toEqual({
      resolution: "720p",
    });

    expect(
      sanitizeGenerationSettings(QWEN_FRAME_MODEL_ID, {
        resolution: "480p",
      }),
    ).toEqual({
      resolution: "480p",
    });
  });

  test("atlas frame requests strip the edit suffix for text-only qwen generations", () => {
    expect(getAtlasFrameRequestModel(QWEN_FRAME_MODEL_ID, true)).toBe(QWEN_FRAME_MODEL_ID);
    expect(getAtlasFrameRequestModel(QWEN_FRAME_MODEL_ID, false)).toBe("qwen/qwen-image-2.0");
  });

  test("qwen is the default frame model", () => {
    expect(DEFAULT_FRAME_MODEL_ID).toBe(QWEN_FRAME_MODEL_ID);
    expect(getDefaultModelIdForAssetKind("frame")).toBe(QWEN_FRAME_MODEL_ID);
  });
});
