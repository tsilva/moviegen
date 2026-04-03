import { failure, ok } from "@/lib/http";
import { clearProject, getCurrentProjectPath } from "@/lib/project-store";

export async function POST() {
  try {
    const projectPath = getCurrentProjectPath();
    if (!projectPath) {
      throw new Error("No project is currently open");
    }

    const snapshot = await clearProject(projectPath);
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to clear project");
  }
}
