import fs from "node:fs/promises";
import path from "node:path";

export type GeneratedFrameAsset = {
  model: string;
  providerPredictionId: string | null;
  relativePath: string;
  inputPayload: Record<string, unknown>;
};

export type GeneratedTransitionAsset = {
  model: string;
  providerPredictionId: string | null;
  relativePath: string;
  posterRelativePath: string;
  inputPayload: Record<string, unknown>;
};

type GenerateFrameImageInput = {
  projectPath: string;
  frameId: string;
  prompt: string;
  referenceImages: string[];
  candidateCount: number;
  size: string;
  seedMode: string;
  seed?: number;
};

type GenerateTransitionVideoInput = {
  projectPath: string;
  transitionId: string;
  prompt: string;
  fromImagePath: string;
  toImagePath: string;
  posterPath: string;
  duration: number;
  size: string;
  fps: number;
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
const DEFAULT_IMAGE_MODEL = "alibaba/wan-2.7-pro/image-edit";
const DEFAULT_TEXT_TO_IMAGE_MODEL = "alibaba/wan-2.7-pro/text-to-image";
const DEFAULT_VIDEO_MODEL = "bytedance/seedance-v1.5-pro/image-to-video";
const DEFAULT_VIDEO_RESOLUTION = "720p";
const DEFAULT_VIDEO_ASPECT_RATIO = "16:9";
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

function getEditModel() {
  return process.env.WAN_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
}

function getVideoModel() {
  return process.env.SEEDANCE_VIDEO_MODEL ?? DEFAULT_VIDEO_MODEL;
}

function getVideoResolution() {
  return process.env.SEEDANCE_VIDEO_RESOLUTION ?? DEFAULT_VIDEO_RESOLUTION;
}

function getVideoAspectRatio() {
  return process.env.SEEDANCE_VIDEO_ASPECT_RATIO ?? DEFAULT_VIDEO_ASPECT_RATIO;
}

function getTextToImageModel(editModel: string) {
  if (process.env.WAN_TEXT_MODEL) {
    return process.env.WAN_TEXT_MODEL;
  }

  if (editModel.endsWith("/image-edit")) {
    return editModel.replace(/\/image-edit$/, "/text-to-image");
  }

  if (editModel.endsWith("/edit")) {
    return editModel.replace(/\/edit$/, "");
  }

  return DEFAULT_TEXT_TO_IMAGE_MODEL;
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

async function ensureRemoteReference(projectPath: string, reference: string) {
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

async function readPrediction(predictionId: string) {
  const paths = [
    `/model/prediction/${encodeURIComponent(predictionId)}`,
    `/model/result/${encodeURIComponent(predictionId)}`,
  ];
  let lastError: Error | null = null;

  for (const pathname of paths) {
    try {
      return await atlasRequest<AtlasGenerationResponse>(pathname, { method: "GET" });
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

async function waitForGeneration(predictionId: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const result = await readPrediction(predictionId);
    const status = (result.status ?? "").toLowerCase();

    if (status === "succeeded" || status === "completed" || extractOutputUrls(result).length > 0) {
      return result;
    }

    if (status === "failed" || status === "error" || status === "canceled") {
      throw new Error(result.error ?? result.message ?? `Atlas generation ${status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for Atlas generation");
}

async function persistGeneratedAsset(projectPath: string, relativeDir: string, fileStem: string, url: string) {
  const response = await fetch(url);
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

export async function generateFrameImages(input: GenerateFrameImageInput): Promise<GeneratedFrameAsset[]> {
  const referenceImages = await Promise.all(
    input.referenceImages.map((reference) => ensureRemoteReference(input.projectPath, reference)),
  );
  const editModel = getEditModel();
  const model = referenceImages.length > 0 ? editModel : getTextToImageModel(editModel);
  const generatedAssets: GeneratedFrameAsset[] = [];

  for (let index = 0; index < input.candidateCount; index += 1) {
    const requestPayload: Record<string, unknown> = {
      model,
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
    });

    const immediateOutputs = extractOutputUrls(initial);
    const predictionId = initial.predictionId ?? initial.id ?? null;
    const settled = immediateOutputs.length > 0
      ? initial
      : predictionId
        ? await waitForGeneration(predictionId)
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
    );

    generatedAssets.push({
      model,
      providerPredictionId: predictionId,
      relativePath,
      inputPayload: requestPayload,
    });
  }

  return generatedAssets;
}

export async function generateTransitionVideo(
  input: GenerateTransitionVideoInput,
): Promise<GeneratedTransitionAsset> {
  const [fromImage, toImage] = await Promise.all([
    ensureRemoteReference(input.projectPath, input.fromImagePath),
    ensureRemoteReference(input.projectPath, input.toImagePath),
  ]);
  const { width, height } = parseGenerationSize(input.size);
  const model = getVideoModel();
  const requestPayload: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    image: fromImage,
    last_image: toImage,
    width,
    height,
    resolution: getVideoResolution(),
    aspect_ratio: getVideoAspectRatio(),
    duration: input.duration,
    fps: input.fps,
  };

  const initial = await atlasRequest<AtlasGenerationResponse>("/model/generateVideo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  });

  const immediateOutputs = extractOutputUrls(initial);
  const predictionId = initial.predictionId ?? initial.id ?? null;
  const settled = immediateOutputs.length > 0
    ? initial
    : predictionId
      ? await waitForGeneration(predictionId)
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
  );

  return {
    model,
    providerPredictionId: predictionId,
    relativePath,
    posterRelativePath: input.posterPath,
    inputPayload: requestPayload,
  };
}
