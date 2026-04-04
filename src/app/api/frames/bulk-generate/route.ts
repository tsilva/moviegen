import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { enqueueFrameGeneration } from "@/lib/job-runner";

const requestSchema = z.object({
  frameIds: z.array(z.string()),
  candidateCount: z.number().int().min(1).max(8).optional(),
  size: z.string().optional(),
  seedMode: z.string().optional(),
  generationOverridesByFrameId: z
    .record(
      z.string(),
      z.object({
        modelId: z.string().nullable().optional(),
        systemPromptTemplate: z.string().nullable().optional(),
        settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable().optional(),
      }),
    )
    .optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const snapshot = await enqueueFrameGeneration(body.frameIds, {
      candidateCount: body.candidateCount ?? 1,
      overridesByFrameId: body.generationOverridesByFrameId
        ? Object.fromEntries(
            Object.entries(body.generationOverridesByFrameId).map(([frameId, generationOverrides]) => [
              frameId,
              { generationOverrides },
            ]),
          )
        : undefined,
      size: body.size ?? "1280x720",
      seedMode: body.seedMode ?? "random",
    });
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to queue frames");
  }
}
