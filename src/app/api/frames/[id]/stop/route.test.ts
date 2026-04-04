import { afterEach, describe, expect, test, vi } from "vitest";

const { cancelFrameGenerationMock } = vi.hoisted(() => ({
  cancelFrameGenerationMock: vi.fn(),
}));

vi.mock("@/lib/job-runner", () => ({
  cancelFrameGeneration: cancelFrameGenerationMock,
}));

import { POST } from "./route";

describe("POST /api/frames/[id]/stop", () => {
  afterEach(() => {
    cancelFrameGenerationMock.mockReset();
  });

  test("stops the active frame generation for the requested frame", async () => {
    cancelFrameGenerationMock.mockResolvedValue({ ok: true });

    await POST(
      new Request("http://localhost/api/frames/frame_123/stop", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "frame_123" }) },
    );

    expect(cancelFrameGenerationMock).toHaveBeenCalledWith("frame_123");
  });
});
