import { failure, ok } from "@/lib/http";
import { mutateCurrentProject } from "@/lib/project-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { reviewerNotes?: string };

    const { snapshot } = await mutateCurrentProject((manifest) => {
      const transition = manifest.transitions.find((item) => item.versions.some((version) => version.id === id));
      const version = transition?.versions.find((item) => item.id === id);

      if (!transition || !version) {
        throw new Error("Transition version not found");
      }

      transition.approvedVideoVersionId = version.id;
      transition.updatedAt = new Date().toISOString();
      version.reviewerDecision = "approved";
      version.reviewerNotes = body.reviewerNotes ?? "";

      for (const sibling of transition.versions) {
        if (sibling.id !== version.id && sibling.reviewerDecision === "approved") {
          sibling.reviewerDecision = "rejected";
        }
      }
    });

    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to approve transition version");
  }
}
