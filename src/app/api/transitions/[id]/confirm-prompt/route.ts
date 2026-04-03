import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { getCurrentFrameVersionIdForManifest } from "@/lib/project-ops";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  prompt: z.string().min(1),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = requestSchema.parse(await request.json());

    const { snapshot } = await mutateCurrentProject((manifest) => {
      const transition = manifest.transitions.find((item) => item.id === id);
      if (!transition) {
        throw new Error("Transition not found");
      }

      const fromEndpointVersionId = getCurrentFrameVersionIdForManifest(manifest, transition.fromFrameId);
      const toEndpointVersionId = getCurrentFrameVersionIdForManifest(manifest, transition.toFrameId);

      if (!fromEndpointVersionId || !toEndpointVersionId) {
        throw new Error("Both endpoint frames need at least one generated version before confirming a transition");
      }

      if (transition.transitionPrompt !== body.prompt) {
        transition.promptRevision += 1;
      }

      transition.transitionPrompt = body.prompt;
      transition.confirmedFromVersionId = fromEndpointVersionId;
      transition.confirmedToVersionId = toEndpointVersionId;
      transition.invalidationReason = null;
      transition.updatedAt = new Date().toISOString();
    });

    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to confirm transition prompt");
  }
}
