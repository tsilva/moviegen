import { afterEach, describe, expect, test, vi } from "vitest";

const { enqueueFrameGenerationMock, importFrameAssetsMock } = vi.hoisted(() => ({
  enqueueFrameGenerationMock: vi.fn(),
  importFrameAssetsMock: vi.fn(),
}));

vi.mock("@/lib/job-runner", () => ({
  enqueueFrameGeneration: enqueueFrameGenerationMock,
  importFrameAssets: importFrameAssetsMock,
}));

import { POST } from "./route";

describe("POST /api/frames/[id]/generate", () => {
  afterEach(() => {
    enqueueFrameGenerationMock.mockReset();
    importFrameAssetsMock.mockReset();
  });

  test("passes explicit prompt and reference overrides into frame generation", async () => {
    enqueueFrameGenerationMock.mockResolvedValue({ ok: true });

    await POST(
      new Request("http://localhost/api/frames/frame_123/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Reframe the shot with stronger contrast",
          usePreviousFrameAsReference: true,
          candidateCount: 2,
          size: "1024x576",
          seedMode: "locked",
        }),
      }),
      { params: Promise.resolve({ id: "frame_123" }) },
    );

    expect(enqueueFrameGenerationMock).toHaveBeenCalledWith(["frame_123"], {
      candidateCount: 2,
      overridesByFrameId: {
        frame_123: {
          prompt: "Reframe the shot with stronger contrast",
          usePreviousFrameAsReference: true,
        },
      },
      size: "1024x576",
      seedMode: "locked",
    });
  });

  test("imports direct asset paths without queueing generation when prompt is empty", async () => {
    importFrameAssetsMock.mockResolvedValue({ ok: true });

    await POST(
      new Request("http://localhost/api/frames/frame_123/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directAssetPaths: ["frames/references/shot.png"],
          usePreviousFrameAsReference: false,
        }),
      }),
      { params: Promise.resolve({ id: "frame_123" }) },
    );

    expect(importFrameAssetsMock).toHaveBeenCalledWith("frame_123", ["frames/references/shot.png"], {
      usePreviousFrameAsReference: false,
    });
    expect(enqueueFrameGenerationMock).not.toHaveBeenCalled();
  });
});
