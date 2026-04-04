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
  reconcileTransitions,
} from "@/lib/project-ops";
import {
  getProjectDefaultModelId,
  normalizeGenerationOverrides,
  resolveGenerationConfig,
} from "@/lib/generation-config";
import { getFrameSizeFromSettings, getTransitionSizeFromSettings } from "@/lib/generation-models";
import { mutateCurrentProject, mutateProject, readProjectSnapshot } from "@/lib/project-store";
import { generateFrameImages, generateTransitionVideo } from "@/lib/provider";
import type {
  Frame,
  FrameView,
  FrameVersion,
  GenerationOverrides,
  GenerationSnapshot,
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
      generationOverrides?: GenerationOverrides;
    }
  >;
};

type TransitionGenerationOptions = {
  duration: number;
  size: string;
  fps: number;
  cameraFixed?: boolean;
  generateAudio?: boolean;
  overridesByTransitionId?: Record<
    string,
    {
      prompt?: string;
      generationOverrides?: GenerationOverrides;
    }
  >;
};

type ClaimedFrameJob = {
  job: GenerationJob;
  frame: Frame;
  projectPath: string;
  sourcePrompt: string;
  generationSnapshot: GenerationSnapshot;
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
  sourcePrompt: string;
  generationSnapshot: GenerationSnapshot;
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
  jobAbortControllers: Map<string, AbortController>;
};

const DIRECT_UPLOAD_MODEL = "uploaded/image";

declare global {
  var __moviegenJobRunnerState__: JobRunnerState | undefined;
}

function getJobRunnerState(): JobRunnerState {
  if (!global.__moviegenJobRunnerState__) {
    global.__moviegenJobRunnerState__ = {
      processingFrameProjects: new Set(),
      processingTransitionProjects: new Set(),
      jobAbortControllers: new Map(),
    };
  }

  return global.__moviegenJobRunnerState__;
}

function readGenerationSnapshot(
  payload: Record<string, unknown>,
  assetKind: "frame" | "transition",
  fallbackPrompt: string,
) {
  const rawSnapshot = payload.generationSnapshot;
  if (
    rawSnapshot &&
    typeof rawSnapshot === "object" &&
    typeof (rawSnapshot as { modelId?: unknown }).modelId === "string" &&
    typeof (rawSnapshot as { systemPromptTemplate?: unknown }).systemPromptTemplate === "string" &&
    typeof (rawSnapshot as { resolvedPrompt?: unknown }).resolvedPrompt === "string" &&
    (rawSnapshot as { settings?: unknown }).settings &&
    typeof (rawSnapshot as { settings?: unknown }).settings === "object"
  ) {
    return rawSnapshot as GenerationSnapshot;
  }

  return resolveGenerationConfig({
    assetKind,
    prompt: fallbackPrompt,
    generationDefaults: null,
  });
}

