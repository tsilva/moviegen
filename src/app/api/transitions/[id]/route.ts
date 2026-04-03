import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  transitionPrompt: z.string().optional(),
});

export async function PATCH(
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

      if (
        body.transitionPrompt !== undefined &&
        body.transitionPrompt !== transition.transitionPrompt
      ) {
        transition.transitionPrompt = body.transitionPrompt;
        transition.promptRevision += 1;
        transition.confirmedFromVersionId = null;
        transition.confirmedToVersionId = null;
        transition.invalidationReason = "prompt_changed";
      }

      transition.updatedAt = new Date().toISOString();
    });

    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to update transition");
  }
}
