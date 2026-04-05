import type { GenerationAssetKind, GenerationSettings, GenerationSettingValue } from "@/lib/types";

export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = "{{prompt}}";
export const SYSTEM_PROMPT_TEMPLATE_TOKEN = "{{prompt}}";
export const PRO_FRAME_MODEL_ID = "alibaba/wan-2.7-pro/image-edit";
export const STANDARD_FRAME_MODEL_ID = "alibaba/wan-2.7/image-edit";
export const QWEN_FRAME_MODEL_ID = "qwen/qwen-image-2.0/edit";
export const DEFAULT_FRAME_MODEL_ID = QWEN_FRAME_MODEL_ID;
export const SEEDANCE_TRANSITION_MODEL_ID = "bytedance/seedance-v1.5-pro/image-to-video";
export const WAN_TRANSITION_MODEL_ID = "alibaba/wan-2.7/image-to-video";
export const DEFAULT_TRANSITION_MODEL_ID = SEEDANCE_TRANSITION_MODEL_ID;

type GenerationSettingOption = {
  value: string;
  label: string;
};

export type GenerationSettingDefinition = {
  key: string;
  label: string;
  kind: "boolean" | "select";
  defaultValue: GenerationSettingValue;
  options?: readonly GenerationSettingOption[];
};

export type GenerationModelDefinition = {
  id: string;
  label: string;
  assetKind: GenerationAssetKind;
  settings: readonly GenerationSettingDefinition[];
};

export const TRANSITION_RESOLUTION_OPTIONS = [
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
] as const;

export const WAN_TRANSITION_RESOLUTION_OPTIONS = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
] as const;

export const FRAME_RESOLUTION_OPTIONS = [
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
] as const;

export const TRANSITION_ASPECT_RATIO_OPTIONS = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "1:1", label: "1:1" },
  { value: "21:9", label: "21:9" },
] as const;

