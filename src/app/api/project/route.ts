import { failure, ok } from "@/lib/http";
import { readCurrentProjectSnapshot } from "@/lib/project-store";

export async function GET() {
  try {
    const snapshot = await readCurrentProjectSnapshot();
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Project not loaded", 404);
  }
}
