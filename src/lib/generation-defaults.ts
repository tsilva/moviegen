import type { ProjectGenerationDefaults } from "@/lib/types";
import {
  DEFAULT_FRAME_MODEL_ID,
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_TRANSITION_MODEL_ID,
  getModelDefaultSettings,
  isSeedanceTransitionDurationSeconds,
} from "@/lib/generation-models";

const DEFAULT_VIDEO_RESOLUTION = "480p";
const DEFAULT_VIDEO_ASPECT_RATIO = "1:1";
const DEFAULT_VIDEO_DURATION = "4";
const DEFAULT_VIDEO_CAMERA_FIXED = true;
const DEFAULT_VIDEO_GENERATE_AUDIO = true;

function parseBooleanEnv(value: string | undefined, fallback: boolean, envName: string) {
  if (value == null) {
    return fallback;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`Invalid boolean value for ${envName}: ${value}`);
  }
}

export function getVideoResolutionDefault() {
  return process.env.SEEDANCE_VIDEO_RESOLUTION ?? DEFAULT_VIDEO_RESOLUTION;
}

export function getVideoAspectRatioDefault() {
  return process.env.SEEDANCE_VIDEO_ASPECT_RATIO ?? DEFAULT_VIDEO_ASPECT_RATIO;
}

export function getVideoDurationDefault() {
  const value = process.env.SEEDANCE_VIDEO_DURATION ?? DEFAULT_VIDEO_DURATION;
  const duration = Number(value);
  if (!Number.isInteger(duration) || !isSeedanceTransitionDurationSeconds(duration)) {
    throw new Error(`Invalid value for SEEDANCE_VIDEO_DURATION: ${value}`);
  }

  return String(duration);
}

export function getVideoDurationDefaultSeconds() {
  return Number(getVideoDurationDefault());
}

export function getVideoCameraFixedDefault() {
  return parseBooleanEnv(
    process.env.SEEDANCE_VIDEO_CAMERA_FIXED,
    DEFAULT_VIDEO_CAMERA_FIXED,
    "SEEDANCE_VIDEO_CAMERA_FIXED",
  );
}

export function getVideoGenerateAudioDefault() {
  return parseBooleanEnv(
    process.env.SEEDANCE_VIDEO_GENERATE_AUDIO,
    DEFAULT_VIDEO_GENERATE_AUDIO,
    "SEEDANCE_VIDEO_GENERATE_AUDIO",
  );
}

export function createDefaultGenerationDefaults(): ProjectGenerationDefaults {
  return {
    selectedModels: {
      frame: DEFAULT_FRAME_MODEL_ID,
      transition: DEFAULT_TRANSITION_MODEL_ID,
    },
    byModel: {
      [DEFAULT_FRAME_MODEL_ID]: {
        systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
        settings: getModelDefaultSettings(DEFAULT_FRAME_MODEL_ID),
      },
      [DEFAULT_TRANSITION_MODEL_ID]: {
        systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
        settings: {
          ...getModelDefaultSettings(DEFAULT_TRANSITION_MODEL_ID),
          resolution: getVideoResolutionDefault(),
          aspectRatio: getVideoAspectRatioDefault(),
          duration: getVideoDurationDefault(),
          cameraFixed: getVideoCameraFixedDefault(),
          generateAudio: getVideoGenerateAudioDefault(),
        },
      },
    },
  };
}
