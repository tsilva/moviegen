import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { POST } from "./route";
import { createEmptyManifest } from "@/lib/project-ops";
import { saveManifest, setCurrentProjectPath } from "@/lib/project-store";

describe("POST /api/uploads/frame-references", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).__moviegenRuntimeState__;
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  });

  test("stores uploaded images inside the current project and returns relative paths", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-frame-upload-"));
    tempDirs.push(projectPath);

    await saveManifest(projectPath, createEmptyManifest("moviegen"));
    setCurrentProjectPath(projectPath);

    const formData = new FormData();
    formData.append("files", new File([Buffer.from("fake-png-data")], "shot.png", { type: "image/png" }));

    const response = await POST(
      new Request("http://localhost/api/uploads/frame-references", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { paths: string[] };
    expect(payload.paths).toHaveLength(1);
    expect(payload.paths[0]).toMatch(/^frames\/references\/.+\.png$/);
    await expect(fs.readFile(path.join(projectPath, payload.paths[0]!), "utf8")).resolves.toBe("fake-png-data");
  });

  test("rejects non-image uploads", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-frame-upload-"));
    tempDirs.push(projectPath);

    await saveManifest(projectPath, createEmptyManifest("moviegen"));
    setCurrentProjectPath(projectPath);

    const formData = new FormData();
    formData.append("files", new File([Buffer.from("plain-text")], "notes.txt", { type: "text/plain" }));

    const response = await POST(
      new Request("http://localhost/api/uploads/frame-references", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/unsupported file type/i),
    });
  });
});
