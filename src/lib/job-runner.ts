import {
  IMAGE_MODEL,
  VIDEO_MODEL,
  buildProjectSnapshot,
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
  FrameView,
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
  overridesByFrameId?: Record<
    string,
    {
      prompt?: string;
      usePreviousFrameAsReference?: boolean;
    }
  >;
};

type TransitionGenerationOptions = {
  duration: number;
  size: string;
  fps: number;
  overridesByTransitionId?: Record<
    string,
    {
      prompt?: string;
    }
  >;
};

type ClaimedFrameJob = {
  job: GenerationJob;
  frame: Frame;
  projectPath: string;
  prompt: string;
  usePreviousFrameAsReference: boolean;
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

type PendingReferenceResolution =
  | {
      status: "ready";
      referenceImages: string[];
      dependencyFrameId: string | null;
      dependencyVersionId: string | null;
    }
  | {
      status: "waiting";
    }
  | {
      status: "error";
      message: string;
    };

type PendingTransitionResolution =
  | {
      status: "ready";
      fromApprovedVersionId: string;
      toApprovedVersionId: string;
      fromImagePath: string;
      toImagePath: string;
      posterPath: string;
    }
  | {
      status: "waiting";
    }
  | {
      status: "error";
      message: string;
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

function resolveFrameReferenceImages(
  frame: Frame,
  manifest: ProjectManifest,
  usePreviousFrameAsReference: boolean,
): PendingReferenceResolution {
  if (!usePreviousFrameAsReference) {
    return {
      status: "ready",
      referenceImages: frame.referenceImages,
      dependencyFrameId: null,
      dependencyVersionId: null,
    };
  }

  const orderedFrames = [...manifest.frames].sort((left, right) => left.position - right.position);
  const frameIndex = orderedFrames.findIndex((item) => item.id === frame.id);
  if (frameIndex < 0) {
    return {
      status: "error",
      message: "Frame not found",
    };
  }

  if (frameIndex === 0) {
    return {
      status: "ready",
      referenceImages: frame.referenceImages,
      dependencyFrameId: null,
      dependencyVersionId: null,
    };
  }

  const previousFrame = orderedFrames[frameIndex - 1];
  if (!previousFrame) {
    return {
      status: "ready",
      referenceImages: frame.referenceImages,
      dependencyFrameId: null,
      dependencyVersionId: null,
    };
  }

  const previousVersionId = getCurrentFrameVersionIdForManifest(manifest, previousFrame.id);
  const previousVersion =
    previousFrame.versions.find((item) => item.id === previousVersionId) ??
    getApprovedFrameVersion(previousFrame) ??
    getLatestFrameVersion(previousFrame);
  if (!previousVersion) {
    const previousFrameHasPendingGeneration = manifest.jobs.some(
      (job) =>
        job.kind === "frame_image" &&
        job.targetParentId === previousFrame.id &&
        (job.status === "queued" || job.status === "running"),
    );

    if (previousFrameHasPendingGeneration) {
      return {
        status: "waiting",
      };
    }

    return {
      status: "error",
      message: "Previous frame does not have a generated image to use as a reference",
    };
  }

  return {
    status: "ready",
    referenceImages: [previousVersion.outputPath],
    dependencyFrameId: previousFrame.id,
    dependencyVersionId: previousVersion.id,
  };
}

async function claimNextQueuedFrameJob(projectPath: string): Promise<ClaimedFrameJob | null> {
  const { result } = await mutateProject(projectPath, (manifest) => {
    for (const job of manifest.jobs) {
      if (job.kind !== "frame_image" || job.status !== "queued") {
        continue;
      }

      const frame = manifest.frames.find((item) => item.id === job.targetParentId);
      if (!frame) {
        const timestamp = nowIso();
        job.status = "error";
        job.errorMessage = "Frame not found";
        job.updatedAt = timestamp;
        job.completedAt = timestamp;
        continue;
      }

      const prompt =
        typeof job.requestPayload.prompt === "string" ? job.requestPayload.prompt.trim() : frame.imagePrompt.trim();
      if (!prompt) {
        const timestamp = nowIso();
        job.status = "error";
        job.errorMessage = "Frame prompt is required";
        job.updatedAt = timestamp;
        job.completedAt = timestamp;
        continue;
      }

      const usePreviousFrameAsReference =
        typeof job.requestPayload.usePreviousFrameAsReference === "boolean"
          ? job.requestPayload.usePreviousFrameAsReference && frame.position > 0
          : frame.usePreviousFrameAsReference && frame.position > 0;

      const resolvedReference = resolveFrameReferenceImages(
        frame,
        manifest,
        usePreviousFrameAsReference,
      );
      if (resolvedReference.status === "waiting") {
        continue;
      }

      if (resolvedReference.status === "error") {
        const timestamp = nowIso();
        job.status = "error";
        job.errorMessage = resolvedReference.message;
        job.updatedAt = timestamp;
        job.completedAt = timestamp;
        continue;
      }

      const startedAt = nowIso();
      job.status = "running";
      job.startedAt = startedAt;
      job.updatedAt = startedAt;

      return {
        job: structuredClone(job),
        frame: structuredClone(frame),
        projectPath,
        prompt,
        usePreviousFrameAsReference,
        referenceImages: resolvedReference.referenceImages,
        dependencyFrameId: resolvedReference.dependencyFrameId,
        dependencyVersionId: resolvedReference.dependencyVersionId,
      };
    }

    return null;
  });

  return result;
}

function resolveQueuedTransitionJob(
  manifest: ProjectManifest,
  transition: Transition,
  job: GenerationJob,
): PendingTransitionResolution {
  const snapshot = buildProjectSnapshot(manifest, "/tmp/moviegen-runner");
  const frameViewMap = new Map(snapshot.frames.map((frame) => [frame.id, frame]));
  const fromFrame = manifest.frames.find((item) => item.id === transition.fromFrameId) ?? null;
  const toFrame = manifest.frames.find((item) => item.id === transition.toFrameId) ?? null;

  if (!fromFrame || !toFrame) {
    return {
      status: "error",
      message: "Transition endpoints are missing",
    };
  }

  const queuedFromVersionId =
    typeof job.requestPayload.fromApprovedVersionId === "string"
      ? job.requestPayload.fromApprovedVersionId
      : null;
  const queuedToVersionId =
    typeof job.requestPayload.toApprovedVersionId === "string"
      ? job.requestPayload.toApprovedVersionId
      : null;

  const fromApprovedVersionId =
    queuedFromVersionId ??
    getCurrentFrameVersionIdForManifest(manifest, transition.fromFrameId);
  const toApprovedVersionId =
    queuedToVersionId ??
    getCurrentFrameVersionIdForManifest(manifest, transition.toFrameId);

  if (!fromApprovedVersionId || !toApprovedVersionId) {
    const blockedFrames = [transition.fromFrameId, transition.toFrameId]
      .map((frameId) => frameViewMap.get(frameId) ?? null)
      .filter((frame): frame is FrameView => frame != null && frame.currentVersion == null);

    const waitingOnActiveGeneration = blockedFrames.some(
      (frame) =>
        frame.status === "queued" ||
        frame.status === "generating" ||
        frame.status === "blocked_upstream",
    );

    if (waitingOnActiveGeneration) {
      return {
        status: "waiting",
      };
    }

    return {
      status: "error",
      message: "Confirmed transition endpoints are missing",
    };
  }

  const fromVersion = fromFrame.versions.find((item) => item.id === fromApprovedVersionId) ?? null;
  const toVersion = toFrame.versions.find((item) => item.id === toApprovedVersionId) ?? null;

  if (!fromVersion || !toVersion) {
    return {
      status: "error",
      message: "Confirmed frame versions are missing",
    };
  }

  return {
    status: "ready",
    fromApprovedVersionId,
    toApprovedVersionId,
    fromImagePath: fromVersion.outputPath,
    toImagePath: toVersion.outputPath,
    posterPath: fromVersion.thumbnailPath,
  };
}

async function claimNextQueuedTransitionJob(projectPath: string): Promise<ClaimedTransitionJob | null> {
  const { result } = await mutateProject(projectPath, (manifest) => {
    for (const job of manifest.jobs) {
      if (job.kind !== "transition_video" || job.status !== "queued") {
        continue;
      }

      const transition = manifest.transitions.find((item) => item.id === job.targetParentId);
      if (!transition) {
        const timestamp = nowIso();
        job.status = "error";
        job.errorMessage = "Transition not found";
        job.updatedAt = timestamp;
        job.completedAt = timestamp;
        continue;
      }

      const resolvedTransition = resolveQueuedTransitionJob(manifest, transition, job);
      if (resolvedTransition.status === "waiting") {
        continue;
      }

      if (resolvedTransition.status === "error") {
        const timestamp = nowIso();
        job.status = "error";
        job.errorMessage = resolvedTransition.message;
        job.updatedAt = timestamp;
        job.completedAt = timestamp;
        continue;
      }

      const startedAt = nowIso();
      transition.confirmedFromVersionId = resolvedTransition.fromApprovedVersionId;
      transition.confirmedToVersionId = resolvedTransition.toApprovedVersionId;
      transition.invalidationReason = null;
      job.requestPayload = {
        ...job.requestPayload,
        prompt:
          typeof job.requestPayload.prompt === "string"
            ? job.requestPayload.prompt
            : transition.transitionPrompt,
        promptRevision:
          typeof job.requestPayload.promptRevision === "number"
            ? job.requestPayload.promptRevision
            : transition.promptRevision,
        fromApprovedVersionId: resolvedTransition.fromApprovedVersionId,
        toApprovedVersionId: resolvedTransition.toApprovedVersionId,
      };
      job.status = "running";
      job.startedAt = startedAt;
      job.updatedAt = startedAt;

      return {
        job: structuredClone(job),
        transition: structuredClone(transition),
        projectPath,
        fromImagePath: resolvedTransition.fromImagePath,
        toImagePath: resolvedTransition.toImagePath,
        posterPath: resolvedTransition.posterPath,
        prompt:
          typeof job.requestPayload.prompt === "string"
            ? job.requestPayload.prompt
            : transition.transitionPrompt,
        promptRevision:
          typeof job.requestPayload.promptRevision === "number"
            ? job.requestPayload.promptRevision
            : transition.promptRevision,
        fromApprovedVersionId: resolvedTransition.fromApprovedVersionId,
        toApprovedVersionId: resolvedTransition.toApprovedVersionId,
      };
    }

    return null;
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
  responsePayload: unknown,
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
      responsePayload,
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

  void runQueuedFrameJobs(projectPath);
  void runQueuedTransitionJobs(projectPath);
}

async function completeTransitionJob(
  projectPath: string,
  jobId: string,
  relativePath: string,
  posterPath: string,
  model: string,
  providerPredictionId: string | null,
  inputPayload: Record<string, unknown>,
  responsePayload: unknown,
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
    const sourcePrompt =
      typeof job.requestPayload.prompt === "string" ? job.requestPayload.prompt : transition.transitionPrompt;

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
      responsePayload,
      outputPath: relativePath,
      posterPath,
      generationJobId: job.id,
      createdAt: timestamp,
      reviewerDecision: "unreviewed" as const,
      reviewerNotes: "",
      sourcePrompt,
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

  void runQueuedTransitionJobs(projectPath);
}

async function failJob(projectPath: string, jobId: string, message: string) {
  const { result } = await mutateProject(projectPath, (manifest) => {
    const job = manifest.jobs.find((item) => item.id === jobId);
    if (!job) {
      return null;
    }

    const timestamp = nowIso();
    job.status = "error";
    job.errorMessage = message;
    job.completedAt = timestamp;
    job.updatedAt = timestamp;
    return job.kind;
  });

  if (result === "frame_image") {
    void runQueuedFrameJobs(projectPath);
    void runQueuedTransitionJobs(projectPath);
  } else if (result === "transition_video") {
    void runQueuedTransitionJobs(projectPath);
  }
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
          prompt: claimed.prompt,
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
          asset.responsePayload,
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
          asset.responsePayload,
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
  }
}

function buildQueuedFrameJobs(
  frame: Frame,
  options: FrameGenerationOptions,
  prompt: string,
  usePreviousFrameAsReference: boolean,
): GenerationJob[] {
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
        prompt,
        usePreviousFrameAsReference,
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
  prompt: string,
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
      prompt,
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
      const overrides = options.overridesByFrameId?.[frame.id];
      const prompt = overrides?.prompt ?? frame.imagePrompt;
      const usePreviousFrameAsReference =
        (overrides?.usePreviousFrameAsReference ?? frame.usePreviousFrameAsReference) && frame.position > 0;

      if (prompt.trim().length === 0) {
        throw new Error("Frame prompt is required");
      }

      if (overrides?.prompt !== undefined) {
        frame.imagePrompt = overrides.prompt;
      }

      if (overrides?.usePreviousFrameAsReference !== undefined) {
        frame.usePreviousFrameAsReference = usePreviousFrameAsReference;
      }

      manifest.jobs.push(
        ...buildQueuedFrameJobs(frame, options, prompt, usePreviousFrameAsReference),
      );
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
      const prompt = options.overridesByTransitionId?.[transition.id]?.prompt ?? transition.transitionPrompt;
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
      manifest.jobs.push(buildQueuedTransitionJob(transition, options, prompt));
      transition.updatedAt = timestamp;
    }
  });

  void runQueuedTransitionJobs(projectPath);
  return snapshot;
}

