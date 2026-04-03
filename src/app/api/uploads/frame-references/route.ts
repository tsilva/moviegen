import fs from "node:fs/promises";
import path from "node:path";
import { failure, ok } from "@/lib/http";
import { getCurrentProjectPath } from "@/lib/project-store";

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function sanitizeStem(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function resolveExtension(file: File) {
  if (file.type in MIME_TO_EXTENSION) {
    return MIME_TO_EXTENSION[file.type];
  }

  const ext = path.extname(file.name).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp" || ext === ".gif") {
    return ext === ".jpeg" ? ".jpg" : ext;
  }

  throw new Error(`Unsupported image type for ${file.name}`);
}

export async function POST(request: Request) {
  try {
    const projectPath = getCurrentProjectPath();
    if (!projectPath) {
      throw new Error("No project open");
    }

    const formData = await request.formData();
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (!files.length) {
      throw new Error("No image files were provided");
    }

    const savedPaths = await Promise.all(
      files.map(async (file) => {
        if (!file.type.startsWith("image/")) {
          throw new Error(`Unsupported file type for ${file.name}`);
        }

        const extension = resolveExtension(file);
        const fileStem = sanitizeStem(path.basename(file.name, path.extname(file.name))) || "reference";
        const relativePath = path.join(
          "frames",
          "references",
          `${Date.now()}_${crypto.randomUUID()}_${fileStem}${extension}`,
        );
        const absolutePath = path.join(projectPath, relativePath);

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

        return relativePath;
      }),
    );

    return ok({ paths: savedPaths });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to upload frame references");
  }
}
