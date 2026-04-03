import {
  IMAGE_MODEL,
  VIDEO_MODEL,
  createId,
  getCurrentFrameVersionIdForManifest,
  getApprovedFrameVersion,
  getLatestFrameVersion,
  isFrameVersionCurrentForState,
  isTransitionVersionCurrentForState,
  nowIso,
} from "@/lib/project-ops";
import { mutateCurrentProject, mutateProject, readProjectSnapshot } from "@/lib/project-store";
import { generateFrameImages, generateTransitionVideo } from "@/lib/provider";
import type {
  Frame,
  FrameVersion,
  GenerationJob,
  ProjectManifest,
  ProjectSnapshot,
  Transition,
  TransitionVersion,
} from "@/lib/types";

type FrameGenerationOptions = {
  candidateCount: number;
  size: string;
  seedMode: string;
};

type TransitionGenerationOptions = {
  duration: number;
  size: string;
  fps: number;
};

type ClaimedFrameJob = {
  job: GenerationJob;
  frame: Frame;
  projectPath: string;
  referenceImages: string[];
  dependencyFrameId: string | null;
  dependencyVersionId: string | null;
};

type ClaimedTransitionJob = {
  job: GenerationJob;
  transition: Transition;
  projectPath: string;
  fromImagePath: string;
  toImagePath: string;
  posterPath: string;
  prompt: string;
  promptRevision: number;
  fromApprovedVersionId: string;
  toApprovedVersionId: string;
};

type JobRunnerState = {
  processingFrameProjects: Set<string>;
  processingTransitionProjects: Set<string>;
};

declare global {
  var __moviegenJobRunnerState__: JobRunnerState | undefined;
}

function getJobRunnerState(): JobRunnerState {
  if (!global.__moviegenJobRunnerState__) {
    global.__moviegenJobRunnerState__ = {
      processingFrameProjects: new Set(),
      processingTransitionProjects: new Set(),
    };
  }

  return global.__moviegenJobRunnerState__;
}

function resolveFrameReferenceImages(frame: Frame, manifest: ProjectManifest) {
  if (!frame.usePreviousFrameAsReference) {
    return {
      referenceImages: frame.referenceImages,
      dependencyFrameId: null,
      dependencyVersionId: null,
    };
  }

  const orderedFrames = [...manifest.frames].sort((left, right) => left.position - right.position);
  const frameIndex = orderedFrames.findIndex((item) => item.id === frame.id);
  if (frameIndex < 0) {
    throw new Error("Frame not found");
  }

  if (frameIndex === 0) {
    return {
      referenceImages: frame.referenceImages,
      dependencyFrameId: null,
      dependencyVersionId: null,
    };
  }

  const previousFrame = orderedFrames[frameIndex - 1];
  if (!previousFrame) {
    return {
      referenceImages: frame.referenceImages,
      dependencyFrameId: null,
      dependencyVersionId: null,
    };
  }

  const previousVersion = getApprovedFrameVersion(previousFrame) ?? getLatestFrameVersion(previousFrame);
  if (!previousVersion) {
    throw new Error("Previous frame does not have a generated image to use as a reference");
  }

  return {
    referenceImages: [previousVersion.outputPath],
    dependencyFrameId: previousFrame.id,
    dependencyVersionId: previousVersion.id,
  };
}

async function claimNextQueuedFrameJob(projectPath: string): Promise<ClaimedFrameJob | null> {
  const { result } = await mutateProject(projectPath, (manifest) => {
    const job = manifest.jobs.find(
      (item) => item.kind === "frame_image" && item.status === "queued",
    );

    if (!job) {
      return null;
    }

    const frame = manifest.frames.find((item) => item.id === job.targetParentId);
    if (!frame) {
      job.status = "error";
      job.errorMessage = "Frame not found";
      job.updatedAt = nowIso();
      job.completedAt = nowIso();
      return null;
    }

    let referenceImages: string[];
    let dependencyFrameId: string | null = null;
    let dependencyVersionId: string | null = null;
    try {
      const resolvedReference = resolveFrameReferenceImages(frame, manifest);
      referenceImages = resolvedReference.referenceImages;
      dependencyFrameId = resolvedReference.dependencyFrameId;
      dependencyVersionId = resolvedReference.dependencyVersionId;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve frame reference images";
      const timestamp = nowIso();
      job.status = "error";
      job.errorMessage = message;
      job.updatedAt = timestamp;
      job.completedAt = timestamp;
      return null;
    }

    const startedAt = nowIso();
    job.status = "running";
    job.startedAt = startedAt;
    job.updatedAt = startedAt;

    return {
      job: structuredClone(job),
      frame: structuredClone(frame),
      projectPath,
      referenceImages,
      dependencyFrameId,
      dependencyVersionId,
    };
  });

  return result;
}

