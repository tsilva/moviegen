import { failure, ok } from "@/lib/http";
import { resumeProjectJobs } from "@/lib/job-runner";
import { getCurrentProjectPath } from "@/lib/project-store";
import { generateFinalVideo } from "@/lib/final-video";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export const runtime = "nodejs";

export async function POST() {
  try {
    const projectPath = getCurrentProjectPath();
    if (!projectPath) {
      throw new Error("No project is currently open");
    }

    const snapshot = await resumeProjectJobs(projectPath);
    if (snapshot.transitions.length === 0) {
      throw new Error("Create at least one transition clip before generating a final video");
    }

    const missingCurrentClip = snapshot.transitions.find((transition) => transition.currentVideo == null);
    if (missingCurrentClip) {
      throw new Error("Every active transition needs a current clip before generating a final video");
    }

    const result = await generateFinalVideo({
      projectPath: snapshot.projectPath,
      clipPaths: snapshot.transitions.map((transition) => transition.currentVideo!.outputPath),
    });

    return ok(
      {
        clipCount: snapshot.transitions.length,
        generatedAt: new Date().toISOString(),
        relativePath: result.relativePath,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate final video";
    const status = /no project is currently open/i.test(message) ? 404 : 400;
    return failure(message, status, { headers: NO_STORE_HEADERS });
  }
}
