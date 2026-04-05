import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getVideoAspectRatioDefault,
  getVideoCameraFixedDefault,
  getVideoGenerateAudioDefault,
  getVideoResolutionDefault,
} from "@/lib/generation-defaults";
import {
  DEFAULT_FRAME_MODEL_ID,
  DEFAULT_TRANSITION_MODEL_ID,
  WAN_TRANSITION_MODEL_ID,
  getAtlasFrameRequestModel,
} from "@/lib/generation-models";
import type { GenerationSettings } from "@/lib/types";

export type GeneratedFrameAsset = {
  model: string;
  providerPredictionId: string | null;
  relativePath: string;
  inputPayload: Record<string, unknown>;
  responsePayload: unknown;
};

export type GeneratedTransitionAsset = {
  model: string;
  providerPredictionId: string | null;
  relativePath: string;
  posterRelativePath: string;
  lastFrameRelativePath?: string | null;
  inputPayload: Record<string, unknown>;
  responsePayload: unknown;
};

type GenerateFrameImageInput = {
  projectPath: string;
  frameId: string;
  modelId: string;
  prompt: string;
  referenceImages: string[];
  candidateCount: number;
  size: string;
  seedMode: string;
  seed?: number;
  signal?: AbortSignal;
};

type GenerateTransitionVideoInput = {
  projectPath: string;
  transitionId: string;
  targetFrameId?: string | null;
  modelId: string;
  prompt: string;
  fromImagePath: string;
  toImagePath?: string | null;
  posterPath: string;
  duration: number;
  size: string;
  fps: number;
  settings: GenerationSettings;
  signal?: AbortSignal;
};

type AtlasGenerationResponse = {
  id?: string;
  predictionId?: string;
  status?: string;
  outputs?: unknown;
  output?: unknown;
  urls?: Record<string, unknown>;
  error?: string;
  message?: string;
};

const DEFAULT_ATLAS_BASE_URL = "https://api.atlascloud.ai/api/v1";
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

function getAtlasBaseUrl() {
  return (process.env.ATLAS_BASE_URL ?? DEFAULT_ATLAS_BASE_URL).replace(/\/$/, "");
}

function getAtlasApiKey() {
  const apiKey = process.env.ATLAS_API_KEY ?? process.env.ATLASCLOUD_API_KEY;
  if (!apiKey) {
    throw new Error("ATLAS_API_KEY or ATLASCLOUD_API_KEY is not configured");
  }
  return apiKey;
}

function getFrameRequestModel(modelId: string, usesReferenceImages: boolean) {
  if (usesReferenceImages) {
    return modelId;
  }

  if (process.env.WAN_TEXT_MODEL) {
    return process.env.WAN_TEXT_MODEL;
  }

  return getAtlasFrameRequestModel(modelId, false);
}

function normalizeSize(size: string) {
  return size.replace(/x/gi, "*");
}

export function parseGenerationSize(size: string) {
  const match = size.trim().match(/^(\d+)\s*[x*]\s*(\d+)$/i);
  if (!match) {
    throw new Error(`Invalid generation size "${size}". Expected WIDTHxHEIGHT.`);
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function buildSeed(seedMode: string, iteration: number) {
  if (seedMode === "locked") {
    return iteration + 1;
  }

  return Math.floor(Math.random() * 2_147_483_647);
}

function getAuthHeaders() {
  return {
    Authorization: `Bearer ${getAtlasApiKey()}`,
  };
}

async function atlasRequest<T>(pathname: string, init: RequestInit) {
  const response = await fetch(`${getAtlasBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...(init.headers ?? {}),
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  const payload = typeof data === "object" && data !== null
    ? ("data" in data ? (data as { data?: unknown }).data : data)
    : data;

  const payloadMessage = typeof data === "object" && data !== null
    ? ("message" in data ? (data as { message?: string }).message : undefined)
    : undefined;
  const payloadCode = typeof data === "object" && data !== null
    ? ("code" in data ? (data as { code?: number }).code : undefined)
    : undefined;

  if (!response.ok || (typeof payloadCode === "number" && payloadCode >= 400)) {
    const message = typeof payload === "string"
      ? payload
      : typeof payload === "object" && payload !== null
        ? (payload as { error?: string; message?: string }).error ??
          (payload as { error?: string; message?: string }).message ??
          payloadMessage ??
          `Atlas request failed with ${response.status}`
        : payloadMessage ?? `Atlas request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

function createAbortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  return new DOMException("The operation was aborted", "AbortError");
}

function getProbeBinary() {
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

function getFfmpegBinary() {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

async function runCommand(file: string, args: string[], signal?: AbortSignal) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, { signal }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

function extractOutputUrls(payload: AtlasGenerationResponse) {
  const rawOutputs = Array.isArray(payload.outputs)
    ? payload.outputs
    : Array.isArray(payload.output)
      ? payload.output
      : [];

  const urls = rawOutputs.flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }

    if (item && typeof item === "object") {
      const candidate = [
        "url",
        "image",
        "output",
        "image_url",
        "imageUrl",
        "download_url",
        "downloadUrl",
      ]
        .map((key) => (item as Record<string, unknown>)[key])
        .find((value) => typeof value === "string");

      return typeof candidate === "string" ? [candidate] : [];
    }

    return [];
  });

  return urls.filter((url): url is string => Boolean(url));
}

function inferExtension(contentType: string | null, sourceUrl: string) {
  const pathname = new URL(sourceUrl).pathname;
  const extFromUrl = path.extname(pathname);
  if (extFromUrl) {
    return extFromUrl;
  }

  switch (contentType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    default:
      return ".png";
  }
}

async function ensureRemoteReference(projectPath: string, reference: string, signal?: AbortSignal) {
  throwIfAborted(signal);

  if (/^https?:\/\//i.test(reference)) {
    return reference;
  }

  const absolutePath = path.isAbsolute(reference) ? reference : path.resolve(projectPath, reference);
  const fileBuffer = await fs.readFile(absolutePath);
  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), path.basename(absolutePath));
  const upload = await atlasRequest<{
    url?: string;
    data?: { url?: string; download_url?: string; downloadUrl?: string };
    download_url?: string;
    downloadUrl?: string;
  }>("/model/uploadMedia", {
    method: "POST",
    body: form,
    signal,
  });

  const uploadedUrl =
    upload.url ??
    upload.data?.url ??
    upload.download_url ??
    upload.data?.download_url ??
    upload.downloadUrl ??
    upload.data?.downloadUrl;
  if (!uploadedUrl) {
    throw new Error("Atlas upload did not return a file URL");
  }

  return uploadedUrl;
}

