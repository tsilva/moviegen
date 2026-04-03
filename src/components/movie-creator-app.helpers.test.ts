import { describe, expect, test } from "vitest";
import type { FrameVersion, FrameView, TransitionVersion, TransitionView } from "@/lib/types";
import {
  getFrameCardMeta,
  getFrameDisplayPrompt,
  getFrameGenerationDraft,
  getFrameRepairAction,
  getSequenceNextStep,
  getSequenceOverviewStats,
  getTransitionCardMeta,
  getTransitionDisplayPrompt,
} from "./movie-creator-app.helpers";

function createVersion(id: string, overrides: Partial<FrameVersion> = {}): FrameVersion {
  return {
    id,
    model: "mock-model",
    inputPayload: {},
    outputPath: `frames/${id}.png`,
    thumbnailPath: `frames/${id}.png`,
    generationJobId: `job_${id}`,
    createdAt: "2026-04-03T00:00:00.000Z",
    reviewerDecision: "unreviewed",
    reviewerNotes: "",
    sourcePrompt: null,
    usePreviousFrameAsReference: null,
    dependencyFrameId: null,
    dependencyVersionId: null,
    ...overrides,
  };
}

function createFrameView(overrides: Partial<FrameView> = {}): FrameView {
  const latestVersion = createVersion("framever_latest", { sourcePrompt: "Latest prompt" });
  return {
    id: "frame_1",
    position: 1,
    imagePrompt: "Draft prompt",
    referenceImages: [],
    usePreviousFrameAsReference: true,
    approvedVersionId: latestVersion.id,
    versions: [latestVersion],
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    status: "approved",
    approvedVersion: latestVersion,
    latestVersion,
    currentVersion: latestVersion,
    galleryVersions: [latestVersion],
    hasCurrentApproval: true,
    queuedJobs: 0,
    nextAction: null,
    dependsOnPreviousFrame: true,
    blockedByFrameId: null,
    downstreamImpactCount: 0,
    queueRank: 0,
    disabledReason: null,
    ...overrides,
  };
}

function createTransitionVersion(id: string, overrides: Partial<TransitionVersion> = {}): TransitionVersion {
  return {
    id,
    model: "mock-transition-model",
    inputPayload: {},
    outputPath: `transitions/${id}.mp4`,
    posterPath: `transitions/${id}.jpg`,
    generationJobId: `job_${id}`,
    createdAt: "2026-04-03T00:00:00.000Z",
    reviewerDecision: "unreviewed",
    reviewerNotes: "",
    promptRevision: 1,
    fromApprovedVersionId: "framever_from",
    toApprovedVersionId: "framever_to",
    ...overrides,
  };
}

function createTransitionView(overrides: Partial<TransitionView> = {}): TransitionView {
  const frameVersion = createVersion("framever_latest", { sourcePrompt: "Latest prompt" });
  const frameView = createFrameView({
    currentVersion: frameVersion,
    approvedVersion: frameVersion,
    latestVersion: frameVersion,
    galleryVersions: [frameVersion],
  });
  const latestVideoVersion = createTransitionVersion("transitionver_latest");

  return {
    id: "transition_1",
    fromFrameId: frameView.id,
    toFrameId: "frame_2",
    transitionPrompt: "Match cut through the doorway",
    promptRevision: 1,
    confirmedFromVersionId: frameVersion.id,
    confirmedToVersionId: "framever_to",
    approvedVideoVersionId: latestVideoVersion.id,
    invalidationReason: null,
    sequenceScope: "active",
    versions: [latestVideoVersion],
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    promptStatus: "confirmed",
    videoStatus: "approved",
    fromFrame: frameView,
    toFrame: { ...frameView, id: "frame_2", position: 2 },
    approvedVideoVersion: latestVideoVersion,
    latestVideoVersion,
    currentVideo: latestVideoVersion,
    galleryVersions: [latestVideoVersion],
    hasCurrentApproval: true,
    blockedByFrameIds: [],
    downstreamImpactCount: 0,
    queueRank: 0,
    disabledReason: null,
    nextAction: null,
    isStale: false,
    ...overrides,
  };
}

describe("movie creator frame helpers", () => {
  test("shows the prompt for the selected gallery generation", () => {
    const selectedVersion = createVersion("framever_selected", {
      sourcePrompt: "Selected gallery prompt",
    });
    const frame = createFrameView({
      currentVersion: createVersion("framever_current", { sourcePrompt: "Current prompt" }),
      latestVersion: selectedVersion,
      galleryVersions: [selectedVersion],
    });

    expect(getFrameDisplayPrompt(frame, selectedVersion.id)).toBe("Selected gallery prompt");
  });

  test("falls back to the draft prompt when no generation exists yet", () => {
    const frame = createFrameView({
      imagePrompt: "Draft-only prompt",
      approvedVersionId: null,
      versions: [],
      status: "draft",
      approvedVersion: null,
      latestVersion: null,
      currentVersion: null,
      galleryVersions: [],
      hasCurrentApproval: false,
      nextAction: "write_prompt",
      dependsOnPreviousFrame: false,
    });

    expect(getFrameDisplayPrompt(frame, "__add__")).toBe("Draft-only prompt");
  });

  test("uses the selected generation metadata to prefill the generate modal", () => {
    const selectedVersion = createVersion("framever_selected", {
      sourcePrompt: "Selected generation prompt",
      usePreviousFrameAsReference: false,
    });
    const frame = createFrameView({
      galleryVersions: [selectedVersion],
      currentVersion: selectedVersion,
      latestVersion: selectedVersion,
    });

    expect(getFrameGenerationDraft(frame, selectedVersion.id)).toEqual({
      prompt: "Selected generation prompt",
      usePreviousFrameAsReference: false,
    });
  });

  test("maps repair states to the correct frame UI action", () => {
    expect(getFrameRepairAction(createFrameView({ nextAction: "write_prompt" }))).toBe("open_modal");
    expect(getFrameRepairAction(createFrameView({ nextAction: "generate" }))).toBe("queue_generation");
  });

  test("uses a structural frame title in card metadata", () => {
    const frame = createFrameView({ position: 2 });

    expect(getFrameCardMeta(frame, frame.currentVersion!.id)).toMatchObject({
      title: "Frame 3",
      statusLabel: "Current",
    });
  });
});

