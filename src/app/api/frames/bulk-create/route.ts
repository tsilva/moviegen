import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { createId, nowIso, reconcileTransitions } from "@/lib/project-ops";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  rows: z.array(
    z.object({
      title: z.string().optional(),
      imagePrompt: z.string().min(1),
      notes: z.string().optional(),
      referenceImages: z.array(z.string()).optional(),
      usePreviousFrameAsReference: z.boolean().optional(),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const { snapshot } = await mutateCurrentProject((manifest) => {
      for (const row of body.rows) {
        const timestamp = nowIso();
        manifest.frames.push({
          id: createId("frame"),
          position: manifest.frames.length,
          title: row.title ?? "",
          imagePrompt: row.imagePrompt,
          referenceImages: row.referenceImages ?? [],
          usePreviousFrameAsReference: row.usePreviousFrameAsReference ?? false,
          notes: row.notes ?? "",
          approvedVersionId: null,
          versions: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      reconcileTransitions(manifest);
    });
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to create frames");
  }
}