function abortTrackedJobs(jobIds: string[]) {
  const runnerState = getJobRunnerState();

  for (const jobId of jobIds) {
    const controller = runnerState.jobAbortControllers.get(jobId);
    if (!controller) {
      continue;
    }

    controller.abort(new Error("Generation stopped"));
    runnerState.jobAbortControllers.delete(jobId);
  }
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

      const sourcePrompt =
        typeof job.requestPayload.prompt === "string" ? job.requestPayload.prompt.trim() : frame.imagePrompt.trim();
      if (!sourcePrompt) {
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
        sourcePrompt,
        generationSnapshot: readGenerationSnapshot(job.requestPayload, "frame", sourcePrompt),
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
      const sourcePrompt =
        typeof job.requestPayload.prompt === "string"
          ? job.requestPayload.prompt
          : transition.transitionPrompt;
      transition.confirmedFromVersionId = resolvedTransition.fromApprovedVersionId;
      transition.confirmedToVersionId = resolvedTransition.toApprovedVersionId;
      transition.invalidationReason = null;
      job.requestPayload = {
        ...job.requestPayload,
        prompt: sourcePrompt,
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
        sourcePrompt,
        generationSnapshot: readGenerationSnapshot(job.requestPayload, "transition", sourcePrompt),
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
  sourcePrompt: string,
  generationSnapshot: GenerationSnapshot,
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
    const usePreviousFrameAsReference =
      typeof job.requestPayload.usePreviousFrameAsReference === "boolean"
        ? job.requestPayload.usePreviousFrameAsReference
        : frame.usePreviousFrameAsReference;

    job.targetId = versionId;
    job.provider = "atlas";
    job.model = generationSnapshot.modelId || model || IMAGE_MODEL;
    job.status = "completed";
    job.providerPredictionId = providerPredictionId;
    job.requestPayload = inputPayload;
    job.errorMessage = null;
    job.completedAt = timestamp;
    job.updatedAt = timestamp;

    const version: FrameVersion = {
      id: versionId,
      model: generationSnapshot.modelId || model || IMAGE_MODEL,
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
      generationSnapshot,
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
  sourcePrompt: string,
  generationSnapshot: GenerationSnapshot,
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
    job.model = generationSnapshot.modelId || model || VIDEO_MODEL;
    job.status = "completed";
    job.providerPredictionId = providerPredictionId;
    job.requestPayload = inputPayload;
    job.errorMessage = null;
    job.completedAt = timestamp;
    job.updatedAt = timestamp;

    const version: TransitionVersion = {
      id: versionId,
      model: generationSnapshot.modelId || model || VIDEO_MODEL,
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
      generationSnapshot,
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

      const abortController = new AbortController();
      runnerState.jobAbortControllers.set(claimed.job.id, abortController);

      try {
        const [asset] = await generateFrameImages({
          projectPath,
          frameId: claimed.frame.id,
          modelId: claimed.generationSnapshot.modelId,
          prompt: claimed.generationSnapshot.resolvedPrompt,
          referenceImages: claimed.referenceImages,
          candidateCount: 1,
          size: String(claimed.job.requestPayload.size ?? "1280x720"),
          seedMode: String(claimed.job.requestPayload.seedMode ?? "random"),
          seed:
            typeof claimed.job.requestPayload.seed === "number"
              ? claimed.job.requestPayload.seed
              : undefined,
          signal: abortController.signal,
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
          claimed.sourcePrompt,
          claimed.generationSnapshot,
          claimed.dependencyFrameId,
          claimed.dependencyVersionId,
        );
      } catch (error) {
        await failJob(
          projectPath,
          claimed.job.id,
          error instanceof Error ? error.message : "Frame generation failed",
        );
      } finally {
        runnerState.jobAbortControllers.delete(claimed.job.id);
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

      const abortController = new AbortController();
      runnerState.jobAbortControllers.set(claimed.job.id, abortController);

      try {
        const asset = await generateTransitionVideo({
          projectPath,
          transitionId: claimed.transition.id,
          modelId: claimed.generationSnapshot.modelId,
          prompt: claimed.generationSnapshot.resolvedPrompt,
          fromImagePath: claimed.fromImagePath,
          toImagePath: claimed.toImagePath,
          posterPath: claimed.posterPath,
          duration: Number(claimed.job.requestPayload.duration ?? 4),
          size: String(claimed.job.requestPayload.size ?? "1280x720"),
          fps: Number(claimed.job.requestPayload.fps ?? 24),
          settings: claimed.generationSnapshot.settings,
          signal: abortController.signal,
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
          claimed.sourcePrompt,
          claimed.generationSnapshot,
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
      } finally {
        runnerState.jobAbortControllers.delete(claimed.job.id);
      }
    }
  } finally {
    runnerState.processingTransitionProjects.delete(projectPath);
  }
}

export async function importFrameAssets(
  frameId: string,
  assetPaths: string[],
  options?: { usePreviousFrameAsReference?: boolean },
): Promise<ProjectSnapshot> {
  if (assetPaths.length === 0) {
    throw new Error("No assets selected");
  }

  const { snapshot } = await mutateCurrentProject((manifest) => {
    const frame = manifest.frames.find((item) => item.id === frameId);
    if (!frame) {
      throw new Error("Frame not found");
    }

    const timestamp = nowIso();
    const usePreviousFrameAsReference =
      (options?.usePreviousFrameAsReference ?? frame.usePreviousFrameAsReference) && frame.position > 0;
    const orderedFrames = [...manifest.frames].sort((left, right) => left.position - right.position);
    const frameIndex = orderedFrames.findIndex((item) => item.id === frame.id);
    const previousFrameId = frameIndex > 0 ? orderedFrames[frameIndex - 1]?.id ?? null : null;
    const previousCurrentVersionId = previousFrameId
      ? getCurrentFrameVersionIdForManifest(manifest, previousFrameId)
      : null;

    if (options?.usePreviousFrameAsReference !== undefined) {
      frame.usePreviousFrameAsReference = usePreviousFrameAsReference;
    }

    for (const relativePath of assetPaths) {
      const assetTimestamp = nowIso();
      const versionId = createId("framever");
      const jobId = createId("job");
      const inputPayload = {
        mode: "direct_upload",
        directAssetPath: relativePath,
      } satisfies Record<string, unknown>;

      manifest.jobs.push({
        id: jobId,
        kind: "frame_image",
        targetId: versionId,
        targetParentId: frame.id,
        provider: "mock",
        model: DIRECT_UPLOAD_MODEL,
        status: "completed",
        requestPayload: inputPayload,
        providerPredictionId: null,
        errorMessage: null,
        startedAt: assetTimestamp,
        completedAt: assetTimestamp,
        createdAt: assetTimestamp,
        updatedAt: assetTimestamp,
      });

      const version: FrameVersion = {
        id: versionId,
        model: DIRECT_UPLOAD_MODEL,
        inputPayload,
        responsePayload: {
          type: "direct_upload",
          path: relativePath,
        },
        outputPath: relativePath,
        thumbnailPath: relativePath,
        generationJobId: jobId,
        createdAt: assetTimestamp,
        reviewerDecision: "unreviewed",
        reviewerNotes: "",
        sourcePrompt: null,
        usePreviousFrameAsReference,
        dependencyFrameId: null,
        dependencyVersionId: null,
      };

      frame.versions.push(version);

      const shouldSelectImportedVersion = isFrameVersionCurrentForState(
        frame,
        version,
        previousCurrentVersionId,
      );

      if (shouldSelectImportedVersion) {
        frame.approvedVersionId = versionId;
        version.reviewerDecision = "approved";
        for (const sibling of frame.versions) {
          if (sibling.id !== versionId && sibling.reviewerDecision === "approved") {
            sibling.reviewerDecision = "rejected";
          }
        }
      }
    }

    frame.updatedAt = timestamp;
    reconcileTransitions(manifest);
  });

  return snapshot;
}

function buildQueuedFrameJobs(
  frame: Frame,
  options: FrameGenerationOptions,
  sourcePrompt: string,
  usePreviousFrameAsReference: boolean,
  generationSnapshot: GenerationSnapshot,
): GenerationJob[] {
  const size = getFrameSizeFromSettings(generationSnapshot.settings, options.size);

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
      model: generationSnapshot.modelId || IMAGE_MODEL,
      status: "queued",
      requestPayload: {
        frameId: frame.id,
        prompt: sourcePrompt,
        generationSnapshot,
        usePreviousFrameAsReference,
        size,
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
  sourcePrompt: string,
  generationSnapshot: GenerationSnapshot,
): GenerationJob {
  const timestamp = nowIso();
  const size = getTransitionSizeFromSettings(generationSnapshot.settings, options.size);
  const requestPayload: Record<string, unknown> = {
    transitionId: transition.id,
    prompt: sourcePrompt,
    generationSnapshot,
    promptRevision: transition.promptRevision,
    fromApprovedVersionId: transition.confirmedFromVersionId,
    toApprovedVersionId: transition.confirmedToVersionId,
    duration: options.duration,
    size,
    fps: options.fps,
  };

  if (typeof generationSnapshot.settings.cameraFixed === "boolean") {
    requestPayload.cameraFixed = generationSnapshot.settings.cameraFixed;
  }

  if (typeof generationSnapshot.settings.generateAudio === "boolean") {
    requestPayload.generateAudio = generationSnapshot.settings.generateAudio;
  }

  return {
    id: createId("job"),
    kind: "transition_video",
    targetId: createId("transitioncand"),
    targetParentId: transition.id,
    provider: "atlas",
    model: generationSnapshot.modelId || VIDEO_MODEL,
    status: "queued",
    requestPayload,
    providerPredictionId: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function resolveFrameGenerationSnapshot(
  manifest: ProjectManifest,
  frame: Frame,
  prompt: string,
  requestOverrides?: GenerationOverrides,
) {
  return resolveGenerationConfig({
    assetKind: "frame",
    prompt,
    generationDefaults: manifest.generationDefaults,
    assetOverrides: frame.generationOverrides,
    requestOverrides,
  });
}

function resolveTransitionGenerationSnapshot(
  manifest: ProjectManifest,
  transition: Transition,
  prompt: string,
  requestOverrides?: GenerationOverrides,
) {
  return resolveGenerationConfig({
    assetKind: "transition",
    prompt,
    generationDefaults: manifest.generationDefaults,
    assetOverrides: transition.generationOverrides,
    requestOverrides,
  });
}

function getLegacyTransitionRequestOverrides(options: TransitionGenerationOptions): GenerationOverrides | undefined {
  const settings: Record<string, boolean> = {};

  if (typeof options.cameraFixed === "boolean") {
    settings.cameraFixed = options.cameraFixed;
  }

  if (typeof options.generateAudio === "boolean") {
    settings.generateAudio = options.generateAudio;
  }

  if (Object.keys(settings).length === 0) {
    return undefined;
  }

  return { settings };
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
      const sourcePrompt = overrides?.prompt ?? frame.imagePrompt;
      const usePreviousFrameAsReference =
        (overrides?.usePreviousFrameAsReference ?? frame.usePreviousFrameAsReference) && frame.position > 0;

      if (sourcePrompt.trim().length === 0) {
        throw new Error("Frame prompt is required");
      }

      if (overrides?.prompt !== undefined) {
        frame.imagePrompt = overrides.prompt;
      }

      if (overrides?.usePreviousFrameAsReference !== undefined) {
        frame.usePreviousFrameAsReference = usePreviousFrameAsReference;
      }

      if (overrides?.generationOverrides !== undefined) {
        frame.generationOverrides = normalizeGenerationOverrides(
          "frame",
          overrides.generationOverrides,
          getProjectDefaultModelId(manifest.generationDefaults, "frame"),
        );
      }

      const generationSnapshot = resolveFrameGenerationSnapshot(
        manifest,
        frame,
        sourcePrompt,
        overrides?.generationOverrides,
      );

      manifest.jobs.push(
        ...buildQueuedFrameJobs(
          frame,
          options,
          sourcePrompt,
          usePreviousFrameAsReference,
          generationSnapshot,
        ),
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
    const sharedRequestOverrides = getLegacyTransitionRequestOverrides(options);

    for (const transition of transitions) {
      const overrides = options.overridesByTransitionId?.[transition.id];
      const sourcePrompt = overrides?.prompt ?? transition.transitionPrompt;
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

      const requestOverrides =
        overrides?.generationOverrides != null || sharedRequestOverrides != null
          ? {
              ...(sharedRequestOverrides ?? {}),
              ...(overrides?.generationOverrides ?? {}),
              settings: {
                ...(sharedRequestOverrides?.settings ?? {}),
                ...(overrides?.generationOverrides?.settings ?? {}),
              },
            }
          : undefined;

      if (requestOverrides !== undefined) {
        transition.generationOverrides = normalizeGenerationOverrides(
          "transition",
          requestOverrides,
          getProjectDefaultModelId(manifest.generationDefaults, "transition"),
        );
      }

      const generationSnapshot = resolveTransitionGenerationSnapshot(
        manifest,
        transition,
        sourcePrompt,
        requestOverrides,
      );

      manifest.jobs.push(buildQueuedTransitionJob(transition, options, sourcePrompt, generationSnapshot));
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
    const sharedTransitionRequestOverrides = getLegacyTransitionRequestOverrides(input.transitionOptions);

    for (const frame of frames) {
      const prompt = frame.imagePrompt.trim();
      const usePreviousFrameAsReference = frame.usePreviousFrameAsReference && frame.position > 0;

      if (!prompt) {
        throw new Error("Frame prompt is required");
      }

      const generationSnapshot = resolveFrameGenerationSnapshot(manifest, frame, prompt);
      manifest.jobs.push(
        ...buildQueuedFrameJobs(
          frame,
          input.frameOptions,
          prompt,
          usePreviousFrameAsReference,
          generationSnapshot,
        ),
      );
      frame.updatedAt = timestamp;
    }

    for (const transition of transitions) {
      const prompt =
        input.transitionOptions.overridesByTransitionId?.[transition.id]?.prompt ?? transition.transitionPrompt;
      const overrides = input.transitionOptions.overridesByTransitionId?.[transition.id]?.generationOverrides;
      const requestOverrides =
        overrides != null || sharedTransitionRequestOverrides != null
          ? {
              ...(sharedTransitionRequestOverrides ?? {}),
              ...(overrides ?? {}),
              settings: {
                ...(sharedTransitionRequestOverrides?.settings ?? {}),
                ...(overrides?.settings ?? {}),
              },
            }
          : undefined;
      const generationSnapshot = resolveTransitionGenerationSnapshot(manifest, transition, prompt, requestOverrides);
      manifest.jobs.push(buildQueuedTransitionJob(transition, input.transitionOptions, prompt, generationSnapshot));
      transition.updatedAt = timestamp;
    }
  });

  void runQueuedFrameJobs(projectPath);
  void runQueuedTransitionJobs(projectPath);
  return snapshot;
}

export async function cancelFrameGeneration(frameId: string): Promise<ProjectSnapshot> {
  const { snapshot, result, projectPath } = await mutateCurrentProject((manifest) => {
    const canceledJobIds = manifest.jobs
      .filter(
        (job) =>
          job.kind === "frame_image" &&
          job.targetParentId === frameId &&
          (job.status === "queued" || job.status === "running"),
      )
      .map((job) => job.id);

    manifest.jobs = manifest.jobs.filter((job) => !canceledJobIds.includes(job.id));
    return canceledJobIds;
  });

  abortTrackedJobs(result);
  void runQueuedFrameJobs(projectPath);
  void runQueuedTransitionJobs(projectPath);
  return snapshot;
}

export async function cancelTransitionGeneration(transitionId: string): Promise<ProjectSnapshot> {
  const { snapshot, result, projectPath } = await mutateCurrentProject((manifest) => {
    const canceledJobIds = manifest.jobs
      .filter(
        (job) =>
          job.kind === "transition_video" &&
          job.targetParentId === transitionId &&
          (job.status === "queued" || job.status === "running"),
      )
      .map((job) => job.id);

    manifest.jobs = manifest.jobs.filter((job) => !canceledJobIds.includes(job.id));
    return canceledJobIds;
  });

  abortTrackedJobs(result);
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
