import type { FrameView, TransitionView } from "@/lib/types";

type SequenceCardActionIntent = "write_prompt" | "generate" | "review" | "pending";

export type SequenceCardAction = {
  intent: SequenceCardActionIntent;
  label: string;
  color: "orange" | "cyan" | "blue";
  disabled?: boolean;
};

export type SequenceCardMeta = {
  title: string;
  prompt: string;
  promptPlaceholder: boolean;
  statusLabel: string;
  statusColor: "orange" | "gray" | "blue" | "cyan" | "teal" | "red";
  summary: string;
  action: SequenceCardAction | null;
};

export type SequenceOverviewStats = {
  currentClipCount: number;
  totalTransitionCount: number;
  missingInputCount: number;
  actionableGenerationCount: number;
  inProgressCount: number;
};

export type SequenceNextStep =
  | {
      kind: "frame" | "transition";
      entryId: string;
      action: "write_prompt" | "generate" | "pending";
      title: string;
      description: string;
      ctaLabel: string;
    }
  | {
      kind: "current_cut_ready";
      title: string;
      description: string;
      ctaLabel: null;
    };

function findFrameVersionByTileId(frame: FrameView, tileId: string) {
  return frame.galleryVersions.find((version) => version.id === tileId) ?? null;
}

function findTransitionVersionByTileId(transition: TransitionView, tileId: string) {
  return transition.galleryVersions.find((version) => version.id === tileId) ?? null;
}

function getFallbackFramePrompt(frame: FrameView) {
  return frame.currentVersion?.sourcePrompt ?? frame.latestVersion?.sourcePrompt ?? frame.imagePrompt;
}

function getFallbackTransitionPrompt(transition: TransitionView) {
  return transition.currentVideo?.sourcePrompt ?? transition.latestVideoVersion?.sourcePrompt ?? transition.transitionPrompt;
}

export function getFrameLabel(frame: Pick<FrameView, "position">) {
  return `Frame ${frame.position + 1}`;
}

export function getTransitionLabel(transition: Pick<TransitionView, "fromFrame" | "toFrame">) {
  return `Transition ${transition.fromFrame.position + 1} -> ${transition.toFrame.position + 1}`;
}

export function getFrameDisplayPrompt(frame: FrameView, selectedGalleryTileId: string) {
  return (
    findFrameVersionByTileId(frame, selectedGalleryTileId)?.sourcePrompt ??
    getFallbackFramePrompt(frame) ??
    "No frame prompt yet"
  );
}

export function getFrameGenerationDraft(frame: FrameView, selectedGalleryTileId: string) {
  const selectedVersion = findFrameVersionByTileId(frame, selectedGalleryTileId);
  const prompt =
    selectedVersion?.sourcePrompt ?? getFallbackFramePrompt(frame) ?? "";
  const usePreviousFrameAsReference = frame.position === 0
    ? false
    : selectedVersion?.usePreviousFrameAsReference ?? frame.usePreviousFrameAsReference;

  return {
    prompt,
    usePreviousFrameAsReference,
  };
}

export function getTransitionDisplayPrompt(transition: TransitionView, selectedGalleryTileId?: string) {
  const selectedPrompt = selectedGalleryTileId
    ? findTransitionVersionByTileId(transition, selectedGalleryTileId)?.sourcePrompt
    : null;
  const prompt = selectedPrompt ?? getFallbackTransitionPrompt(transition);

  return prompt?.trim() || "No transition prompt yet";
}

export function getTransitionGenerationDraft(transition: TransitionView, selectedGalleryTileId?: string) {
  const selectedVersion = selectedGalleryTileId
    ? findTransitionVersionByTileId(transition, selectedGalleryTileId)
    : null;
  const prompt = selectedVersion?.sourcePrompt ?? getFallbackTransitionPrompt(transition) ?? "";

  return {
    prompt,
  };
}

