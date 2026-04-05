import { failure, ok } from "@/lib/http";
import { markTransitionsStaleForFrame } from "@/lib/project-ops";
import { mutateCurrentProject } from "@/lib/project-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { reviewerNotes?: string };

    const { snapshot } = await mutateCurrentProject((manifest) => {
      const frame = manifest.frames.find((item) => item.versions.some((version) => version.id === id));
      const version = frame?.versions.find((item) => item.id === id);

      if (!frame || !version) {
        throw new Error("Frame version not found");
      }

      frame.approvedVersionId = version.id;
      frame.transitionEndpointSelected = true;
      frame.updatedAt = new Date().toISOString();
      version.reviewerDecision = "approved";
      version.reviewerNotes = body.reviewerNotes ?? "";

      for (const sibling of frame.versions) {
        if (sibling.id !== version.id && sibling.reviewerDecision === "approved") {
          sibling.reviewerDecision = "rejected";
        }
      }

      markTransitionsStaleForFrame(manifest, frame.id);
    });

    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to approve frame version");
  }
}
