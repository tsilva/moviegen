import { failure, ok } from "@/lib/http";
import { deleteTransitionFromProject } from "@/lib/delete-ops";
import { mutateCurrentProject } from "@/lib/project-store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { snapshot } = await mutateCurrentProject((manifest, projectPath) =>
      deleteTransitionFromProject(manifest, projectPath, id),
    );
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to delete transition");
  }
}
