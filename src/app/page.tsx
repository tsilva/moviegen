import { connection } from "next/server";
import { MovieCreatorApp } from "@/components/movie-creator-tracks-app";
import { loadStartupProject } from "@/lib/startup-project";

export default async function HomePage() {
  await connection();
  const initialSnapshot = await loadStartupProject();
  return <MovieCreatorApp initialSnapshot={initialSnapshot} />;
}
