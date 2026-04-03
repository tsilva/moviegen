import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { openProject } from "@/lib/project-store";
import { resumeProjectJobs } from "@/lib/job-runner";

const requestSchema = z.object({
  projectPath: z.string().min(1),
  createIfMissing: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const openedSnapshot = await openProject(body.projectPath, body.createIfMissing ?? true);
    const snapshot = await resumeProjectJobs(openedSnapshot.projectPath);
    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to open project");
  }
}
