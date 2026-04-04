import { afterEach, describe, expect, test, vi } from "vitest";

const { cancelTransitionGenerationMock } = vi.hoisted(() => ({
  cancelTransitionGenerationMock: vi.fn(),
}));

vi.mock("@/lib/job-runner", () => ({
  cancelTransitionGeneration: cancelTransitionGenerationMock,
}));

import { POST } from "./route";

describe("POST /api/transitions/[id]/stop", () => {
  afterEach(() => {
    cancelTransitionGenerationMock.mockReset();
  });

  test("stops the active transition generation for the requested transition", async () => {
    cancelTransitionGenerationMock.mockResolvedValue({ ok: true });

    await POST(
      new Request("http://localhost/api/transitions/transition_123/stop", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "transition_123" }) },
    );

    expect(cancelTransitionGenerationMock).toHaveBeenCalledWith("transition_123");
  });
});
