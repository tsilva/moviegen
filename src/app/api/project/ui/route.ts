import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  selectedSlot: z
    .object({
      trackId: z.string(),
      slotKind: z.enum(["startFrame", "transition", "endFrame"]),
    })
    .nullable()
    .optional(),
  selectedFrameId: z.string().nullable().optional(),
  selectedTransitionId: z.string().nullable().optional(),
  viewMode: z.enum(["sequence", "play"]).optional(),
  filter: z.enum(["all", "needsRepair"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const { snapshot } = await mutateCurrentProject((manifest) => {
      const nextSelectedSlot =
        body.selectedSlot !== undefined
          ? body.selectedSlot
          : body.selectedTransitionId !== undefined
            ? body.selectedTransitionId
              ? { trackId: body.selectedTransitionId, slotKind: "transition" as const }
              : null
            : body.selectedFrameId !== undefined
              ? body.selectedFrameId
                ? (() => {
                    const matchingTransition = manifest.transitions.find(
                      (transition) =>
                        transition.sequenceScope === "active" &&
                        (transition.fromFrameId === body.selectedFrameId || transition.toFrameId === body.selectedFrameId),
                    );

                    if (!matchingTransition) {
                      return null;
                    }

                    return {
                      trackId: matchingTransition.id,
                      slotKind:
                        matchingTransition.fromFrameId === body.selectedFrameId ? "startFrame" as const : "endFrame" as const,
                    };
                  })()
                : null
              : undefined;

      manifest.ui = {
        ...manifest.ui,
        ...(body.viewMode ? { viewMode: body.viewMode } : {}),
        ...(body.filter ? { filter: body.filter } : {}),
        ...(nextSelectedSlot !== undefined ? { selectedSlot: nextSelectedSlot } : {}),
      };
    });
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to update UI state");
  }
}