export function buildBulkFrameRows(promptInput: string, referenceImagePaths: string[]) {
  const prompts = promptInput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rowCount = Math.max(prompts.length, referenceImagePaths.length);

  return Array.from({ length: rowCount }, (_, index) => {
    const prompt = prompts[index] ?? "";
    const referencePath = referenceImagePaths[index];

    if (!referencePath) {
      return {
        imagePrompt: prompt,
      };
    }

    return {
      imagePrompt: prompt,
      referenceImages: [referencePath],
      usePreviousFrameAsReference: false,
    };
  });
}

export function shouldAutoSelectGeneratedTile(input: {
  selectedTileId: string | undefined;
  addTileId: string;
  defaultTileId: string;
  previousDefaultTileId: string | undefined;
  wasPending: boolean | undefined;
  isPending: boolean;
}) {
  const {
    selectedTileId,
    addTileId,
    defaultTileId,
    previousDefaultTileId,
    wasPending,
    isPending,
  } = input;

  if (
    !wasPending ||
    isPending ||
    defaultTileId === addTileId ||
    previousDefaultTileId == null ||
    previousDefaultTileId === defaultTileId
  ) {
    return false;
  }

  if (selectedTileId === addTileId) {
    return true;
  }

  return selectedTileId != null && selectedTileId === previousDefaultTileId;
}

export function getFrameRepairAction(frame: FrameView) {
  if (frame.nextAction === "write_prompt") {
    return "open_modal";
  }

  if (frame.nextAction === "generate") {
    return "queue_generation";
  }

  return null;
}

export function getFrameCardMeta(frame: FrameView, selectedGalleryTileId: string): SequenceCardMeta {
  const prompt = getFrameDisplayPrompt(frame, selectedGalleryTileId);
  const promptPlaceholder = !prompt.trim() || prompt === "No frame prompt yet";

  if (frame.nextAction === "write_prompt") {
    return {
      title: getFrameLabel(frame),
      prompt,
      promptPlaceholder,
      statusLabel: "Add Prompt",
      statusColor: "orange",
      summary: "Add a prompt to generate this frame and let the sequence continue.",
      action: { intent: "write_prompt", label: "Add Prompt", color: "orange" },
    };
  }

  if (frame.status === "blocked_upstream") {
    return {
      title: getFrameLabel(frame),
      prompt,
      promptPlaceholder,
      statusLabel: "Blocked",
      statusColor: "gray",
      summary: "An upstream frame must become current before this frame can be repaired.",
      action: null,
    };
  }

  if (frame.status === "stale_dependency") {
    return {
      title: getFrameLabel(frame),
      prompt,
      promptPlaceholder,
      statusLabel: "Generate",
      statusColor: "orange",
      summary: "Its selected image no longer matches the current chain. Generate a fresh version next.",
      action: { intent: "generate", label: "Generate", color: "cyan" },
    };
  }

  if (frame.status === "queued" || frame.status === "generating") {
    return {
      title: getFrameLabel(frame),
      prompt,
      promptPlaceholder,
      statusLabel: frame.status === "queued" ? "Queued" : "Generating",
      statusColor: "blue",
      summary: "A repair is already in progress for this frame.",
      action: {
        intent: "pending",
        label: frame.status === "queued" ? "Queued" : "Generating",
        color: "blue",
        disabled: true,
      },
    };
  }

  if (frame.status === "generated_unreviewed") {
    return {
      title: getFrameLabel(frame),
      prompt,
      promptPlaceholder,
      statusLabel: "Review",
      statusColor: "cyan",
      summary: frame.hasCurrentApproval
        ? "A newer alternate exists. Review it if you want to switch the current frame."
        : "A current candidate exists and needs review before it becomes the selected frame.",
      action: { intent: "review", label: "Review", color: "cyan" },
    };
  }

  if (frame.status === "error") {
    return {
      title: getFrameLabel(frame),
      prompt,
      promptPlaceholder,
      statusLabel: "Generate",
      statusColor: "red",
      summary: "The last generation attempt failed. Open the frame and try again.",
      action: { intent: "generate", label: "Generate", color: "cyan" },
    };
  }

  if (frame.nextAction === "generate") {
    return {
      title: getFrameLabel(frame),
      prompt,
      promptPlaceholder,
      statusLabel: "Generate",
      statusColor: "cyan",
      summary: "This frame has what it needs and is ready to generate now.",
      action: { intent: "generate", label: "Generate", color: "cyan" },
    };
  }

  return {
    title: getFrameLabel(frame),
    prompt,
    promptPlaceholder,
    statusLabel: "Current",
    statusColor: "teal",
    summary: "This frame is part of the current sequence state.",
    action: null,
  };
}

