import { failure, ok } from "@/lib/http";
import { cancelFrameGeneration } from "@/lib/job-runner";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const snapshot = await cancelFrameGeneration(id);
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to stop frame generation");
  }
}
