import { afterEach, describe, expect, test, vi } from "vitest";

const { enqueueTransitionGenerationMock } = vi.hoisted(() => ({
  enqueueTransitionGenerationMock: vi.fn(),
}));

vi.mock("@/lib/job-runner", () => ({
  enqueueTransitionGeneration: enqueueTransitionGenerationMock,
}));

import { POST } from "./route";

describe("POST /api/transitions/bulk-generate", () => {
  afterEach(() => {
    enqueueTransitionGenerationMock.mockReset();
  });

  test("passes per-transition prompt overrides into generation requests", async () => {
    enqueueTransitionGenerationMock.mockResolvedValue({ ok: true });

    await POST(
      new Request("http://localhost/api/transitions/bulk-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transitionIds: ["transition_123"],
          promptsByTransitionId: {
            transition_123: "Whip pan into the next shot",
          },
          duration: 5,
          size: "1024x576",
          fps: 30,
        }),
      }),
    );

    expect(enqueueTransitionGenerationMock).toHaveBeenCalledWith(["transition_123"], {
      duration: 5,
      overridesByTransitionId: {
        transition_123: {
          prompt: "Whip pan into the next shot",
        },
      },
      size: "1024x576",
      fps: 30,
    });
  });
});
