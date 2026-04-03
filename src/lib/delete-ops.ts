import path from "node:path";
import { archiveProjectSubtree } from "@/lib/project-store";
import { nowIso, reconcileTransitions } from "@/lib/project-ops";
import type { ProjectManifest } from "@/lib/types";

function uniqueTransitionIdsForFrame(manifest: ProjectManifest, frameId: string) {
  return [...new Set(
    manifest.transitions
      .filter((transition) => transition.fromFrameId === frameId || transition.toFrameId === frameId)
      .map((transition) => transition.id),
  )];
}

export async function deleteFrameFromProject(manifest: ProjectManifest, projectPath: string, frameId: string) {
  const frame = manifest.frames.find((item) => item.id === frameId);
  if (!frame) {
    throw new Error("Frame not found");
  }

  const transitionIds = uniqueTransitionIdsForFrame(manifest, frameId);

  for (const transitionId of transitionIds) {
    await archiveProjectSubtree(projectPath, path.join("transitions", transitionId), "transitions");
  }

  await archiveProjectSubtree(projectPath, path.join("frames", frameId), "frames");

  manifest.frames = manifest.frames
    .filter((item) => item.id !== frameId)
    .map((item, index) => ({
      ...item,
      position: index,
      updatedAt: nowIso(),
    }));

  manifest.transitions = manifest.transitions.filter(
    (transition) => transition.fromFrameId !== frameId && transition.toFrameId !== frameId,
  );
  manifest.jobs = manifest.jobs.filter(
    (job) => job.targetParentId !== frameId && !transitionIds.includes(job.targetParentId),
  );

  reconcileTransitions(manifest);
}

export async function deleteTransitionFromProject(
  manifest: ProjectManifest,
  projectPath: string,
  transitionId: string,
) {
  const transition = manifest.transitions.find((item) => item.id === transitionId);
  if (!transition) {
    throw new Error("Transition not found");
  }

  await archiveProjectSubtree(projectPath, path.join("transitions", transitionId), "transitions");

  manifest.transitions = manifest.transitions.filter((item) => item.id !== transitionId);
  manifest.jobs = manifest.jobs.filter((job) => job.targetParentId !== transitionId);

  reconcileTransitions(manifest);
}
