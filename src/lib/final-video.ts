import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_OUTPUT_RELATIVE_PATH = path.join("final", "final-video.mp4");
const DEFAULT_FRAME_RATE = 24;
const DEFAULT_VIDEO_DIMENSION = 720;
const DEFAULT_AUDIO_SAMPLE_RATE = 48_000;
const BOUNDARY_TRIM_START_FRAMES = 2;
const BOUNDARY_TRIM_END_FRAMES = 2;

type GenerateFinalVideoInput = {
  projectPath: string;
  clipPaths: string[];
  outputRelativePath?: string;
};

type ProbedClip = {
  durationSeconds: number;
  hasAudio: boolean;
  width: number;
  height: number;
  frameRate: number;
};

function resolveProjectFile(projectPath: string, relativePath: string) {
  const absolutePath = path.resolve(projectPath, relativePath);
  const relativeToProject = path.relative(projectPath, absolutePath);

  if (relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)) {
    throw new Error(`Invalid project asset path: ${relativePath}`);
  }

  return absolutePath;
}

function parseFrameRate(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_FRAME_RATE;
  }

  if (!value.includes("/")) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FRAME_RATE;
  }

  const [numeratorToken, denominatorToken] = value.split("/", 2);
  const numerator = Number(numeratorToken);
  const denominator = Number(denominatorToken);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return DEFAULT_FRAME_RATE;
  }

  const parsed = numerator / denominator;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FRAME_RATE;
}

function formatFilterDuration(durationSeconds: number, minimumSeconds = 0.001) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : minimumSeconds;
  return safeDuration.toFixed(3);
}

function getBoundaryTrimStartSeconds(index: number, frameRate: number, durationSeconds: number) {
  if (index === 0) {
    return 0;
  }

  const overlapSeconds = BOUNDARY_TRIM_START_FRAMES / frameRate;
  const maxAllowedTrim = Math.max(durationSeconds - 0.001, 0);
  return Math.min(overlapSeconds, maxAllowedTrim);
}

function getBoundaryTrimEndSeconds(index: number, totalClips: number, frameRate: number, durationSeconds: number) {
  if (index >= totalClips - 1) {
    return 0;
  }

  const overlapSeconds = BOUNDARY_TRIM_END_FRAMES / frameRate;
  const maxAllowedTrim = Math.max(durationSeconds - 0.001, 0);
  return Math.min(overlapSeconds, maxAllowedTrim);
}

function getProbeBinary() {
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

function getFfmpegBinary() {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

async function runCommand(file: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function probeClip(absolutePath: string): Promise<ProbedClip> {
  let stdout: string;

  try {
    const result = await runCommand(getProbeBinary(), [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      absolutePath,
    ]);
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ffprobe error";
    throw new Error(`Failed to inspect clip ${path.basename(absolutePath)}: ${message}`);
  }

  let parsed: {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };

  try {
    parsed = JSON.parse(stdout) as {
      streams?: Array<Record<string, unknown>>;
      format?: Record<string, unknown>;
    };
  } catch {
    throw new Error(`Failed to parse ffprobe output for ${path.basename(absolutePath)}`);
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  if (!videoStream) {
    throw new Error(`Clip ${path.basename(absolutePath)} does not contain a video stream`);
  }

  const width = Number(videoStream.width);
  const height = Number(videoStream.height);
  const durationSeconds = Number(parsed.format?.duration);

  return {
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0,
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_VIDEO_DIMENSION,
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_VIDEO_DIMENSION,
    frameRate: parseFrameRate(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
  };
}

export async function generateFinalVideo({
  projectPath,
  clipPaths,
  outputRelativePath = DEFAULT_OUTPUT_RELATIVE_PATH,
}: GenerateFinalVideoInput) {
  if (clipPaths.length === 0) {
    throw new Error("At least one clip is required to generate a final video");
  }

  const absoluteClipPaths = clipPaths.map((clipPath) => resolveProjectFile(projectPath, clipPath));
  await Promise.all(absoluteClipPaths.map((clipPath) => fs.access(clipPath)));

  const clipInfo = await Promise.all(absoluteClipPaths.map((clipPath) => probeClip(clipPath)));
  const outputAbsolutePath = resolveProjectFile(projectPath, outputRelativePath);
  const baseVideo = clipInfo[0]!;
  const width = baseVideo.width;
  const height = baseVideo.height;
  const frameRate = baseVideo.frameRate;

  await fs.mkdir(path.dirname(outputAbsolutePath), { recursive: true });

  const filterSegments = clipInfo.flatMap((info, index) => {
    const trimEndSeconds = getBoundaryTrimEndSeconds(index, clipInfo.length, frameRate, info.durationSeconds);
    const trimStartSeconds = getBoundaryTrimStartSeconds(index, frameRate, info.durationSeconds);
    const trimmedDurationSeconds = Math.max(info.durationSeconds - trimStartSeconds - trimEndSeconds, 0.001);
    const trimEndTimestampSeconds = trimStartSeconds + trimmedDurationSeconds;
    const normalizedVideo =
      `[${index}:v:0]` +
      `trim=start=${formatFilterDuration(trimStartSeconds, 0)}:end=${formatFilterDuration(trimEndTimestampSeconds)},` +
      "setpts=PTS-STARTPTS," +
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,` +
      `fps=${frameRate},` +
      "format=yuv420p," +
      `setsar=1[v${index}]`;

    const normalizedAudio = info.hasAudio
      ? `[${index}:a:0]` +
        `aresample=${DEFAULT_AUDIO_SAMPLE_RATE},` +
        `aformat=sample_rates=${DEFAULT_AUDIO_SAMPLE_RATE}:channel_layouts=stereo,` +
        `atrim=start=${formatFilterDuration(trimStartSeconds, 0)}:end=${formatFilterDuration(trimEndTimestampSeconds)},` +
        `asetpts=N/SR/TB[a${index}]`
      : `anullsrc=r=${DEFAULT_AUDIO_SAMPLE_RATE}:cl=stereo,` +
        `atrim=duration=${formatFilterDuration(trimmedDurationSeconds)},` +
        `asetpts=N/SR/TB[a${index}]`;

    return [normalizedVideo, normalizedAudio];
  });

  filterSegments.push(
    `${clipInfo.map((_, index) => `[v${index}][a${index}]`).join("")}concat=n=${clipInfo.length}:v=1:a=1[v][a]`,
  );

  try {
    await runCommand(getFfmpegBinary(), [
      "-y",
      ...absoluteClipPaths.flatMap((clipPath) => ["-i", clipPath]),
      "-filter_complex",
      filterSegments.join(";"),
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputAbsolutePath,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ffmpeg error";
    throw new Error(`Failed to generate final video: ${message}`);
  }

  return {
    relativePath: outputRelativePath,
  };
}