export async function enqueueProjectStartupGeneration(input: {
  frameIds: string[];
  transitionIds: string[];
  frameOptions: FrameGenerationOptions;
  transitionOptions: TransitionGenerationOptions;
}): Promise<ProjectSnapshot> {
  const { snapshot, projectPath } = await mutateCurrentProject((manifest) => {
    const frames = manifest.frames.filter((item) => input.frameIds.includes(item.id));
    if (!frames.length) {
      throw new Error("No frames selected");
    }

    const transitions = manifest.transitions.filter((item) => input.transitionIds.includes(item.id));
    const timestamp = nowIso();

    for (const frame of frames) {
      const prompt = frame.imagePrompt.trim();
      const usePreviousFrameAsReference = frame.usePreviousFrameAsReference && frame.position > 0;

      if (!prompt) {
        throw new Error("Frame prompt is required");
      }

      manifest.jobs.push(
        ...buildQueuedFrameJobs(frame, input.frameOptions, prompt, usePreviousFrameAsReference),
      );
      frame.updatedAt = timestamp;
    }

    for (const transition of transitions) {
      const prompt =
        input.transitionOptions.overridesByTransitionId?.[transition.id]?.prompt ?? transition.transitionPrompt;
      manifest.jobs.push(buildQueuedTransitionJob(transition, input.transitionOptions, prompt));
      transition.updatedAt = timestamp;
    }
  });

  void runQueuedFrameJobs(projectPath);
  void runQueuedTransitionJobs(projectPath);
  return snapshot;
}

