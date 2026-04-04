import { failure, ok } from "@/lib/http";
import { resumeProjectJobs } from "@/lib/job-runner";
import { getCurrentProjectPath } from "@/lib/project-store";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    const projectPath = getCurrentProjectPath();
    if (!projectPath) {
      throw new Error("No project is currently open");
    }

    const snapshot = await resumeProjectJobs(projectPath);
    return ok(snapshot, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Project not loaded", 404, {
      headers: NO_STORE_HEADERS,
    });
  }
}