async function claimNextQueuedTransitionJob(projectPath: string): Promise<ClaimedTransitionJob | null> {
  const { result } = await mutateProject(projectPath, (manifest) => {
    const job = manifest.jobs.find(
      (item) => item.kind === "transition_video" && item.status === "queued",
    );

    if (!job) {
      return null;
    }

    const transition = manifest.transitions.find((item) => item.id === job.targetParentId);
    if (!transition) {
      job.status = "error";
      job.errorMessage = "Transition not found";
      job.updatedAt = nowIso();
      job.completedAt = nowIso();
      return null;
    }

    const fromFrame = manifest.frames.find((item) => item.id === transition.fromFrameId);
    const toFrame = manifest.frames.find((item) => item.id === transition.toFrameId);
    const fromApprovedVersionId =
      typeof job.requestPayload.fromApprovedVersionId === "string"
        ? job.requestPayload.fromApprovedVersionId
        : transition.confirmedFromVersionId;
    const toApprovedVersionId =
      typeof job.requestPayload.toApprovedVersionId === "string"
        ? job.requestPayload.toApprovedVersionId
        : transition.confirmedToVersionId;

    if (!fromFrame || !toFrame || !fromApprovedVersionId || !toApprovedVersionId) {
      job.status = "error";
      job.errorMessage = "Confirmed transition endpoints are missing";
      job.updatedAt = nowIso();
      job.completedAt = nowIso();
      return null;
    }

    const fromVersion = fromFrame.versions.find((item) => item.id === fromApprovedVersionId);
    const toVersion = toFrame.versions.find((item) => item.id === toApprovedVersionId);

    if (!fromVersion || !toVersion) {
      job.status = "error";
      job.errorMessage = "Confirmed frame versions are missing";
      job.updatedAt = nowIso();
      job.completedAt = nowIso();
      return null;
    }

    const startedAt = nowIso();
    job.status = "running";
    job.startedAt = startedAt;
    job.updatedAt = startedAt;

    return {
      job: structuredClone(job),
      transition: structuredClone(transition),
      projectPath,
      fromImagePath: fromVersion.outputPath,
      toImagePath: toVersion.outputPath,
      posterPath: fromVersion.thumbnailPath,
      prompt:
        typeof job.requestPayload.prompt === "string"
          ? job.requestPayload.prompt
          : transition.transitionPrompt,
      promptRevision:
        typeof job.requestPayload.promptRevision === "number"
          ? job.requestPayload.promptRevision
          : transition.promptRevision,
      fromApprovedVersionId,
      toApprovedVersionId,
    };
  });

  return result;
}