export function getTransitionCardMeta(transition: TransitionView, selectedGalleryTileId?: string): SequenceCardMeta {
  const prompt = getTransitionDisplayPrompt(transition, selectedGalleryTileId);
  const promptPlaceholder = !prompt.trim() || prompt === "No transition prompt yet";

  if (transition.blockedByFrameIds.length > 0) {
    return {
      title: getTransitionLabel(transition),
      prompt,
      promptPlaceholder,
      statusLabel: "Blocked",
      statusColor: "gray",
      summary: "One or both adjacent frames must become current before this clip can update.",
      action: null,
    };
  }

  if (transition.videoStatus === "stale" || transition.videoStatus === "not_ready") {
    return {
      title: getTransitionLabel(transition),
      prompt,
      promptPlaceholder,
      statusLabel: promptPlaceholder ? "Add Asset" : "Generate",
      statusColor: "cyan",
      summary: promptPlaceholder
        ? "Generate a clip for the latest frame pair. Add an optional prompt in the modal if you want to direct the move."
        : "The current frame pair is ready. Generate a fresh clip for the latest cut.",
      action: { intent: "generate", label: "Generate Clip", color: "cyan" },
    };
  }

  if (transition.videoStatus === "queued" || transition.videoStatus === "generating") {
    return {
      title: getTransitionLabel(transition),
      prompt,
      promptPlaceholder,
      statusLabel: transition.videoStatus === "queued" ? "Queued" : "Generating",
      statusColor: "blue",
      summary: "A clip is already being generated for this transition.",
      action: {
        intent: "pending",
        label: transition.videoStatus === "queued" ? "Queued" : "Generating",
        color: "blue",
        disabled: true,
      },
    };
  }

  if (transition.videoStatus === "generated_unreviewed") {
    return {
      title: getTransitionLabel(transition),
      prompt,
      promptPlaceholder,
      statusLabel: "Review",
      statusColor: "cyan",
      summary: transition.hasCurrentApproval
        ? "A newer alternate clip exists. Review it if you want to switch the current cut."
        : "A current clip exists and needs review before it becomes the selected transition.",
      action: { intent: "review", label: "Review", color: "cyan" },
    };
  }

  if (transition.videoStatus === "error") {
    return {
      title: getTransitionLabel(transition),
      prompt,
      promptPlaceholder,
      statusLabel: "Generate",
      statusColor: "red",
      summary: "The last generation attempt failed. Generate a new clip once the cut looks right.",
      action: { intent: "generate", label: "Generate Clip", color: "cyan" },
    };
  }

  return {
    title: getTransitionLabel(transition),
    prompt,
    promptPlaceholder,
    statusLabel: "Current",
    statusColor: "teal",
    summary: "This clip is part of the current playable cut.",
    action: null,
  };
}

export function getSequenceOverviewStats(
  frames: FrameView[],
  transitions: TransitionView[],
  currentClipCount: number,
): SequenceOverviewStats {
  const missingInputCount = frames.filter((frame) => frame.nextAction === "write_prompt").length;

  const actionableGenerationCount =
    frames.filter((frame) => frame.nextAction === "generate").length +
    transitions.filter((transition) => transition.nextAction === "generate").length;

  const inProgressCount =
    frames.filter((frame) => frame.status === "queued" || frame.status === "generating").length +
    transitions.filter((transition) => transition.videoStatus === "queued" || transition.videoStatus === "generating").length;

  return {
    currentClipCount,
    totalTransitionCount: transitions.length,
    missingInputCount,
    actionableGenerationCount,
    inProgressCount,
  };
}

