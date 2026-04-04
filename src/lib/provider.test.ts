import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { generateTransitionVideo, parseGenerationSize } from "./provider";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("provider transition generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ATLASCLOUD_API_KEY;
    delete process.env.ATLAS_API_KEY;
    delete process.env.SEEDANCE_VIDEO_CAMERA_FIXED;
    delete process.env.SEEDANCE_VIDEO_GENERATE_AUDIO;
  });

  test("parses atlas size strings", () => {
    expect(parseGenerationSize("1280x720")).toEqual({ width: 1280, height: 720 });
    expect(parseGenerationSize("512*512")).toEqual({ width: 512, height: 512 });
    expect(() => parseGenerationSize("wide")).toThrow(/Invalid generation size/);
  });

  test("uploads local endpoint frames and persists a generated transition clip", async () => {
    process.env.ATLASCLOUD_API_KEY = "test-key";

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-provider-"));
    const fromImagePath = path.join(tempDir, "frames", "frame-a", "approved.png");
    const toImagePath = path.join(tempDir, "frames", "frame-b", "approved.png");

    await fs.mkdir(path.dirname(fromImagePath), { recursive: true });
    await fs.mkdir(path.dirname(toImagePath), { recursive: true });
    await fs.writeFile(fromImagePath, "from-image");
    await fs.writeFile(toImagePath, "to-image");

    const videoBytes = Uint8Array.from([0, 1, 2, 3]);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "https://api.atlascloud.ai/api/v1/model/uploadMedia") {
        const form = init?.body;
        const uploaded = form instanceof FormData ? form.get("file") : null;
        const fileName = uploaded instanceof File ? uploaded.name : null;

        if (uploaded instanceof File && fileName === "approved.png") {
          const fileContents = await uploaded.text();
          const mappedUrl = fileContents === "to-image"
            ? "https://cdn.example/to.png"
            : "https://cdn.example/from.png";

          return jsonResponse({ data: { download_url: mappedUrl } });
        }

        throw new Error(`Unexpected upload payload for ${fileName ?? "unknown file"}`);
      }

      if (url === "https://api.atlascloud.ai/api/v1/model/generateVideo") {
        return jsonResponse({ data: { id: "pred_123", status: "processing" } });
      }

      if (url === "https://api.atlascloud.ai/api/v1/model/prediction/pred_123") {
        return jsonResponse({
          data: {
            id: "pred_123",
            status: "completed",
            outputs: ["https://cdn.example/transition.mp4"],
          },
        });
      }

      if (url === "https://cdn.example/transition.mp4") {
        return new Response(videoBytes, {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        });
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const asset = await generateTransitionVideo({
      projectPath: tempDir,
      transitionId: "transition-1",
      modelId: "bytedance/seedance-v1.5-pro/image-to-video",
      prompt: "Camera glides from the first shot into the second.",
      fromImagePath,
      toImagePath,
      posterPath: path.join("frames", "frame-a", "approved.png"),
      duration: 4,
      size: "1280x720",
      fps: 24,
      settings: {
        resolution: "720p",
        aspectRatio: "16:9",
        cameraFixed: false,
        generateAudio: true,
      },
    });

    expect(asset.posterRelativePath).toBe(path.join("frames", "frame-a", "approved.png"));
    expect(asset.relativePath).toMatch(/^transitions\/transition-1\/.+\.mp4$/);

    const savedBytes = await fs.readFile(path.join(tempDir, asset.relativePath));
    expect(savedBytes).toEqual(Buffer.from(videoBytes));

    const generateVideoRequest = fetchMock.mock.calls[2];
    expect(generateVideoRequest?.[0]).toBe("https://api.atlascloud.ai/api/v1/model/generateVideo");
    expect(generateVideoRequest?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(generateVideoRequest?.[1]?.body))).toMatchObject({
      model: "bytedance/seedance-v1.5-pro/image-to-video",
      prompt: "Camera glides from the first shot into the second.",
      image: "https://cdn.example/from.png",
      last_image: "https://cdn.example/to.png",
      width: 1280,
      height: 720,
      resolution: "720p",
      aspect_ratio: "16:9",
      duration: 4,
      fps: 24,
    });
    expect(asset.responsePayload).toEqual({
      submitResponse: {
        id: "pred_123",
        status: "processing",
      },
      settledResponse: {
        id: "pred_123",
        status: "completed",
        outputs: ["https://cdn.example/transition.mp4"],
      },
    });
  });

  test("sends camera_fixed and generate_audio flags to Seedance", async () => {
    process.env.ATLASCLOUD_API_KEY = "test-key";

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-provider-"));
    const fromImagePath = path.join(tempDir, "frames", "frame-a", "approved.png");
    const toImagePath = path.join(tempDir, "frames", "frame-b", "approved.png");

    await fs.mkdir(path.dirname(fromImagePath), { recursive: true });
    await fs.mkdir(path.dirname(toImagePath), { recursive: true });
    await fs.writeFile(fromImagePath, "from-image");
    await fs.writeFile(toImagePath, "to-image");

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);

      if (url === "https://api.atlascloud.ai/api/v1/model/uploadMedia") {
        return jsonResponse({ data: { download_url: "https://cdn.example/frame.png" } });
      }

      if (url === "https://api.atlascloud.ai/api/v1/model/generateVideo") {
        return jsonResponse({
          data: {
            outputs: ["https://cdn.example/transition.mp4"],
          },
        });
      }

      if (url === "https://cdn.example/transition.mp4") {
        return new Response(Uint8Array.from([0, 1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        });
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await generateTransitionVideo({
      projectPath: tempDir,
      transitionId: "transition-1",
      modelId: "bytedance/seedance-v1.5-pro/image-to-video",
      prompt: "Locked-off shot with no audio.",
      fromImagePath,
      toImagePath,
      posterPath: path.join("frames", "frame-a", "approved.png"),
      duration: 4,
      size: "1280x720",
      fps: 24,
      settings: {
        resolution: "720p",
        aspectRatio: "16:9",
        cameraFixed: true,
        generateAudio: false,
      },
    });

    const generateVideoRequest = fetchMock.mock.calls[2];
    expect(JSON.parse(String(generateVideoRequest?.[1]?.body))).toMatchObject({
      camera_fixed: true,
      generate_audio: false,
    });
  });

  test("uses Wan image-to-video parameters without Seedance-specific flags", async () => {
    process.env.ATLASCLOUD_API_KEY = "test-key";

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-provider-"));
    const fromImagePath = path.join(tempDir, "frames", "frame-a", "approved.png");
    const toImagePath = path.join(tempDir, "frames", "frame-b", "approved.png");

    await fs.mkdir(path.dirname(fromImagePath), { recursive: true });
    await fs.mkdir(path.dirname(toImagePath), { recursive: true });
    await fs.writeFile(fromImagePath, "from-image");
    await fs.writeFile(toImagePath, "to-image");

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);

      if (url === "https://api.atlascloud.ai/api/v1/model/uploadMedia") {
        return jsonResponse({ data: { download_url: "https://cdn.example/frame.png" } });
      }

      if (url === "https://api.atlascloud.ai/api/v1/model/generateVideo") {
        return jsonResponse({
          data: {
            outputs: ["https://cdn.example/transition.mp4"],
          },
        });
      }

      if (url === "https://cdn.example/transition.mp4") {
        return new Response(Uint8Array.from([0, 1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        });
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await generateTransitionVideo({
      projectPath: tempDir,
      transitionId: "transition-1",
      modelId: "alibaba/wan-2.7/image-to-video",
      prompt: "Bridge these two frames with subtle motion.",
      fromImagePath,
      toImagePath,
      posterPath: path.join("frames", "frame-a", "approved.png"),
      duration: 15,
      size: "1920x1080",
      fps: 24,
      settings: {
        resolution: "1080p",
        duration: "15",
      },
    });

    const generateVideoRequest = fetchMock.mock.calls[2];
    expect(JSON.parse(String(generateVideoRequest?.[1]?.body))).toEqual({
      model: "alibaba/wan-2.7/image-to-video",
      prompt: "Bridge these two frames with subtle motion.",
      image: "https://cdn.example/frame.png",
      last_image: "https://cdn.example/frame.png",
      width: 1920,
      height: 1080,
      duration: 15,
      fps: 24,
    });
  });
});
