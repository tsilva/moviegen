import { failure, ok } from "@/lib/http";
import { undoCurrentProject } from "@/lib/project-store";

export async function POST() {
  try {
    const snapshot = await undoCurrentProject();
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to undo");
  }
}