async function readPrediction(predictionId: string, signal?: AbortSignal) {
  const paths = [
    `/model/prediction/${encodeURIComponent(predictionId)}`,
    `/model/result/${encodeURIComponent(predictionId)}`,
  ];
  let lastError: Error | null = null;

  for (const pathname of paths) {
    try {
      return await atlasRequest<AtlasGenerationResponse>(pathname, { method: "GET", signal });
    } catch (error) {
      if (error instanceof Error && /404/.test(error.message)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("Prediction not found");
}

async function waitForSignalSafeDelay(delayMs: number, signal?: AbortSignal) {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    function onAbort() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError(signal));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForGeneration(predictionId: string, signal?: AbortSignal) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    throwIfAborted(signal);
    const result = await readPrediction(predictionId, signal);
    const status = (result.status ?? "").toLowerCase();

    if (status === "succeeded" || status === "completed" || extractOutputUrls(result).length > 0) {
      return result;
    }

    if (status === "failed" || status === "error" || status === "canceled") {
      throw new Error(result.error ?? result.message ?? `Atlas generation ${status}`);
    }

    await waitForSignalSafeDelay(POLL_INTERVAL_MS, signal);
  }

  throw new Error("Timed out waiting for Atlas generation");
}

async function persistGeneratedAsset(
  projectPath: string,
  relativeDir: string,
  fileStem: string,
  url: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to download generated asset: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type");
  const extension = inferExtension(contentType, url);
  const relativePath = path.join(relativeDir, `${fileStem}${extension}`);
  const absolutePath = path.join(projectPath, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, Buffer.from(arrayBuffer));

  return relativePath;
}

async function probeVideoDurationSeconds(absolutePath: string, signal?: AbortSignal) {
  const { stdout } = await runCommand(
    getProbeBinary(),
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      absolutePath,
    ],
    signal,
  );

  const parsed = Number(stdout.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function extractLastFrameAsset(
  projectPath: string,
  videoRelativePath: string,
  frameId: string,
  signal?: AbortSignal,
) {
  const absoluteVideoPath = path.join(projectPath, videoRelativePath);
  const relativePath = path.join("frames", frameId, `${Date.now()}_transition-last-frame.png`);
  const absoluteOutputPath = path.join(projectPath, relativePath);
  const durationSeconds = await probeVideoDurationSeconds(absoluteVideoPath, signal);
  const seekOffsetSeconds = durationSeconds != null ? Math.max(durationSeconds - 0.1, 0) : null;

  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await runCommand(
    getFfmpegBinary(),
    [
      "-y",
      ...(seekOffsetSeconds != null ? ["-ss", seekOffsetSeconds.toFixed(3)] : []),
      "-i",
      absoluteVideoPath,
      "-frames:v",
      "1",
      absoluteOutputPath,
    ],
    signal,
  );

  return relativePath;
}

function buildResponsePayload(initial: AtlasGenerationResponse, settled: AtlasGenerationResponse) {
  if (initial === settled) {
    return initial;
  }

  return {
    submitResponse: initial,
    settledResponse: settled,
  };
}

export async function generateFrameImages(input: GenerateFrameImageInput): Promise<GeneratedFrameAsset[]> {
  const referenceImages = await Promise.all(
    input.referenceImages.map((reference) => ensureRemoteReference(input.projectPath, reference, input.signal)),
  );
  const requestModel = getFrameRequestModel(input.modelId, referenceImages.length > 0);
  const generatedAssets: GeneratedFrameAsset[] = [];

  for (let index = 0; index < input.candidateCount; index += 1) {
    const requestPayload: Record<string, unknown> = {
      model: requestModel,
      prompt: input.prompt,
      size: normalizeSize(input.size),
      seed: input.seed ?? buildSeed(input.seedMode, index),
    };

    if (referenceImages.length === 1) {
      requestPayload.image = referenceImages[0];
    }

    if (referenceImages.length > 1) {
      requestPayload.images = referenceImages;
    }

    const initial = await atlasRequest<AtlasGenerationResponse>("/model/generateImage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
      signal: input.signal,
    });

    const immediateOutputs = extractOutputUrls(initial);
    const predictionId = initial.predictionId ?? initial.id ?? null;
    const settled = immediateOutputs.length > 0
      ? initial
      : predictionId
        ? await waitForGeneration(predictionId, input.signal)
        : (() => {
            throw new Error("Atlas did not return outputs or a prediction id");
          })();

    const outputUrl = extractOutputUrls(settled)[0];
    if (!outputUrl) {
      throw new Error("Atlas did not return a generated image URL");
    }

    const relativePath = await persistGeneratedAsset(
      input.projectPath,
      path.join("frames", input.frameId),
      `${Date.now()}_${index + 1}`,
      outputUrl,
      input.signal,
    );

    generatedAssets.push({
      model: input.modelId || DEFAULT_FRAME_MODEL_ID,
      providerPredictionId: predictionId,
      relativePath,
      inputPayload: requestPayload,
      responsePayload: buildResponsePayload(initial, settled),
    });
  }

  return generatedAssets;
}

export async function generateTransitionVideo(
  input: GenerateTransitionVideoInput,
): Promise<GeneratedTransitionAsset> {
  const [fromImage, toImage] = await Promise.all([
    ensureRemoteReference(input.projectPath, input.fromImagePath, input.signal),
    input.toImagePath
      ? ensureRemoteReference(input.projectPath, input.toImagePath, input.signal)
      : Promise.resolve(null),
  ]);
  const settings = input.settings ?? {};
  const { width, height } = parseGenerationSize(input.size);
  const requestPayload: Record<string, unknown> = input.modelId === WAN_TRANSITION_MODEL_ID
    ? {
        model: input.modelId,
        prompt: input.prompt,
        image: fromImage,
        width,
        height,
        duration: input.duration,
        fps: input.fps,
      }
    : {
        model: input.modelId,
        prompt: input.prompt,
        image: fromImage,
        width,
        height,
        resolution:
          typeof settings.resolution === "string" ? settings.resolution : getVideoResolutionDefault(),
        aspect_ratio:
          typeof settings.aspectRatio === "string" ? settings.aspectRatio : getVideoAspectRatioDefault(),
        duration: input.duration,
        fps: input.fps,
        camera_fixed:
          typeof settings.cameraFixed === "boolean" ? settings.cameraFixed : getVideoCameraFixedDefault(),
        generate_audio:
          typeof settings.generateAudio === "boolean" ? settings.generateAudio : getVideoGenerateAudioDefault(),
      };

  if (toImage) {
    requestPayload.last_image = toImage;
  }

  const initial = await atlasRequest<AtlasGenerationResponse>("/model/generateVideo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestPayload),
    signal: input.signal,
  });

  const immediateOutputs = extractOutputUrls(initial);
  const predictionId = initial.predictionId ?? initial.id ?? null;
  const settled = immediateOutputs.length > 0
    ? initial
    : predictionId
      ? await waitForGeneration(predictionId, input.signal)
      : (() => {
          throw new Error("Atlas did not return outputs or a prediction id");
        })();

  const outputUrl = extractOutputUrls(settled)[0];
  if (!outputUrl) {
    throw new Error("Atlas did not return a generated video URL");
  }

  const relativePath = await persistGeneratedAsset(
    input.projectPath,
    path.join("transitions", input.transitionId),
    `${Date.now()}_transition`,
    outputUrl,
    input.signal,
  );
  const lastFrameRelativePath =
    !input.toImagePath && input.targetFrameId
      ? await extractLastFrameAsset(input.projectPath, relativePath, input.targetFrameId, input.signal)
      : null;

  return {
    model: input.modelId || DEFAULT_TRANSITION_MODEL_ID,
    providerPredictionId: predictionId,
    relativePath,
    posterRelativePath: input.posterPath,
    lastFrameRelativePath,
    inputPayload: requestPayload,
    responsePayload: buildResponsePayload(initial, settled),
  };
}
