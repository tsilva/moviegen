import { resumeProjectJobs } from "@/lib/job-runner";
import { openProject } from "@/lib/project-store";
import type { ProjectSnapshot } from "@/lib/types";

export const STARTUP_PROJECT_PATH_ENV_VAR = "MOVIEGEN_PROJECT_PATH";
type StartupProjectEnv = Record<string, string | undefined>;

export function getStartupProjectPath(env: StartupProjectEnv = process.env) {
  const configuredProjectPath = env[STARTUP_PROJECT_PATH_ENV_VAR]?.trim();
  return configuredProjectPath ? configuredProjectPath : null;
}

export async function loadStartupProject(env: StartupProjectEnv = process.env): Promise<ProjectSnapshot | null> {
  const projectPath = getStartupProjectPath(env);
  if (!projectPath) {
    return null;
  }

  const openedSnapshot = await openProject(projectPath, true);
  return resumeProjectJobs(openedSnapshot.projectPath);
}
