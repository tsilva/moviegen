import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  viewMode: z.enum(["sequence", "table"]).optional(),
  selectedFrameId: z.string().nullable().optional(),
  selectedTransitionId: z.string().nullable().optional(),
  inspectorOpen: z.boolean().optional(),
  filter: z.enum(["all", "needsAttention", "approved"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const { snapshot } = await mutateCurrentProject((manifest) => {
      manifest.ui = {
        ...manifest.ui,
        ...body,
      };
    });
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to update UI state");
  }
}
