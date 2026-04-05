import { afterEach, describe, expect, test, vi } from "vitest";

const { openProjectMock, resumeProjectJobsMock } = vi.hoisted(() => ({
  openProjectMock: vi.fn(),
  resumeProjectJobsMock: vi.fn(),
}));

vi.mock("@/lib/project-store", () => ({
  openProject: openProjectMock,
}));

vi.mock("@/lib/job-runner", () => ({
  resumeProjectJobs: resumeProjectJobsMock,
}));

import { getStartupProjectPath, loadStartupProject, STARTUP_PROJECT_PATH_ENV_VAR } from "./startup-project";

describe("startup project loading", () => {
  afterEach(() => {
    openProjectMock.mockReset();
    resumeProjectJobsMock.mockReset();
  });

  test("returns null when no startup project env var is configured", async () => {
    await expect(loadStartupProject({})).resolves.toBeNull();
    expect(openProjectMock).not.toHaveBeenCalled();
    expect(resumeProjectJobsMock).not.toHaveBeenCalled();
  });

  test("reads the configured startup project path from the environment", () => {
    expect(
      getStartupProjectPath({
        [STARTUP_PROJECT_PATH_ENV_VAR]: "  /tmp/moviegen-project  ",
      }),
    ).toBe("/tmp/moviegen-project");
  });

  test("opens and resumes the configured startup project", async () => {
    const snapshot = {
      projectPath: "/tmp/moviegen-project",
    };

    openProjectMock.mockResolvedValue(snapshot);
    resumeProjectJobsMock.mockResolvedValue(snapshot);

    await expect(
      loadStartupProject({
        [STARTUP_PROJECT_PATH_ENV_VAR]: snapshot.projectPath,
      }),
    ).resolves.toBe(snapshot);
    expect(openProjectMock).toHaveBeenCalledWith(snapshot.projectPath, true);
    expect(resumeProjectJobsMock).toHaveBeenCalledWith(snapshot.projectPath);
  });
});
