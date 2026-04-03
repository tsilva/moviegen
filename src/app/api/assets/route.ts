import fs from "node:fs/promises";
import path from "node:path";
import { failure } from "@/lib/http";
import { getCurrentProjectPath } from "@/lib/project-store";

const MIME_BY_EXT: Record<string, string> = {
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function parseByteRange(rangeHeader: string, fileSize: number) {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) {
    return null;
  }

  const [, startToken, endToken] = match;

  if (!startToken && !endToken) {
    return null;
  }

  if (!startToken) {
    const suffixLength = Number(endToken);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(fileSize - suffixLength, 0);
    return { start, end: fileSize - 1 };
  }

  const start = Number(startToken);
  const requestedEnd = endToken ? Number(endToken) : fileSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd)) {
    return null;
  }

  if (start < 0 || start >= fileSize) {
    return null;
  }

  const end = Math.min(requestedEnd, fileSize - 1);
  if (end < start) {
    return null;
  }

  return { start, end };
}

export async function GET(request: Request) {
  try {
    const projectPath = getCurrentProjectPath();
    if (!projectPath) {
      throw new Error("No project open");
    }

    const { searchParams } = new URL(request.url);
    const relativePath = searchParams.get("path");
    if (!relativePath) {
      throw new Error("Missing asset path");
    }

    const absolutePath = path.resolve(projectPath, relativePath);
    if (!absolutePath.startsWith(projectPath)) {
      throw new Error("Invalid asset path");
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
    const stat = await fs.stat(absolutePath);
    const rangeHeader = request.headers.get("range");

    if (rangeHeader && (ext === ".mp4" || ext === ".webm")) {
      const range = parseByteRange(rangeHeader, stat.size);
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${stat.size}`,
            "Accept-Ranges": "bytes",
          },
        });
      }

      const file = await fs.readFile(absolutePath);
      const chunk = file.subarray(range.start, range.end + 1);

      return new Response(chunk, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }

    const file = await fs.readFile(absolutePath);

    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to load asset", 404);
  }
}