export async function resumeProjectJobs(projectPath: string): Promise<ProjectSnapshot> {
  const runnerState = getJobRunnerState();
  const needsFrameRecovery = !runnerState.processingFrameProjects.has(projectPath);
  const needsTransitionRecovery = !runnerState.processingTransitionProjects.has(projectPath);

  let snapshot = await readProjectSnapshot(projectPath);
  const hasRecoverableRunningJobs = snapshot.manifest.jobs.some(
    (job) =>
      job.status === "running" &&
      ((job.kind === "frame_image" && needsFrameRecovery) ||
        (job.kind === "transition_video" && needsTransitionRecovery)),
  );

  if (hasRecoverableRunningJobs) {
    snapshot = (
      await mutateProject(projectPath, (manifest) => {
        for (const job of manifest.jobs) {
          const shouldRecover =
            job.status === "running" &&
            ((job.kind === "frame_image" && needsFrameRecovery) ||
              (job.kind === "transition_video" && needsTransitionRecovery));

          if (!shouldRecover) {
            continue;
          }

          const timestamp = nowIso();
          job.status = "queued";
          job.startedAt = null;
          job.completedAt = null;
          job.errorMessage = null;
          job.updatedAt = timestamp;
        }
      })
    ).snapshot;
  }

  if (snapshot.manifest.jobs.some((job) => job.kind === "frame_image" && job.status === "queued")) {
    void runQueuedFrameJobs(projectPath);
  }

  if (snapshot.manifest.jobs.some((job) => job.kind === "transition_video" && job.status === "queued")) {
    void runQueuedTransitionJobs(projectPath);
  }

  return snapshot;
}
