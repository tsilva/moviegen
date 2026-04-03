import type {
  Frame,
  FrameStatus,
  FrameView,
  GenerationJob,
  PersistedUiState,
  ProjectManifest,
  ProjectSnapshot,
  ReorderImpactSummary,
  Transition,
  TransitionPromptStatus,
  TransitionVideoStatus,
  TransitionView,
} from "@/lib/types";

export const IMAGE_MODEL = "alibaba/wan-2.7-pro/image-edit";
export const VIDEO_MODEL = "bytedance/seedance-v1.5-pro/image-to-video";
export const MANIFEST_FILENAME = "moviegen.project.json";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createDefaultUiState(): PersistedUiState {
  return {
    themeMode: "dark",
    viewMode: "sequence",
    selectedFrameId: null,
    selectedTransitionId: null,
    inspectorOpen: true,
    filter: "all",
  };
}

export function createEmptyManifest(name: string): ProjectManifest {
  const timestamp = nowIso();
  return {
    project: {
      id: createId("project"),
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      schemaVersion: 1,
    },
    frames: [],
    transitions: [],
    jobs: [],
    ui: createDefaultUiState(),
  };
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

export function getApprovedFrameVersion(frame: Frame) {
  return frame.versions.find((version) => version.id === frame.approvedVersionId) ?? null;
}

export function getLatestFrameVersion(frame: Frame) {
  return frame.versions.at(-1) ?? null;
}

export function getLatestTransitionVersion(transition: Transition) {
  return transition.versions.at(-1) ?? null;
}

export function getApprovedTransitionVideo(transition: Transition) {
  return (
    transition.versions.find((version) => version.id === transition.approvedVideoVersionId) ?? null
  );
}

export function deriveFrameStatus(frame: Frame, jobs: GenerationJob[]): FrameStatus {
  const frameJobs = jobs.filter((job) => job.targetParentId === frame.id);

  if (frameJobs.some((job) => job.status === "running")) {
    return "generating";
  }

  if (frameJobs.some((job) => job.status === "queued")) {
    return "queued";
  }

  if (frameJobs.some((job) => job.status === "error")) {
    return "error";
  }

  const approvedVersion = getApprovedFrameVersion(frame);
  const latestVersion = getLatestFrameVersion(frame);

  if (!latestVersion) {
    return "draft";
  }

  if (approvedVersion) {
    return approvedVersion.id === latestVersion.id ? "approved" : "needs_regen";
  }

  return "generated_unreviewed";
}

export function deriveTransitionPromptStatus(
  transition: Transition,
  frameMap: Map<string, Frame>,
): TransitionPromptStatus {
  const fromFrame = frameMap.get(transition.fromFrameId);
  const toFrame = frameMap.get(transition.toFrameId);

  if (!fromFrame || !toFrame || !fromFrame.approvedVersionId || !toFrame.approvedVersionId) {
    return "blocked";
  }

  if (!transition.transitionPrompt.trim()) {
    return "missing";
  }

  if (
    transition.confirmedFromVersionId !== fromFrame.approvedVersionId ||
    transition.confirmedToVersionId !== toFrame.approvedVersionId
  ) {
    return "needs_confirmation";
  }

  return "confirmed";
}

export function deriveTransitionVideoStatus(
  transition: Transition,
  jobs: GenerationJob[],
  frameMap: Map<string, Frame>,
): TransitionVideoStatus {
  const promptStatus = deriveTransitionPromptStatus(transition, frameMap);
  const transitionJobs = jobs.filter((job) => job.targetParentId === transition.id);

  if (promptStatus !== "confirmed") {
    return "not_ready";
  }

  if (transitionJobs.some((job) => job.status === "running")) {
    return "generating";
  }

  if (transitionJobs.some((job) => job.status === "queued")) {
    return "queued";
  }

  if (transitionJobs.some((job) => job.status === "error")) {
    return "error";
  }

  const approvedVideo = getApprovedTransitionVideo(transition);
  const latestVideo = getLatestTransitionVersion(transition);

  if (!latestVideo) {
    return "not_ready";
  }

  if (isTransitionVideoStale(transition, latestVideo, frameMap)) {
    return "stale";
  }

  if (approvedVideo) {
    return "approved";
  }

  return "generated_unreviewed";
}

export function isTransitionVideoStale(
  transition: Transition,
  version: Transition["versions"][number],
  frameMap: Map<string, Frame>,
) {
  const fromFrame = frameMap.get(transition.fromFrameId);
  const toFrame = frameMap.get(transition.toFrameId);

  return (
    transition.sequenceScope !== "active" ||
    !fromFrame ||
    !toFrame ||
    fromFrame.approvedVersionId !== version.fromApprovedVersionId ||
    toFrame.approvedVersionId !== version.toApprovedVersionId ||
    transition.promptRevision !== version.promptRevision
  );
}

export function getActiveTransitions(manifest: ProjectManifest) {
  return manifest.transitions.filter((transition) => transition.sequenceScope === "active");
}

export function buildProjectSnapshot(
  manifest: ProjectManifest,
  projectPath: string,
): ProjectSnapshot {
  const frameMap = new Map(manifest.frames.map((frame) => [frame.id, frame]));
  const frames: FrameView[] = manifest.frames.map((frame) => ({
    ...frame,
    status: deriveFrameStatus(frame, manifest.jobs),
    approvedVersion: getApprovedFrameVersion(frame),
    latestVersion: getLatestFrameVersion(frame),
    queuedJobs: manifest.jobs.filter((job) => job.targetParentId === frame.id && job.status !== "completed")
      .length,
  }));
  const frameViewMap = new Map(frames.map((frame) => [frame.id, frame]));

  const orderedTransitionKeys = new Map(
    manifest.frames
      .slice(0, -1)
      .map((frame, index) => [`${frame.id}:${manifest.frames[index + 1]?.id ?? ""}`, index]),
  );

  const transitions: TransitionView[] = getActiveTransitions(manifest)
    .sort(
      (left, right) =>
        (orderedTransitionKeys.get(`${left.fromFrameId}:${left.toFrameId}`) ?? 0) -
        (orderedTransitionKeys.get(`${right.fromFrameId}:${right.toFrameId}`) ?? 0),
    )
    .map((transition) => ({
      ...transition,
      promptStatus: deriveTransitionPromptStatus(transition, frameMap),
      videoStatus: deriveTransitionVideoStatus(transition, manifest.jobs, frameMap),
      fromFrame: frameViewMap.get(transition.fromFrameId)!,
      toFrame: frameViewMap.get(transition.toFrameId)!,
      approvedVideoVersion: getApprovedTransitionVideo(transition),
      latestVideoVersion: getLatestTransitionVersion(transition),
      isStale:
        deriveTransitionPromptStatus(transition, frameMap) !== "confirmed" ||
        (getLatestTransitionVersion(transition)
          ? isTransitionVideoStale(transition, getLatestTransitionVersion(transition)!, frameMap)
          : false),
    }));

  return {
    projectPath,
    manifest,
    frames,
    transitions,
  };
}

export function reorderFrames(manifest: ProjectManifest, orderedFrameIds: string[]) {
  const framesById = new Map(manifest.frames.map((frame) => [frame.id, frame]));
  manifest.frames = orderedFrameIds.map((frameId, index) => {
    const frame = framesById.get(frameId);

    if (!frame) {
      throw new Error(`Unknown frame ${frameId}`);
    }

    return {
      ...frame,
      position: index,
      updatedAt: nowIso(),
    };
  });

  manifest.project.updatedAt = nowIso();
}

export function moveSegment(
  manifest: ProjectManifest,
  startFrameId: string,
  targetIndex: number,
) {
  const startIndex = manifest.frames.findIndex((frame) => frame.id === startFrameId);

  if (startIndex < 0 || startIndex >= manifest.frames.length - 1) {
    throw new Error("Segment start frame must exist and have an adjacent partner");
  }

  const segment = manifest.frames.slice(startIndex, startIndex + 2);
  const remainder = manifest.frames.filter((frame) => !segment.some((item) => item.id === frame.id));
  const boundedTarget = Math.max(0, Math.min(targetIndex, remainder.length));
  remainder.splice(boundedTarget, 0, ...segment);

  reorderFrames(
    manifest,
    remainder.map((frame) => frame.id),
  );
}

export function computeImpactSummary(
  before: ProjectManifest,
  after: ProjectManifest,
): ReorderImpactSummary {
  const beforeActive = new Set(
    before.transitions
      .filter((transition) => transition.sequenceScope === "active")
      .map((transition) => `${transition.fromFrameId}:${transition.toFrameId}`),
  );
  const afterActiveTransitions = after.transitions.filter((transition) => transition.sequenceScope === "active");
  const afterActive = new Set(
    afterActiveTransitions.map((transition) => `${transition.fromFrameId}:${transition.toFrameId}`),
  );
  const afterFrameMap = new Map(after.frames.map((frame) => [frame.id, frame]));

  let preservedTransitions = 0;
  let newTransitions = 0;
  let transitionsNeedingConfirmation = 0;
  let videosMarkedStale = 0;

  for (const transition of afterActiveTransitions) {
    const key = `${transition.fromFrameId}:${transition.toFrameId}`;

    if (beforeActive.has(key)) {
      preservedTransitions += 1;
    } else {
      newTransitions += 1;
    }

    if (deriveTransitionPromptStatus(transition, afterFrameMap) === "needs_confirmation") {
      transitionsNeedingConfirmation += 1;
    }

    if (
      transition.versions.some((version) => isTransitionVideoStale(transition, version, afterFrameMap))
    ) {
      videosMarkedStale += 1;
    }
  }

  const archivedTransitions = [...beforeActive].filter((key) => !afterActive.has(key)).length;

  return {
    preservedTransitions,
    newTransitions,
    archivedTransitions,
    transitionsNeedingConfirmation,
    videosMarkedStale,
  };
}

export function reconcileTransitions(manifest: ProjectManifest) {
  const activePairs = manifest.frames.slice(0, -1).map((frame, index) => ({
    fromFrameId: frame.id,
    toFrameId: manifest.frames[index + 1]!.id,
  }));
  const desiredKeys = new Set(activePairs.map((pair) => `${pair.fromFrameId}:${pair.toFrameId}`));
  const usedTransitionIds = new Set<string>();
  const timestamp = nowIso();
  const frameMap = new Map(manifest.frames.map((frame) => [frame.id, frame]));

  for (const pair of activePairs) {
    const existing =
      manifest.transitions.find(
        (transition) =>
          transition.sequenceScope === "active" &&
          transition.fromFrameId === pair.fromFrameId &&
          transition.toFrameId === pair.toFrameId,
      ) ??
      [...manifest.transitions]
        .reverse()
        .find(
          (transition) =>
            !usedTransitionIds.has(transition.id) &&
            transition.fromFrameId === pair.fromFrameId &&
            transition.toFrameId === pair.toFrameId,
        );

    if (existing) {
      existing.sequenceScope = "active";
      existing.updatedAt = timestamp;
      const fromFrame = frameMap.get(existing.fromFrameId) ?? null;
      const toFrame = frameMap.get(existing.toFrameId) ?? null;
      existing.invalidationReason =
        fromFrame?.approvedVersionId !== existing.confirmedFromVersionId ||
        toFrame?.approvedVersionId !== existing.confirmedToVersionId
          ? "endpoint_versions_changed"
          : null;
      usedTransitionIds.add(existing.id);
      continue;
    }

    manifest.transitions.push({
      id: createId("transition"),
      fromFrameId: pair.fromFrameId,
      toFrameId: pair.toFrameId,
      transitionPrompt: "",
      promptRevision: 0,
      confirmedFromVersionId: null,
      confirmedToVersionId: null,
      approvedVideoVersionId: null,
      invalidationReason: null,
      sequenceScope: "active",
      versions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  for (const transition of manifest.transitions) {
    const key = `${transition.fromFrameId}:${transition.toFrameId}`;
    if (!desiredKeys.has(key)) {
      transition.sequenceScope = "archived";
      transition.invalidationReason = "adjacency_changed";
      transition.updatedAt = timestamp;
      continue;
    }

    transition.sequenceScope = "active";
  }
}

export function markTransitionsStaleForFrame(manifest: ProjectManifest, frameId: string) {
  const frame = manifest.frames.find((item) => item.id === frameId);
  if (!frame) {
    return;
  }

  for (const transition of manifest.transitions) {
    if (transition.fromFrameId === frameId || transition.toFrameId === frameId) {
      transition.updatedAt = nowIso();
      transition.invalidationReason = "endpoint_versions_changed";
    }
  }
}
