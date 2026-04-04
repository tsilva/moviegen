import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const { resumeProjectJobsMock } = vi.hoisted(() => ({
  resumeProjectJobsMock: vi.fn(),
}));

vi.mock("@/lib/job-runner", () => ({
  resumeProjectJobs: resumeProjectJobsMock,
}));

import { GET } from "./route";
import { createEmptyManifest } from "@/lib/project-ops";
import { readProjectSnapshot, saveManifest, setCurrentProjectPath } from "@/lib/project-store";

describe("GET /api/jobs", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    setCurrentProjectPath("");
    resumeProjectJobsMock.mockReset();
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  });

  test("returns fresh jobs for the current project", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-jobs-route-"));
    tempDirs.push(projectPath);

    await saveManifest(projectPath, createEmptyManifest("moviegen"));
    setCurrentProjectPath(projectPath);

    const snapshot = await readProjectSnapshot(projectPath);
    resumeProjectJobsMock.mockResolvedValue(snapshot);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(resumeProjectJobsMock).toHaveBeenCalledWith(projectPath);
    expect(data.jobs).toEqual(snapshot.manifest.jobs);
  });

  test("returns 404 when no project is currently open", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data.error).toMatch(/no project is currently open/i);
    expect(resumeProjectJobsMock).not.toHaveBeenCalled();
  });
});
