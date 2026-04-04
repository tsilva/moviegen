import { MovieCreatorApp } from "@/components/movie-creator-tracks-app";
import { openProject } from "@/lib/project-store";
import { resumeProjectJobs } from "@/lib/job-runner";

const DEFAULT_PROJECT_PATH = process.env.NEXT_PUBLIC_DEFAULT_PROJECT_PATH?.trim() ?? "";

export default async function HomePage() {
  let initialSnapshot = null;

  if (DEFAULT_PROJECT_PATH) {
    try {
      const openedSnapshot = await openProject(DEFAULT_PROJECT_PATH, true);
      initialSnapshot = await resumeProjectJobs(openedSnapshot.projectPath);
    } catch (error) {
      console.error("Failed to open default project path on launch", error);
    }
  }

  return <MovieCreatorApp initialSnapshot={initialSnapshot} initialProjectPath={DEFAULT_PROJECT_PATH} />;
}