async function completeFrameJob(
  projectPath: string,
  jobId: string,
  relativePath: string,
  model: string,
  providerPredictionId: string | null,
  inputPayload: Record<string, unknown>,
  dependencyFrameId: string | null,
  dependencyVersionId: string | null,
) {
  await mutateProject(projectPath, (manifest) => {
    const job = manifest.jobs.find((item) => item.id === jobId);
    if (!job) {
      return;
    }

    const frame = manifest.frames.find((item) => item.id === job.targetParentId);
    if (!frame) {
      job.status = "error";
      job.errorMessage = "Frame not found";
      job.updatedAt = nowIso();
      job.completedAt = nowIso();
      return;
    }

    const timestamp = nowIso();
    const versionId = createId("framever");
    const sourcePrompt =
      typeof job.requestPayload.prompt === "string" ? job.requestPayload.prompt : frame.imagePrompt;
    const usePreviousFrameAsReference =
      typeof job.requestPayload.usePreviousFrameAsReference === "boolean"
        ? job.requestPayload.usePreviousFrameAsReference
        : frame.usePreviousFrameAsReference;

    job.targetId = versionId;
    job.provider = "atlas";
    job.model = model || IMAGE_MODEL;
    job.status = "completed";
    job.providerPredictionId = providerPredictionId;
    job.requestPayload = inputPayload;
    job.errorMessage = null;
    job.completedAt = timestamp;
    job.updatedAt = timestamp;

    const version: FrameVersion = {
      id: versionId,
      model: model || IMAGE_MODEL,
      inputPayload,
      outputPath: relativePath,
      thumbnailPath: relativePath,
      generationJobId: job.id,
      createdAt: timestamp,
      reviewerDecision: "unreviewed" as const,
      reviewerNotes: "",
      sourcePrompt,
      usePreviousFrameAsReference,
      dependencyFrameId,
      dependencyVersionId,
    };

    frame.versions.push(version);

    const orderedFrames = [...manifest.frames].sort((left, right) => left.position - right.position);
    const frameIndex = orderedFrames.findIndex((item) => item.id === frame.id);
    const previousFrameId = frameIndex > 0 ? orderedFrames[frameIndex - 1]?.id ?? null : null;
    const previousCurrentVersionId = previousFrameId
      ? getCurrentFrameVersionIdForManifest(manifest, previousFrameId)
      : null;
    const shouldSelectGeneratedVersion = isFrameVersionCurrentForState(
      frame,
      version,
      previousCurrentVersionId,
    );

    if (shouldSelectGeneratedVersion) {
      frame.approvedVersionId = versionId;
      version.reviewerDecision = "approved";
      for (const sibling of frame.versions) {
        if (sibling.id !== versionId && sibling.reviewerDecision === "approved") {
          sibling.reviewerDecision = "rejected";
        }
      }
    }
    frame.updatedAt = timestamp;
  });
}

async function completeTransitionJob(
  projectPath: string,
  jobId: string,
  relativePath: string,
  posterPath: string,
  model: string,
  providerPredictionId: string | null,
  inputPayload: Record<string, unknown>,
  promptRevision: number,
  fromApprovedVersionId: string,
  toApprovedVersionId: string,
) {
  await mutateProject(projectPath, (manifest) => {
    const job = manifest.jobs.find((item) => item.id === jobId);
    if (!job) {
      return;
    }

    const transition = manifest.transitions.find((item) => item.id === job.targetParentId);
    if (!transition) {
      job.status = "error";
      job.errorMessage = "Transition not found";
      job.updatedAt = nowIso();
      job.completedAt = nowIso();
      return;
    }

    const timestamp = nowIso();
    const versionId = createId("transitionver");

    job.targetId = versionId;
    job.provider = "atlas";
    job.model = model || VIDEO_MODEL;
    job.status = "completed";
    job.providerPredictionId = providerPredictionId;
    job.requestPayload = inputPayload;
    job.errorMessage = null;
    job.completedAt = timestamp;
    job.updatedAt = timestamp;

    const version: TransitionVersion = {
      id: versionId,
      model: model || VIDEO_MODEL,
      inputPayload,
      outputPath: relativePath,
      posterPath,
      generationJobId: job.id,
      createdAt: timestamp,
      reviewerDecision: "unreviewed" as const,
      reviewerNotes: "",
      promptRevision,
      fromApprovedVersionId,
      toApprovedVersionId,
    };

    transition.versions.push(version);

    const currentFromEndpointVersionId = getCurrentFrameVersionIdForManifest(
      manifest,
      transition.fromFrameId,
    );
    const currentToEndpointVersionId = getCurrentFrameVersionIdForManifest(
      manifest,
      transition.toFrameId,
    );
    const shouldSelectGeneratedVersion = isTransitionVersionCurrentForState(
      transition,
      version,
      currentFromEndpointVersionId,
      currentToEndpointVersionId,
    );

    if (shouldSelectGeneratedVersion) {
      transition.approvedVideoVersionId = versionId;
      version.reviewerDecision = "approved";
      for (const sibling of transition.versions) {
        if (sibling.id !== versionId && sibling.reviewerDecision === "approved") {
          sibling.reviewerDecision = "rejected";
        }
      }
    }
    transition.updatedAt = timestamp;
  });
}

