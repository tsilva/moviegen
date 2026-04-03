import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { enqueueTransitionGeneration } from "@/lib/job-runner";

const requestSchema = z.object({
  transitionIds: z.array(z.string()),
  duration: z.number().min(1).max(12).optional(),
  size: z.string().optional(),
  fps: z.number().int().min(8).max(60).optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const snapshot = await enqueueTransitionGeneration(body.transitionIds, {
      duration: body.duration ?? 4,
      size: body.size ?? "1280x720",
      fps: body.fps ?? 24,
    });
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to queue transitions");
  }
}
