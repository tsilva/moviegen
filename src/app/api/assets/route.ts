import fs from "node:fs/promises";
import path from "node:path";
import { failure } from "@/lib/http";
import { getCurrentProjectPath } from "@/lib/project-store";

const MIME_BY_EXT: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

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

    const file = await fs.readFile(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();

    return new Response(file, {
      headers: {
        "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      },
    });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to load asset", 404);
  }
}
