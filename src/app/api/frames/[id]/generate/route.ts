import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { enqueueFrameGeneration, importFrameAssets } from "@/lib/job-runner";

const requestSchema = z.object({
  candidateCount: z.number().int().min(1).max(8).optional(),
  directAssetPaths: z.array(z.string()).optional(),
  prompt: z.string().optional(),
  size: z.string().optional(),
  seedMode: z.string().optional(),
  usePreviousFrameAsReference: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const rawBody = await request.text();
    const body = requestSchema.parse(rawBody ? JSON.parse(rawBody) : {});
    const directAssetPaths = body.directAssetPaths?.filter((item) => item.trim().length > 0) ?? [];

    if (directAssetPaths.length > 0 && !body.prompt?.trim()) {
      const snapshot = await importFrameAssets(id, directAssetPaths, {
        usePreviousFrameAsReference: body.usePreviousFrameAsReference,
      });
      return ok(snapshot);
    }

    const snapshot = await enqueueFrameGeneration([id], {
      candidateCount: body.candidateCount ?? 1,
      overridesByFrameId: {
        [id]: {
          prompt: body.prompt,
          usePreviousFrameAsReference: body.usePreviousFrameAsReference,
        },
      },
      size: body.size ?? "1280x720",
      seedMode: body.seedMode ?? "random",
    });
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to queue frame generation");
  }
}
