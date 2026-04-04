import { failure, ok } from "@/lib/http";
import { cancelTransitionGeneration } from "@/lib/job-runner";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const snapshot = await cancelTransitionGeneration(id);
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to stop transition generation");
  }
}