async function failJob(projectPath: string, jobId: string, message: string) {
  await mutateProject(projectPath, (manifest) => {
    const job = manifest.jobs.find((item) => item.id === jobId);
    if (!job) {
      return;
    }

    const timestamp = nowIso();
    job.status = "error";
    job.errorMessage = message;
    job.completedAt = timestamp;
    job.updatedAt = timestamp;
  });
}

async function runQueuedFrameJobs(projectPath: string) {
  const runnerState = getJobRunnerState();
  if (runnerState.processingFrameProjects.has(projectPath)) {
    return;
  }

  runnerState.processingFrameProjects.add(projectPath);

  try {
    while (true) {
      const claimed = await claimNextQueuedFrameJob(projectPath);
      if (!claimed) {
        break;
      }

      try {
        const [asset] = await generateFrameImages({
          projectPath,
          frameId: claimed.frame.id,
          prompt: claimed.frame.imagePrompt,
          referenceImages: claimed.referenceImages,
          candidateCount: 1,
          size: String(claimed.job.requestPayload.size ?? "1280x720"),
          seedMode: String(claimed.job.requestPayload.seedMode ?? "random"),
          seed:
            typeof claimed.job.requestPayload.seed === "number"
              ? claimed.job.requestPayload.seed
              : undefined,
        });

        if (!asset) {
          throw new Error("Atlas did not return any image candidates");
        }

        await completeFrameJob(
          projectPath,
          claimed.job.id,
          asset.relativePath,
          asset.model,
          asset.providerPredictionId,
          asset.inputPayload,
          claimed.dependencyFrameId,
          claimed.dependencyVersionId,
        );
      } catch (error) {
        await failJob(
          projectPath,
          claimed.job.id,
          error instanceof Error ? error.message : "Frame generation failed",
        );
      }
    }
  } finally {
    runnerState.processingFrameProjects.delete(projectPath);

    const snapshot = await readProjectSnapshot(projectPath).catch(() => null);
    if (snapshot?.manifest.jobs.some((job) => job.kind === "frame_image" && job.status === "queued")) {
      void runQueuedFrameJobs(projectPath);
    }
  }
}

async function runQueuedTransitionJobs(projectPath: string) {
  const runnerState = getJobRunnerState();
  if (runnerState.processingTransitionProjects.has(projectPath)) {
    return;
  }

  runnerState.processingTransitionProjects.add(projectPath);

  try {
    while (true) {
      const claimed = await claimNextQueuedTransitionJob(projectPath);
      if (!claimed) {
        break;
      }

      try {
        const asset = await generateTransitionVideo({
          projectPath,
          transitionId: claimed.transition.id,
          prompt: claimed.prompt,
          fromImagePath: claimed.fromImagePath,
          toImagePath: claimed.toImagePath,
          posterPath: claimed.posterPath,
          duration: Number(claimed.job.requestPayload.duration ?? 4),
          size: String(claimed.job.requestPayload.size ?? "1280x720"),
          fps: Number(claimed.job.requestPayload.fps ?? 24),
        });

        await completeTransitionJob(
          projectPath,
          claimed.job.id,
          asset.relativePath,
          asset.posterRelativePath,
          asset.model,
          asset.providerPredictionId,
          asset.inputPayload,
          claimed.promptRevision,
          claimed.fromApprovedVersionId,
          claimed.toApprovedVersionId,
        );
      } catch (error) {
        await failJob(
          projectPath,
          claimed.job.id,
          error instanceof Error ? error.message : "Transition generation failed",
        );
      }
    }
  } finally {
    runnerState.processingTransitionProjects.delete(projectPath);

    const snapshot = await readProjectSnapshot(projectPath).catch(() => null);
    if (snapshot?.manifest.jobs.some((job) => job.kind === "transition_video" && job.status === "queued")) {
      void runQueuedTransitionJobs(projectPath);
    }
  }
}

