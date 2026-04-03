import type {
  Frame,
  FrameNextAction,
  FrameStatus,
  FrameVersion,
  FrameView,
  GenerationJob,
  PersistedUiState,
  ProjectManifest,
  ProjectSnapshot,
  ReorderImpactSummary,
  Transition,
  TransitionNextAction,
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
    filter: "needsRepair",
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

export function getTransitionEndpointVersion(frame: Frame) {
  return getApprovedFrameVersion(frame) ?? getLatestFrameVersion(frame);
}

export function getTransitionEndpointVersionId(frame: Frame) {
  return getTransitionEndpointVersion(frame)?.id ?? null;
}

export function getLatestTransitionVersion(transition: Transition) {
  return transition.versions.at(-1) ?? null;
}

export function getApprovedTransitionVideo(transition: Transition) {
  return transition.versions.find((version) => version.id === transition.approvedVideoVersionId) ?? null;
}

function getFrameJobs(frameId: string, jobs: GenerationJob[]) {
  return jobs.filter((job) => job.targetParentId === frameId);
}

function frameVersionMatchesCurrentState(
  frame: Frame,
  version: FrameVersion,
  previousCurrentVersionId: string | null,
) {
  if (version.sourcePrompt != null && version.sourcePrompt !== frame.imagePrompt) {
    return false;
  }

  if (
    version.usePreviousFrameAsReference != null &&
    version.usePreviousFrameAsReference !== frame.usePreviousFrameAsReference
  ) {
    return false;
  }

  if (!frame.usePreviousFrameAsReference || frame.position === 0) {
    return true;
  }

  if (!previousCurrentVersionId) {
    return false;
  }

  return version.dependencyVersionId == null || version.dependencyVersionId === previousCurrentVersionId;
}

export function isFrameVersionCurrentForState(
  frame: Frame,
  version: FrameVersion | null,
  previousCurrentVersionId: string | null,
) {
  if (!version) {
    return false;
  }

  return frameVersionMatchesCurrentState(frame, version, previousCurrentVersionId);
}

export function getFrameGalleryVersions(
  frame: Frame,
  previousCurrentVersionId: string | null,
) {
  return frame.versions
    .filter((version) => frameVersionMatchesCurrentState(frame, version, previousCurrentVersionId))
    .slice()
    .reverse();
}

function getCurrentFrameVersion(
  frame: Frame,
  previousCurrentVersionId: string | null,
): FrameVersion | null {
  for (let index = frame.versions.length - 1; index >= 0; index -= 1) {
    const version = frame.versions[index];
    if (version && frameVersionMatchesCurrentState(frame, version, previousCurrentVersionId)) {
      return version;
    }
  }

  return null;
}

function isFrameBlockedByUpstream(frame: Frame, previousFrame: FrameView | null) {
  if (!frame.usePreviousFrameAsReference || frame.position === 0 || !previousFrame) {
    return false;
  }

  return previousFrame.currentVersion == null || previousFrame.status === "blocked_upstream";
}

export function deriveFrameStatus(input: {
  frame: Frame;
  currentVersion: FrameVersion | null;
  latestVersion: FrameVersion | null;
  jobs: GenerationJob[];
  blockedByFrameId: string | null;
  hasCurrentApproval: boolean;
}): FrameStatus {
  const { frame, currentVersion, latestVersion, jobs, blockedByFrameId, hasCurrentApproval } = input;

  if (jobs.some((job) => job.status === "running")) {
    return "generating";
  }

  if (jobs.some((job) => job.status === "queued")) {
    return "queued";
  }

  if (blockedByFrameId) {
    return "blocked_upstream";
  }

  if (!currentVersion) {
    if (jobs.some((job) => job.status === "error")) {
      return "error";
    }

    if (latestVersion || frame.versions.length > 0) {
      return "stale_dependency";
    }

    return "draft";
  }

  if (jobs.some((job) => job.status === "error")) {
    return "error";
  }

  if (hasCurrentApproval) {
    return "approved";
  }

  return "generated_unreviewed";
}

export function deriveFrameNextAction(status: FrameStatus): FrameNextAction {
  if (status === "draft" || status === "stale_dependency" || status === "error") {
    return "generate";
  }

  return null;
}

export function deriveFrameDisabledReason(frame: FrameView) {
  if (frame.status === "blocked_upstream" && frame.blockedByFrameId) {
    return `Waiting on Frame ${frame.position} to produce a current output`;
  }

  if (frame.status === "queued" || frame.status === "generating") {
    return "Generation already in progress";
  }

  return null;
}

function buildFrameViews(manifest: ProjectManifest) {
  const orderedFrames = [...manifest.frames].sort((left, right) => left.position - right.position);
  const frames: FrameView[] = [];

  for (const frame of orderedFrames) {
    const previousFrame = frames.at(-1) ?? null;
    const approvedVersion = getApprovedFrameVersion(frame);
    const latestVersion = getLatestFrameVersion(frame);
    const previousCurrentVersionId = previousFrame?.currentVersion?.id ?? null;
    const latestMatchingVersion = getCurrentFrameVersion(frame, previousCurrentVersionId);
    const galleryVersions = getFrameGalleryVersions(frame, previousCurrentVersionId);
    const hasCurrentApproval = isFrameVersionCurrentForState(
      frame,
      approvedVersion,
      previousCurrentVersionId,
    );
    const currentVersion = hasCurrentApproval ? approvedVersion : latestMatchingVersion;
    const blockedByFrameId = isFrameBlockedByUpstream(frame, previousFrame) ? previousFrame?.id ?? null : null;
    const jobs = getFrameJobs(frame.id, manifest.jobs);
    const status = deriveFrameStatus({
      frame,
      currentVersion,
      latestVersion,
      jobs,
      blockedByFrameId,
      hasCurrentApproval,
    });

    frames.push({
      ...frame,
      status,
      approvedVersion,
      latestVersion,
      currentVersion,
      galleryVersions,
      hasCurrentApproval,
      queuedJobs: jobs.filter((job) => job.status !== "completed").length,
      nextAction: deriveFrameNextAction(status),
      dependsOnPreviousFrame: frame.usePreviousFrameAsReference && frame.position > 0,
      blockedByFrameId,
      downstreamImpactCount: 0,
      queueRank: frame.position * 2,
      disabledReason: null,
    });
  }

  for (let index = 0; index < frames.length; index += 1) {
    let downstreamImpactCount = 0;
    for (let nextIndex = index + 1; nextIndex < frames.length; nextIndex += 1) {
      if (!frames[nextIndex]?.dependsOnPreviousFrame) {
        break;
      }
      downstreamImpactCount += 1;
    }

    const frame = frames[index];
    if (frame) {
      frame.downstreamImpactCount = downstreamImpactCount;
      frame.disabledReason = deriveFrameDisabledReason(frame);
    }
  }

  return frames;
}

export function getCurrentFrameVersionIdForManifest(
  manifest: ProjectManifest,
  frameId: string,
) {
  return buildFrameViews(manifest).find((frame) => frame.id === frameId)?.currentVersion?.id ?? null;
}

export function deriveTransitionPromptStatus(
  transition: Transition,
  frameViewMap: Map<string, FrameView>,
  blockedByFrameIds: string[],
): TransitionPromptStatus {
  const fromFrame = frameViewMap.get(transition.fromFrameId) ?? null;
  const toFrame = frameViewMap.get(transition.toFrameId) ?? null;
  const fromEndpointVersionId = fromFrame?.currentVersion?.id ?? null;
  const toEndpointVersionId = toFrame?.currentVersion?.id ?? null;

  if (!fromFrame || !toFrame || blockedByFrameIds.length > 0 || !fromEndpointVersionId || !toEndpointVersionId) {
    return "blocked";
  }

  if (
    transition.confirmedFromVersionId !== fromEndpointVersionId ||
    transition.confirmedToVersionId !== toEndpointVersionId
  ) {
    return "needs_confirmation";
  }

  return "confirmed";
}

function getCurrentTransitionVideo(
  transition: Transition,
  fromEndpointVersionId: string | null,
  toEndpointVersionId: string | null,
) {
  for (let index = transition.versions.length - 1; index >= 0; index -= 1) {
    const version = transition.versions[index];
    if (
      version &&
      version.promptRevision === transition.promptRevision &&
      version.fromApprovedVersionId === fromEndpointVersionId &&
      version.toApprovedVersionId === toEndpointVersionId
    ) {
      return version;
    }
  }

  return null;
}

export function isTransitionVersionCurrentForState(
  transition: Transition,
  version: Transition["versions"][number] | null,
  fromEndpointVersionId: string | null,
  toEndpointVersionId: string | null,
) {
  if (!version) {
    return false;
  }

  return (
    version.promptRevision === transition.promptRevision &&
    version.fromApprovedVersionId === fromEndpointVersionId &&
    version.toApprovedVersionId === toEndpointVersionId
  );
}

export function getTransitionGalleryVersions(
  transition: Transition,
  fromEndpointVersionId: string | null,
  toEndpointVersionId: string | null,
) {
  return transition.versions
    .filter((version) =>
      isTransitionVersionCurrentForState(
        transition,
        version,
        fromEndpointVersionId,
        toEndpointVersionId,
      ),
    )
    .slice()
    .reverse();
}

export function deriveTransitionVideoStatus(input: {
  transition: Transition;
  jobs: GenerationJob[];
  blockedByFrameIds: string[];
  currentVideo: Transition["versions"][number] | null;
  hasCurrentApproval: boolean;
}): TransitionVideoStatus {
  const { transition, jobs, blockedByFrameIds, currentVideo, hasCurrentApproval } = input;

  if (jobs.some((job) => job.status === "running")) {
    return "generating";
  }

  if (jobs.some((job) => job.status === "queued")) {
    return "queued";
  }

  if (jobs.some((job) => job.status === "error")) {
    return "error";
  }

  if (blockedByFrameIds.length > 0) {
    return transition.versions.length > 0 ? "stale" : "not_ready";
  }

  if (!currentVideo) {
    return transition.versions.length > 0 || transition.invalidationReason ? "stale" : "not_ready";
  }

  if (hasCurrentApproval) {
    return "approved";
  }

  return "generated_unreviewed";
}

export function deriveTransitionNextAction(input: {
  transition: Transition;
  promptStatus: TransitionPromptStatus;
  videoStatus: TransitionVideoStatus;
  blockedByFrameIds: string[];
}): TransitionNextAction {
  const { promptStatus, videoStatus, blockedByFrameIds } = input;

  if (blockedByFrameIds.length > 0 || promptStatus === "blocked") {
    return null;
  }

  if (videoStatus === "error" || videoStatus === "stale" || videoStatus === "not_ready") {
    return "generate";
  }

  return null;
}

export function deriveTransitionDisabledReason(transition: TransitionView) {
  if (transition.blockedByFrameIds.length > 0) {
    const labels = transition.blockedByFrameIds
      .map((frameId) => transition.fromFrame.id === frameId ? transition.fromFrame : transition.toFrame.id === frameId ? transition.toFrame : null)
      .filter((frame): frame is FrameView => frame != null)
      .map((frame) => `Frame ${frame.position + 1}`);

    if (labels.length > 0) {
      return `Waiting on ${labels.join(" & ")}`;
    }
  }

  if (transition.videoStatus === "queued" || transition.videoStatus === "generating") {
    return "Transition generation already in progress";
  }

  return null;
}

export function isTransitionVideoStale(
  transition: Transition,
  version: Transition["versions"][number],
  frameViewMap: Map<string, FrameView>,
) {
  const fromEndpointVersionId = frameViewMap.get(transition.fromFrameId)?.currentVersion?.id ?? null;
  const toEndpointVersionId = frameViewMap.get(transition.toFrameId)?.currentVersion?.id ?? null;

  return (
    transition.sequenceScope !== "active" ||
    !fromEndpointVersionId ||
    !toEndpointVersionId ||
    fromEndpointVersionId !== version.fromApprovedVersionId ||
    toEndpointVersionId !== version.toApprovedVersionId ||
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
  const frames = buildFrameViews(manifest);
  const frameViewMap = new Map(frames.map((frame) => [frame.id, frame]));

  const orderedTransitionKeys = new Map(
    frames
      .slice(0, -1)
      .map((frame, index) => [`${frame.id}:${frames[index + 1]?.id ?? ""}`, index]),
  );

  const transitions: TransitionView[] = getActiveTransitions(manifest)
    .sort(
      (left, right) =>
        (orderedTransitionKeys.get(`${left.fromFrameId}:${left.toFrameId}`) ?? 0) -
        (orderedTransitionKeys.get(`${right.fromFrameId}:${right.toFrameId}`) ?? 0),
    )
    .map((transition) => {
      const fromFrame = frameViewMap.get(transition.fromFrameId)!;
      const toFrame = frameViewMap.get(transition.toFrameId)!;
      const blockedByFrameIds = [fromFrame, toFrame]
        .filter((frame) => frame.currentVersion == null || frame.status === "blocked_upstream")
        .map((frame) => frame.id);
      const promptStatus = deriveTransitionPromptStatus(transition, frameViewMap, blockedByFrameIds);
      const approvedVideoVersion = getApprovedTransitionVideo(transition);
      const latestVideoVersion = getLatestTransitionVersion(transition);
      const latestMatchingVideo = getCurrentTransitionVideo(
        transition,
        fromFrame.currentVersion?.id ?? null,
        toFrame.currentVersion?.id ?? null,
      );
      const galleryVersions = getTransitionGalleryVersions(
        transition,
        fromFrame.currentVersion?.id ?? null,
        toFrame.currentVersion?.id ?? null,
      );
      const hasCurrentApproval = isTransitionVersionCurrentForState(
        transition,
        approvedVideoVersion,
        fromFrame.currentVersion?.id ?? null,
        toFrame.currentVersion?.id ?? null,
      );
      const currentVideo = hasCurrentApproval ? approvedVideoVersion : latestMatchingVideo;
      const videoStatus = deriveTransitionVideoStatus({
        transition,
        jobs: manifest.jobs.filter((job) => job.targetParentId === transition.id),
        blockedByFrameIds,
        currentVideo,
        hasCurrentApproval,
      });

      const view: TransitionView = {
        ...transition,
        promptStatus,
        videoStatus,
        fromFrame,
        toFrame,
        approvedVideoVersion,
        latestVideoVersion,
        currentVideo,
        galleryVersions,
        hasCurrentApproval,
        isStale: currentVideo == null || blockedByFrameIds.length > 0 || promptStatus !== "confirmed",
        nextAction: deriveTransitionNextAction({
          transition,
          promptStatus,
          videoStatus,
          blockedByFrameIds,
        }),
        blockedByFrameIds,
        downstreamImpactCount: toFrame.downstreamImpactCount,
        queueRank: fromFrame.queueRank + 1,
        disabledReason: null,
      };

      view.disabledReason = deriveTransitionDisabledReason(view);
      return view;
    });

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

  reorderFrames(manifest, remainder.map((frame) => frame.id));
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
  const afterSnapshot = buildProjectSnapshot(after, "/tmp/project");
  const afterActiveTransitions = afterSnapshot.transitions;
  const afterActive = new Set(
    afterActiveTransitions.map((transition) => `${transition.fromFrameId}:${transition.toFrameId}`),
  );

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

    if (transition.promptStatus === "needs_confirmation") {
      transitionsNeedingConfirmation += 1;
    }

    if (transition.latestVideoVersion && isTransitionVideoStale(transition, transition.latestVideoVersion, new Map(afterSnapshot.frames.map((frame) => [frame.id, frame])))) {
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
      const fromEndpointVersionId = getCurrentFrameVersionIdForManifest(manifest, existing.fromFrameId);
      const toEndpointVersionId = getCurrentFrameVersionIdForManifest(manifest, existing.toFrameId);
      existing.invalidationReason =
        fromEndpointVersionId !== existing.confirmedFromVersionId ||
        toEndpointVersionId !== existing.confirmedToVersionId
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
