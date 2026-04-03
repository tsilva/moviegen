import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { computeImpactSummary, deepClone, moveSegment, reconcileTransitions } from "@/lib/project-ops";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  startFrameId: z.string(),
  targetIndex: z.number().int().min(0),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const response = await mutateCurrentProject((manifest) => {
      const before = deepClone(manifest);
      moveSegment(manifest, body.startFrameId, body.targetIndex);
      reconcileTransitions(manifest);
      return computeImpactSummary(before, manifest);
    });

    return ok({
      ...response.snapshot,
      impact: response.result,
    });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to move segment");
  }
}