type PrioritizedSequenceEntry =
  | {
      kind: "frame";
      entryId: string;
      action: "write_prompt" | "generate" | "pending";
      title: string;
      description: string;
      ctaLabel: string;
      queueRank: number;
    }
  | {
      kind: "transition";
      entryId: string;
      action: "write_prompt" | "generate" | "pending";
      title: string;
      description: string;
      ctaLabel: string;
      queueRank: number;
    };

function sortEntries(entries: PrioritizedSequenceEntry[]) {
  return entries.slice().sort((left, right) => left.queueRank - right.queueRank);
}

export function getSequenceNextStep(
  frames: FrameView[],
  transitions: TransitionView[],
  currentClipCount: number,
): SequenceNextStep {
  if (!frames.length) {
    return {
      kind: "current_cut_ready",
      title: "No sequence yet",
      description: "Add a few frames to start building the cut.",
      ctaLabel: null,
    };
  }

  const missingPromptEntries = sortEntries([
    ...frames
      .filter((frame) => frame.nextAction === "write_prompt")
      .map((frame) => ({
        kind: "frame" as const,
        entryId: frame.id,
        action: "write_prompt" as const,
        title: `${getFrameLabel(frame)} needs a prompt`,
        description: "Add a prompt before this frame can generate and unblock the rest of the cut.",
        ctaLabel: "Add Prompt",
        queueRank: frame.queueRank,
      })),
  ]);

  if (missingPromptEntries[0]) {
    return missingPromptEntries[0];
  }

  const readyToGenerateEntries = sortEntries([
    ...frames
      .filter((frame) => frame.nextAction === "generate")
      .map((frame) => ({
        kind: "frame" as const,
        entryId: frame.id,
        action: "generate" as const,
        title: `${getFrameLabel(frame)} is ready to generate`,
        description: "Open the frame and kick off a new image for the current sequence state.",
        ctaLabel: "Generate",
        queueRank: frame.queueRank,
      })),
    ...transitions
      .filter((transition) => transition.nextAction === "generate")
      .map((transition) => ({
        kind: "transition" as const,
        entryId: transition.id,
        action: "generate" as const,
        title: `${getTransitionLabel(transition)} is ready to generate`,
        description: "The latest frame pair is ready for a fresh transition clip.",
        ctaLabel: "Generate Clip",
        queueRank: transition.queueRank,
      })),
  ]);

  if (readyToGenerateEntries[0]) {
    return readyToGenerateEntries[0];
  }

  const pendingEntries = sortEntries([
    ...frames
      .filter((frame) => frame.status === "queued" || frame.status === "generating")
      .map((frame) => ({
        kind: "frame" as const,
        entryId: frame.id,
        action: "pending" as const,
        title: `${getFrameLabel(frame)} is in progress`,
        description: "Generation is already running. Keep an eye on this frame while the cut updates.",
        ctaLabel: "View Progress",
        queueRank: frame.queueRank,
      })),
    ...transitions
      .filter((transition) => transition.videoStatus === "queued" || transition.videoStatus === "generating")
      .map((transition) => ({
        kind: "transition" as const,
        entryId: transition.id,
        action: "pending" as const,
        title: `${getTransitionLabel(transition)} is in progress`,
        description: "A clip is already being generated for this transition.",
        ctaLabel: "View Progress",
        queueRank: transition.queueRank,
      })),
  ]);

  if (pendingEntries[0]) {
    return pendingEntries[0];
  }

  return {
    kind: "current_cut_ready",
    title: "Current cut ready",
    description:
      transitions.length === 0
        ? "Add another frame to create the first playable transition."
        : `${currentClipCount}/${transitions.length} current clip${transitions.length === 1 ? " is" : "s are"} ready to play.`,
    ctaLabel: null,
  };
}