function buildQueuedFrameJobs(frame: Frame, options: FrameGenerationOptions): GenerationJob[] {
  return Array.from({ length: options.candidateCount }, (_, index) => {
    const timestamp = nowIso();
    const seed =
      options.seedMode === "locked"
        ? index + 1
        : Math.floor(Math.random() * 2_147_483_647);

    return {
      id: createId("job"),
      kind: "frame_image",
      targetId: createId("framecand"),
      targetParentId: frame.id,
      provider: "atlas",
      model: IMAGE_MODEL,
      status: "queued",
      requestPayload: {
        frameId: frame.id,
        prompt: frame.imagePrompt,
        usePreviousFrameAsReference: frame.usePreviousFrameAsReference,
        size: options.size,
        seedMode: options.seedMode,
        seed,
      },
      providerPredictionId: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

function buildQueuedTransitionJob(
  transition: Transition,
  options: TransitionGenerationOptions,
): GenerationJob {
  const timestamp = nowIso();

  return {
    id: createId("job"),
    kind: "transition_video",
    targetId: createId("transitioncand"),
    targetParentId: transition.id,
    provider: "atlas",
    model: VIDEO_MODEL,
    status: "queued",
    requestPayload: {
      transitionId: transition.id,
      prompt: transition.transitionPrompt,
      promptRevision: transition.promptRevision,
      fromApprovedVersionId: transition.confirmedFromVersionId,
      toApprovedVersionId: transition.confirmedToVersionId,
      duration: options.duration,
      size: options.size,
      fps: options.fps,
    },
    providerPredictionId: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function enqueueFrameGeneration(
  frameIds: string[],
  options: FrameGenerationOptions,
): Promise<ProjectSnapshot> {
  const { snapshot, projectPath } = await mutateCurrentProject((manifest) => {
    const frames = manifest.frames.filter((item) => frameIds.includes(item.id));

    if (!frames.length) {
      throw new Error("No frames selected");
    }

    const timestamp = nowIso();
    for (const frame of frames) {
      manifest.jobs.push(...buildQueuedFrameJobs(frame, options));
      frame.updatedAt = timestamp;
    }
  });

  void runQueuedFrameJobs(projectPath);
  return snapshot;
}

export async function enqueueTransitionGeneration(
  transitionIds: string[],
  options: TransitionGenerationOptions,
): Promise<ProjectSnapshot> {
  const { snapshot, projectPath } = await mutateCurrentProject((manifest) => {
    const transitions = manifest.transitions.filter((item) => transitionIds.includes(item.id));

    if (!transitions.length) {
      throw new Error("No transitions selected");
    }

    const frameMap = new Map(manifest.frames.map((frame) => [frame.id, frame]));
    const timestamp = nowIso();

    for (const transition of transitions) {
      const fromFrame = frameMap.get(transition.fromFrameId) ?? null;
      const toFrame = frameMap.get(transition.toFrameId) ?? null;
      const fromEndpointVersionId = fromFrame ? getCurrentFrameVersionIdForManifest(manifest, fromFrame.id) : null;
      const toEndpointVersionId = toFrame ? getCurrentFrameVersionIdForManifest(manifest, toFrame.id) : null;

      if (!fromEndpointVersionId || !toEndpointVersionId) {
        throw new Error("Both endpoint frames need at least one generated version before generating a transition");
      }

      transition.confirmedFromVersionId = fromEndpointVersionId;
      transition.confirmedToVersionId = toEndpointVersionId;
      transition.invalidationReason = null;
      manifest.jobs.push(buildQueuedTransitionJob(transition, options));
      transition.updatedAt = timestamp;
    }
  });

  void runQueuedTransitionJobs(projectPath);
  return snapshot;
}
