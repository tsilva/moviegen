import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { generateFinalVideo } from "./final-video";

describe("generateFinalVideo", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    execFileMock.mockReset();
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  });

  test("builds a normalized ffmpeg concat command and fills missing audio with silence", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-final-video-"));
    tempDirs.push(projectPath);

    const clipA = path.join(projectPath, "transitions", "clip-a.mp4");
    const clipB = path.join(projectPath, "transitions", "clip-b.mp4");
    await fs.mkdir(path.dirname(clipA), { recursive: true });
    await fs.writeFile(clipA, "clip-a");
    await fs.writeFile(clipB, "clip-b");

    execFileMock
      .mockImplementationOnce((_file, _args, callback) => {
        callback(
          null,
          JSON.stringify({
            streams: [
              { codec_type: "video", width: 1280, height: 720, avg_frame_rate: "24/1" },
              { codec_type: "audio" },
            ],
            format: { duration: "2.5" },
          }),
          "",
        );
      })
      .mockImplementationOnce((_file, _args, callback) => {
        callback(
          null,
          JSON.stringify({
            streams: [{ codec_type: "video", width: 1024, height: 576, avg_frame_rate: "30/1" }],
            format: { duration: "3.25" },
          }),
          "",
        );
      })
      .mockImplementationOnce((_file, args, callback) => {
        expect(args).toContain(clipA);
        expect(args).toContain(clipB);

        const filterIndex = args.indexOf("-filter_complex");
        expect(filterIndex).toBeGreaterThan(-1);

        const filter = String(args[filterIndex + 1]);
        expect(filter).toContain("[0:v:0]scale=1280:720");
        expect(filter).toContain("scale=1280:720:force_original_aspect_ratio=decrease");
        expect(filter).toContain("fps=24");
        expect(filter).toContain("anullsrc=r=48000:cl=stereo");
        expect(filter).toContain("atrim=duration=3.250");
        expect(filter).toContain("asetpts=N/SR/TB[a1]");
        expect(filter).toContain("concat=n=2:v=1:a=1");

        callback(null, "", "");
      });

    const result = await generateFinalVideo({
      projectPath,
      clipPaths: [path.join("transitions", "clip-a.mp4"), path.join("transitions", "clip-b.mp4")],
    });

    expect(result.relativePath).toBe(path.join("final", "final-video.mp4"));
    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(execFileMock.mock.calls[0]?.[0]).toBe("ffprobe");
    expect(execFileMock.mock.calls[2]?.[0]).toBe("ffmpeg");
  });

  test("rejects clip paths outside the current project", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-final-video-"));
    tempDirs.push(projectPath);

    await expect(
      generateFinalVideo({
        projectPath,
        clipPaths: ["../escape.mp4"],
      }),
    ).rejects.toThrow(/invalid project asset path/i);
  });
});
