import { failure, ok } from "@/lib/http";
import { readCurrentProjectSnapshot } from "@/lib/project-store";

export async function GET() {
  try {
    const snapshot = await readCurrentProjectSnapshot();
    return ok({
      jobs: snapshot.manifest.jobs,
    });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to load jobs", 404);
  }
}