export const SEEDANCE_TRANSITION_DURATION_SECONDS = [4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const WAN_TRANSITION_DURATION_SECONDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

export const TRANSITION_DURATION_OPTIONS = SEEDANCE_TRANSITION_DURATION_SECONDS.map((value) => ({
  value: String(value),
  label: `${value} sec`,
})) as readonly GenerationSettingOption[];

export const WAN_TRANSITION_DURATION_OPTIONS = WAN_TRANSITION_DURATION_SECONDS.map((value) => ({
  value: String(value),
  label: `${value} sec`,
})) as readonly GenerationSettingOption[];

export const MODEL_REGISTRY: Record<string, GenerationModelDefinition> = {
  [PRO_FRAME_MODEL_ID]: {
    id: PRO_FRAME_MODEL_ID,
    label: "Wan 2.7 Pro Image Edit",
    assetKind: "frame",
    settings: [
      {
        key: "resolution",
        label: "Resolution",
        kind: "select",
        defaultValue: "720p",
        options: FRAME_RESOLUTION_OPTIONS,
      },
    ],
  },
  [STANDARD_FRAME_MODEL_ID]: {
    id: STANDARD_FRAME_MODEL_ID,
    label: "Wan 2.7 Image Edit",
    assetKind: "frame",
    settings: [
      {
        key: "resolution",
        label: "Resolution",
        kind: "select",
        defaultValue: "720p",
        options: FRAME_RESOLUTION_OPTIONS,
      },
    ],
  },
  [QWEN_FRAME_MODEL_ID]: {
    id: QWEN_FRAME_MODEL_ID,
    label: "Qwen Image 2.0 Edit",
    assetKind: "frame",
    settings: [
      {
        key: "resolution",
        label: "Resolution",
        kind: "select",
        defaultValue: "720p",
        options: FRAME_RESOLUTION_OPTIONS,
      },
    ],
  },
  [SEEDANCE_TRANSITION_MODEL_ID]: {
    id: SEEDANCE_TRANSITION_MODEL_ID,
    label: "Seedance 1.5 Pro Image to Video",
    assetKind: "transition",
    settings: [
      {
        key: "resolution",
        label: "Resolution",
        kind: "select",
        defaultValue: "480p",
        options: TRANSITION_RESOLUTION_OPTIONS,
      },
      {
        key: "aspectRatio",
        label: "Aspect Ratio",
        kind: "select",
        defaultValue: "1:1",
        options: TRANSITION_ASPECT_RATIO_OPTIONS,
      },
      {
        key: "duration",
        label: "Duration",
        kind: "select",
        defaultValue: "4",
        options: TRANSITION_DURATION_OPTIONS,
      },
      {
        key: "cameraFixed",
        label: "Camera Fixed",
        kind: "boolean",
        defaultValue: true,
      },
      {
        key: "generateAudio",
        label: "Generate Audio",
        kind: "boolean",
        defaultValue: true,
      },
    ],
  },
  [WAN_TRANSITION_MODEL_ID]: {
    id: WAN_TRANSITION_MODEL_ID,
    label: "Wan 2.7 Image to Video",
    assetKind: "transition",
    settings: [
      {
        key: "resolution",
        label: "Resolution",
        kind: "select",
        defaultValue: "720p",
        options: WAN_TRANSITION_RESOLUTION_OPTIONS,
      },
      {
        key: "duration",
        label: "Duration",
        kind: "select",
        defaultValue: "5",
        options: WAN_TRANSITION_DURATION_OPTIONS,
      },
    ],
  },
};

export function getModelDefinition(modelId: string) {
  return MODEL_REGISTRY[modelId] ?? null;
}

export function getModelsForAssetKind(assetKind: GenerationAssetKind) {
  return Object.values(MODEL_REGISTRY).filter((model) => model.assetKind === assetKind);
}

export function getDefaultModelIdForAssetKind(assetKind: GenerationAssetKind) {
  return assetKind === "frame" ? DEFAULT_FRAME_MODEL_ID : DEFAULT_TRANSITION_MODEL_ID;
}

export function getModelDefaultSettings(modelId: string): GenerationSettings {
  const definition = getModelDefinition(modelId);
  if (!definition) {
    return {};
  }

  return Object.fromEntries(
    definition.settings.map((setting) => [setting.key, setting.defaultValue]),
  );
}

export function getAtlasFrameRequestModel(modelId: string, usesReferenceImages: boolean) {
  if (usesReferenceImages) {
    return modelId;
  }

  if (modelId.endsWith("/image-edit")) {
    return modelId.replace(/\/image-edit$/, "/text-to-image");
  }

  if (modelId.endsWith("/edit")) {
    return modelId.replace(/\/edit$/, "");
  }

  return modelId;
}

export function getTransitionSizeFromSettings(settings: GenerationSettings, fallbackSize: string) {
  const resolution = typeof settings.resolution === "string" ? settings.resolution : null;
  const aspectRatio = typeof settings.aspectRatio === "string" ? settings.aspectRatio : null;

  if (!resolution) {
    return fallbackSize;
  }

  if (!aspectRatio) {
    const sizesByResolution: Record<string, string> = {
      "480p": "854x480",
      "720p": "1280x720",
      "1080p": "1920x1080",
    };

    return sizesByResolution[resolution] ?? fallbackSize;
  }

  const baseHeights: Record<string, number> = {
    "480p": 480,
    "720p": 720,
    "1080p": 1080,
  };
  const aspectDimensions: Record<string, [number, number]> = {
    "16:9": [16, 9],
    "9:16": [9, 16],
    "4:3": [4, 3],
    "3:4": [3, 4],
    "1:1": [1, 1],
    "21:9": [21, 9],
  };

  const height = baseHeights[resolution];
  const ratio = aspectDimensions[aspectRatio];
  if (!height || !ratio) {
    return fallbackSize;
  }

  const [widthRatio, heightRatio] = ratio;
  const width = Math.round((height * widthRatio) / heightRatio);
  return `${width}x${height}`;
}

export function getFrameSizeFromSettings(settings: GenerationSettings, fallbackSize: string) {
  const resolution = typeof settings.resolution === "string" ? settings.resolution : null;
  if (!resolution) {
    return fallbackSize;
  }

  const sizesByResolution: Record<string, string> = {
    "480p": "854x480",
    "720p": "1280x720",
    "1080p": "1920x1080",
  };

  return sizesByResolution[resolution] ?? fallbackSize;
}

export function isSeedanceTransitionDurationSeconds(
  value: number,
): value is (typeof SEEDANCE_TRANSITION_DURATION_SECONDS)[number] {
  return SEEDANCE_TRANSITION_DURATION_SECONDS.includes(value as (typeof SEEDANCE_TRANSITION_DURATION_SECONDS)[number]);
}

export function isTransitionDurationSeconds(
  value: number,
): value is (typeof WAN_TRANSITION_DURATION_SECONDS)[number] {
  return WAN_TRANSITION_DURATION_SECONDS.includes(value as (typeof WAN_TRANSITION_DURATION_SECONDS)[number]);
}

export function getTransitionDurationFromSettings(settings: GenerationSettings, fallbackDuration: number) {
  const duration = typeof settings.duration === "string" ? Number(settings.duration) : Number.NaN;
  return isTransitionDurationSeconds(duration) ? duration : fallbackDuration;
}
