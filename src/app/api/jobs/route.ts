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
    return ok({
      jobs: snapshot.manifest.jobs,
    });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to load jobs", 404);
  }
}
