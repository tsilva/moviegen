import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { enqueueTransitionGeneration } from "@/lib/job-runner";

const requestSchema = z.object({
  transitionIds: z.array(z.string()),
  duration: z.number().min(1).max(12).optional(),
  size: z.string().optional(),
  fps: z.number().int().min(8).max(60).optional(),
  cameraFixed: z.boolean().optional(),
  generateAudio: z.boolean().optional(),
  promptsByTransitionId: z.record(z.string(), z.string()).optional(),
  generationOverridesByTransitionId: z
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
    const snapshot = await enqueueTransitionGeneration(body.transitionIds, {
      duration: body.duration ?? 4,
      overridesByTransitionId: body.promptsByTransitionId
        || body.generationOverridesByTransitionId
        ? Object.fromEntries(
            body.transitionIds.map((transitionId) => [
              transitionId,
              {
                prompt: body.promptsByTransitionId?.[transitionId],
                generationOverrides: body.generationOverridesByTransitionId?.[transitionId],
              },
            ]),
          )
        : undefined,
      size: body.size ?? "1280x720",
      fps: body.fps ?? 24,
      cameraFixed: body.cameraFixed,
      generateAudio: body.generateAudio,
    });
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to queue transitions");
  }
}
