import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { enqueueFrameGeneration } from "@/lib/job-runner";
import { createId, nowIso, reconcileTransitions } from "@/lib/project-ops";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  rows: z.array(
    z.object({
      imagePrompt: z.string().min(1),
      referenceImages: z.array(z.string()).optional(),
      usePreviousFrameAsReference: z.boolean().optional(),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const { snapshot, result: createdFrameIds } = await mutateCurrentProject((manifest) => {
      const createdFrameIds: string[] = [];

      for (const row of body.rows) {
        const timestamp = nowIso();
        const frameId = createId("frame");
        manifest.frames.push({
          id: frameId,
          position: manifest.frames.length,
          imagePrompt: row.imagePrompt,
          referenceImages: row.referenceImages ?? [],
          usePreviousFrameAsReference: row.usePreviousFrameAsReference ?? true,
          approvedVersionId: null,
          versions: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        createdFrameIds.push(frameId);
      }

      reconcileTransitions(manifest);
      return createdFrameIds;
    });

    const frameIdsToQueue = snapshot.frames
      .filter((frame) => createdFrameIds.includes(frame.id) && frame.nextAction === "generate")
      .map((frame) => frame.id);

    if (!frameIdsToQueue.length) {
      return ok(snapshot);
    }

    const queuedSnapshot = await enqueueFrameGeneration(frameIdsToQueue, {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    return ok(queuedSnapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to create frames");
  }
}
