export type ReviewerDecision = "approved" | "rejected" | "unreviewed";
export type JobStatus = "queued" | "running" | "completed" | "error";
export type SequenceScope = "active" | "archived";
export type GenerationProvider = "mock" | "atlas";

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
  outputPath: string;
  thumbnailPath: string;
  generationJobId: string;
  createdAt: string;
  reviewerDecision: ReviewerDecision;
  reviewerNotes: string;
};

export type Frame = {
  id: string;
  position: number;
  title: string;
  imagePrompt: string;
  referenceImages: string[];
  usePreviousFrameAsReference: boolean;
  notes: string;
  approvedVersionId: string | null;
  versions: FrameVersion[];
  createdAt: string;
  updatedAt: string;
};

export type TransitionVersion = {
  id: string;
  model: string;
  inputPayload: Record<string, unknown>;
  outputPath: string;
  posterPath: string;
  generationJobId: string;
  createdAt: string;
  reviewerDecision: ReviewerDecision;
  reviewerNotes: string;
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
  viewMode: "sequence";
  selectedFrameId: string | null;
  selectedTransitionId: string | null;
  inspectorOpen: boolean;
  filter: "all" | "needsAttention" | "approved";
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
  | "queued"
  | "generating"
  | "generated_unreviewed"
  | "approved"
  | "needs_regen"
  | "error";

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

export type FrameView = Frame & {
  status: FrameStatus;
  approvedVersion: FrameVersion | null;
  latestVersion: FrameVersion | null;
  queuedJobs: number;
};

export type TransitionView = Transition & {
  promptStatus: TransitionPromptStatus;
  videoStatus: TransitionVideoStatus;
  fromFrame: FrameView;
  toFrame: FrameView;
  approvedVideoVersion: TransitionVersion | null;
  latestVideoVersion: TransitionVersion | null;
  isStale: boolean;
};

export type ProjectSnapshot = {
  projectPath: string;
  manifest: ProjectManifest;
  frames: FrameView[];
  transitions: TransitionView[];
};

export type ReorderImpactSummary = {
  preservedTransitions: number;
  newTransitions: number;
  archivedTransitions: number;
  transitionsNeedingConfirmation: number;
  videosMarkedStale: number;
};
