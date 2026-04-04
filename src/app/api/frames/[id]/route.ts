import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { mutateCurrentProject } from "@/lib/project-store";
import { reconcileTransitions } from "@/lib/project-ops";

const requestSchema = z.object({
  imagePrompt: z.string().optional(),
  usePreviousFrameAsReference: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = requestSchema.parse(await request.json());
    const { snapshot } = await mutateCurrentProject((manifest) => {
      const frame = manifest.frames.find((item) => item.id === id);
      if (!frame) {
        throw new Error("Frame not found");
      }

      if (body.imagePrompt !== undefined) {
        frame.imagePrompt = body.imagePrompt;
      }

      if (body.usePreviousFrameAsReference !== undefined) {
        frame.usePreviousFrameAsReference = body.usePreviousFrameAsReference;
      }

      frame.updatedAt = new Date().toISOString();
      reconcileTransitions(manifest);
    });

    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to update frame");
  }
}
