import { failure, ok } from "@/lib/http";
import { resumeProjectJobs } from "@/lib/job-runner";
import { getCurrentProjectPath } from "@/lib/project-store";

export async function GET() {
  try {
    const projectPath = getCurrentProjectPath();
    if (!projectPath) {
      throw new Error("No project is currently open");
    }

    const snapshot = await resumeProjectJobs(projectPath);
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Project not loaded", 404);
  }
}