describe("movie creator transition helpers", () => {
  test("shows the transition prompt for gallery labels", () => {
    const transition = createTransitionView({
      transitionPrompt: "Whip pan into the next shot",
    });

    expect(getTransitionDisplayPrompt(transition)).toBe("Whip pan into the next shot");
  });

  test("falls back when the transition prompt is empty", () => {
    const transition = createTransitionView({
      transitionPrompt: "   ",
    });

    expect(getTransitionDisplayPrompt(transition)).toBe("No transition prompt yet");
  });

  test("uses a structural transition title in card metadata even when prompt is empty", () => {
    const transition = createTransitionView({
      transitionPrompt: "   ",
      fromFrame: createFrameView({ position: 0 }),
      toFrame: createFrameView({ id: "frame_2", position: 1 }),
    });

    expect(getTransitionCardMeta(transition)).toMatchObject({
      title: "Transition 1 -> 2",
      prompt: "No transition prompt yet",
      statusLabel: "Add Prompt",
      action: {
        label: "Add Prompt",
      },
    });
  });
});

describe("sequence overview helpers", () => {
  test("summarizes overview counts from frame and transition state", () => {
    const frames = [
      createFrameView({ id: "frame_1", nextAction: "write_prompt", status: "draft" }),
      createFrameView({ id: "frame_2", nextAction: "generate", status: "stale_dependency", queueRank: 2 }),
      createFrameView({ id: "frame_3", status: "queued", queueRank: 4 }),
    ];
    const transitions = [
      createTransitionView({
        id: "transition_1",
        transitionPrompt: "",
        nextAction: null,
        queueRank: 1,
      }),
      createTransitionView({
        id: "transition_2",
        transitionPrompt: "Camera drifts forward",
        nextAction: "generate",
        videoStatus: "stale",
        queueRank: 3,
      }),
      createTransitionView({
        id: "transition_3",
        transitionPrompt: "Camera lands on the subject",
        nextAction: null,
        videoStatus: "generating",
        queueRank: 5,
      }),
    ];

    expect(getSequenceOverviewStats(frames, transitions, 1)).toEqual({
      currentClipCount: 1,
      totalTransitionCount: 3,
      missingInputCount: 2,
      actionableGenerationCount: 2,
      inProgressCount: 2,
    });
  });

  test("prioritizes missing prompts before ready generation and pending work", () => {
    const frames = [
      createFrameView({ id: "frame_1", nextAction: "generate", status: "stale_dependency", queueRank: 0 }),
      createFrameView({ id: "frame_2", nextAction: "write_prompt", status: "draft", queueRank: 2 }),
    ];
    const transitions = [
      createTransitionView({
        id: "transition_1",
        transitionPrompt: "",
        queueRank: 1,
      }),
      createTransitionView({
        id: "transition_2",
        transitionPrompt: "Pan forward",
        nextAction: null,
        videoStatus: "queued",
        queueRank: 3,
      }),
    ];

    expect(getSequenceNextStep(frames, transitions, 0)).toMatchObject({
      kind: "transition",
      entryId: "transition_1",
      action: "write_prompt",
      ctaLabel: "Add Prompt",
    });
  });

  test("falls back to ready generation when no prompts are missing", () => {
    const frames = [
      createFrameView({ id: "frame_1", nextAction: "generate", status: "stale_dependency", queueRank: 0 }),
    ];
    const transitions = [
      createTransitionView({
        id: "transition_1",
        transitionPrompt: "Drift through the frame",
        nextAction: null,
        videoStatus: "queued",
        queueRank: 1,
      }),
    ];

    expect(getSequenceNextStep(frames, transitions, 0)).toMatchObject({
      kind: "frame",
      entryId: "frame_1",
      action: "generate",
      ctaLabel: "Generate",
    });
  });

  test("reports current cut ready when nothing needs attention", () => {
    const frames = [
      createFrameView({ id: "frame_1", queueRank: 0 }),
      createFrameView({ id: "frame_2", queueRank: 2 }),
    ];
    const transitions = [
      createTransitionView({
        id: "transition_1",
        transitionPrompt: "Smooth push forward",
        queueRank: 1,
      }),
    ];

    expect(getSequenceNextStep(frames, transitions, 1)).toEqual({
      kind: "current_cut_ready",
      title: "Current cut ready",
      description: "1/1 current clip is ready to play.",
      ctaLabel: null,
    });
  });
});
