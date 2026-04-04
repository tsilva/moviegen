import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { createId, nowIso, reconcileTransitions } from "@/lib/project-ops";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  insertAtTrackIndex: z.number().int().min(0).optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const { snapshot } = await mutateCurrentProject((manifest) => {
      const timestamp = nowIso();

      const buildFrame = (position: number, usePreviousFrameAsReference: boolean) => ({
        id: createId("frame"),
        position,
        imagePrompt: "",
        referenceImages: [],
        usePreviousFrameAsReference,
        approvedVersionId: null,
        versions: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      if (manifest.frames.length === 0) {
        manifest.frames = [
          buildFrame(0, false),
          buildFrame(1, true),
        ];
        reconcileTransitions(manifest);
        return;
      }

      const insertAtFrameIndex = Math.max(
        1,
        Math.min((body.insertAtTrackIndex ?? Math.max(0, manifest.frames.length - 1)) + 1, manifest.frames.length),
      );

      manifest.frames.splice(insertAtFrameIndex, 0, buildFrame(insertAtFrameIndex, true));
      manifest.frames = manifest.frames.map((frame, index) => ({
        ...frame,
        position: index,
        updatedAt: frame.updatedAt === timestamp ? frame.updatedAt : timestamp,
      }));

      reconcileTransitions(manifest);
    });

    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to create track");
  }
}
