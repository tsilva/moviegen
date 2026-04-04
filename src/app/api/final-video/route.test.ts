import { afterEach, describe, expect, test, vi } from "vitest";

const { generateFinalVideoMock, getCurrentProjectPathMock, resumeProjectJobsMock } = vi.hoisted(() => ({
  generateFinalVideoMock: vi.fn(),
  getCurrentProjectPathMock: vi.fn(),
  resumeProjectJobsMock: vi.fn(),
}));

vi.mock("@/lib/final-video", () => ({
  generateFinalVideo: generateFinalVideoMock,
}));

vi.mock("@/lib/project-store", () => ({
  getCurrentProjectPath: getCurrentProjectPathMock,
}));

vi.mock("@/lib/job-runner", () => ({
  resumeProjectJobs: resumeProjectJobsMock,
}));

import { POST } from "./route";

describe("POST /api/final-video", () => {
  afterEach(() => {
    generateFinalVideoMock.mockReset();
    getCurrentProjectPathMock.mockReset();
    resumeProjectJobsMock.mockReset();
  });

  test("renders the current clip sequence into one final asset", async () => {
    getCurrentProjectPathMock.mockReturnValue("/tmp/moviegen");
    resumeProjectJobsMock.mockResolvedValue({
      projectPath: "/tmp/moviegen",
      transitions: [
        {
          id: "transition_1",
          currentVideo: {
            outputPath: "transitions/transition_1/current.mp4",
          },
        },
        {
          id: "transition_2",
          currentVideo: {
            outputPath: "transitions/transition_2/current.mp4",
          },
        },
      ],
    });
    generateFinalVideoMock.mockResolvedValue({
      relativePath: "final/final-video.mp4",
    });

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(generateFinalVideoMock).toHaveBeenCalledWith({
      projectPath: "/tmp/moviegen",
      clipPaths: [
        "transitions/transition_1/current.mp4",
        "transitions/transition_2/current.mp4",
      ],
    });
    expect(data.relativePath).toBe("final/final-video.mp4");
    expect(data.clipCount).toBe(2);
    expect(typeof data.generatedAt).toBe("string");
  });

  test("returns 400 when the current cut is incomplete", async () => {
    getCurrentProjectPathMock.mockReturnValue("/tmp/moviegen");
    resumeProjectJobsMock.mockResolvedValue({
      projectPath: "/tmp/moviegen",
      transitions: [
        {
          id: "transition_1",
          currentVideo: null,
        },
      ],
    });

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/current clip/i);
    expect(generateFinalVideoMock).not.toHaveBeenCalled();
  });

  test("returns 404 when no project is currently open", async () => {
    getCurrentProjectPathMock.mockReturnValue(null);

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data.error).toMatch(/no project is currently open/i);
    expect(resumeProjectJobsMock).not.toHaveBeenCalled();
  });
});
