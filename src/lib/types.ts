export type ReviewerDecision = "approved" | "rejected" | "unreviewed";
export type JobStatus = "queued" | "running" | "completed" | "error";
export type SequenceScope = "active" | "archived";
export type GenerationProvider = "mock" | "atlas";
export type TrackSlotKind = "startFrame" | "transition" | "endFrame";
export type TrackSlotStatusColor = "orange" | "gray" | "blue" | "cyan" | "teal" | "red";

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};

export type FrameVersion = {
  id: string;
  model: string;
  inputPayload: Record<string, unknown>;
  responsePayload?: unknown;
  outputPath: string;
  thumbnailPath: string;
  generationJobId: string;
  createdAt: string;
  reviewerDecision: ReviewerDecision;
  reviewerNotes: string;
  sourcePrompt?: string | null;
  usePreviousFrameAsReference?: boolean | null;
  dependencyFrameId?: string | null;
  dependencyVersionId?: string | null;
};

export type Frame = {
  id: string;
  position: number;
  imagePrompt: string;
  referenceImages: string[];
  usePreviousFrameAsReference: boolean;
  approvedVersionId: string | null;
  versions: FrameVersion[];
  createdAt: string;
  updatedAt: string;
};

export type TransitionVersion = {
  id: string;
  model: string;
  inputPayload: Record<string, unknown>;
  responsePayload?: unknown;
  outputPath: string;
  posterPath: string;
  generationJobId: string;
  createdAt: string;
  reviewerDecision: ReviewerDecision;
  reviewerNotes: string;
  sourcePrompt?: string | null;
  promptRevision: number;
  fromApprovedVersionId: string | null;
  toApprovedVersionId: string | null;
};

export type Transition = {
  id: string;
  fromFrameId: string;
  toFrameId: string;
  transitionPrompt: string;
  promptRevision: number;
  confirmedFromVersionId: string | null;
  confirmedToVersionId: string | null;
  approvedVideoVersionId: string | null;
  invalidationReason: string | null;
  sequenceScope: SequenceScope;
  versions: TransitionVersion[];
  createdAt: string;
  updatedAt: string;
};

export type GenerationJob = {
  id: string;
  kind: "frame_image" | "transition_video";
  targetId: string;
  targetParentId: string;
  provider: GenerationProvider;
  model: string;
  status: JobStatus;
  requestPayload: Record<string, unknown>;
  providerPredictionId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersistedUiState = {
  themeMode: "dark";
  viewMode: "sequence" | "play";
  selectedSlot: TrackSlotSelection | null;
  filter: "all" | "needsRepair";
};

export type TrackSlotSelection = {
  trackId: string;
  slotKind: TrackSlotKind;
};

export type ProjectManifest = {
  project: ProjectMeta;
  frames: Frame[];
  transitions: Transition[];
  jobs: GenerationJob[];
  ui: PersistedUiState;
};

export type FrameStatus =
  | "draft"
  | "blocked_upstream"
  | "stale_dependency"
  | "queued"
  | "generating"
  | "generated_unreviewed"
  | "approved"
  | "error";

export type FrameNextAction = "write_prompt" | "generate" | null;

export type TransitionPromptStatus =
  | "blocked"
  | "missing"
  | "needs_confirmation"
  | "confirmed";

export type TransitionVideoStatus =
  | "not_ready"
  | "queued"
  | "generating"
  | "generated_unreviewed"
  | "approved"
  | "stale"
  | "error";

export type TransitionNextAction = "write_prompt" | "generate" | null;

export type FrameView = Frame & {
  status: FrameStatus;
  approvedVersion: FrameVersion | null;
  latestVersion: FrameVersion | null;
  currentVersion: FrameVersion | null;
  galleryVersions: FrameVersion[];
  hasCurrentApproval: boolean;
  queuedJobs: number;
  nextAction: FrameNextAction;
  dependsOnPreviousFrame: boolean;
  blockedByFrameId: string | null;
  downstreamImpactCount: number;
  queueRank: number;
  disabledReason: string | null;
};

export type TransitionView = Transition & {
  promptStatus: TransitionPromptStatus;
  videoStatus: TransitionVideoStatus;
  fromFrame: FrameView;
  toFrame: FrameView;
  approvedVideoVersion: TransitionVersion | null;
  latestVideoVersion: TransitionVersion | null;
  currentVideo: TransitionVersion | null;
  galleryVersions: TransitionVersion[];
  hasCurrentApproval: boolean;
  isStale: boolean;
  nextAction: TransitionNextAction;
  blockedByFrameIds: string[];
  downstreamImpactCount: number;
  queueRank: number;
  disabledReason: string | null;
};

export type TrackSlotView = {
  trackId: string;
  slotKind: TrackSlotKind;
  entryKind: "frame" | "transition";
  entryId: string;
  label: string;
  prompt: string;
  promptPlaceholder: boolean;
  statusLabel: string;
  statusColor: TrackSlotStatusColor;
  summary: string;
  previewPath: string | null;
  zoomPath: string | null;
  posterPath: string | null;
  isStale: boolean;
  isBlocked: boolean;
  canGenerate: boolean;
  disabledReason: string | null;
  candidateCount: number;
};

export type TrackView = {
  id: string;
  index: number;
  transitionId: string;
  startFrame: FrameView;
  transition: TransitionView;
  endFrame: FrameView;
  slots: {
    startFrame: TrackSlotView;
    transition: TrackSlotView;
    endFrame: TrackSlotView;
  };
};

export type ProjectSnapshot = {
  projectPath: string;
  manifest: ProjectManifest;
  frames: FrameView[];
  transitions: TransitionView[];
  tracks: TrackView[];
};

export type ReorderImpactSummary = {
  preservedTransitions: number;
  newTransitions: number;
  archivedTransitions: number;
  transitionsNeedingConfirmation: number;
  videosMarkedStale: number;
};
