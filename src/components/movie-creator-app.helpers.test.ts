import { describe, expect, test } from "vitest";
import { createEmptyManifest } from "@/lib/project-ops";
import type { FrameVersion, FrameView, TransitionVersion, TransitionView } from "@/lib/types";
import {
  buildBulkFrameRows,
  getFrameCardMeta,
  getFrameDisplayPrompt,
  getFrameGenerationDraft,
  getFrameRepairAction,
  hasActiveGenerationJobs,
  getSequenceNextStep,
  getSequenceOverviewStats,
  getTransitionCardMeta,
  getTransitionDisplayPrompt,
  getTransitionGenerationDraft,
  reconcileGallerySelectionAfterSnapshot,
  shouldApplySyncedSnapshot,
  shouldAutoSelectGeneratedTile,
  shouldSyncEditorDraft,
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
  const generationOverrides = overrides.generationOverrides ?? {};
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
    latestErrorJob: null,
    hasCurrentApproval: true,
    queuedJobs: 0,
    nextAction: null,
    dependsOnPreviousFrame: true,
    blockedByFrameId: null,
    downstreamImpactCount: 0,
    queueRank: 0,
    disabledReason: null,
    ...overrides,
    generationOverrides,
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
    sourcePrompt: null,
    promptRevision: 1,
    fromApprovedVersionId: "framever_from",
    toApprovedVersionId: "framever_to",
    ...overrides,
  };
}

function createTransitionView(overrides: Partial<TransitionView> = {}): TransitionView {
  const frameVersion = createVersion("framever_latest", { sourcePrompt: "Latest prompt" });
  const generationOverrides = overrides.generationOverrides ?? {};
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
    latestErrorJob: null,
    hasCurrentApproval: true,
    blockedByFrameIds: [],
    downstreamImpactCount: 0,
    queueRank: 0,
    disabledReason: null,
    nextAction: null,
    isStale: false,
    ...overrides,
    generationOverrides,
  };
}

describe("movie creator frame helpers", () => {
  test("preserves the local editor draft while the same entry is dirty", () => {
    expect(
      shouldSyncEditorDraft({
        isDirty: true,
        currentEntryKey: "frame:frame_1",
        nextEntryKey: "frame:frame_1",
      }),
    ).toBe(false);
  });

  test("resyncs the editor draft when selection changes to a different entry", () => {
    expect(
      shouldSyncEditorDraft({
        isDirty: true,
        currentEntryKey: "frame:frame_1",
        nextEntryKey: "frame:frame_2",
      }),
    ).toBe(true);
  });

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
      modelId: "alibaba/wan-2.7/image-edit",
      prompt: "Selected generation prompt",
      settings: { resolution: "480p" },
      systemPromptTemplate: "{{prompt}}",
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
  test("shows the prompt for the selected transition clip generation", () => {
    const selectedVersion = createTransitionVersion("transitionver_selected", {
      sourcePrompt: "Selected transition prompt",
    });
    const transition = createTransitionView({
      transitionPrompt: "Whip pan into the next shot",
      currentVideo: createTransitionVersion("transitionver_current", {
        sourcePrompt: "Current transition prompt",
      }),
      latestVideoVersion: selectedVersion,
      galleryVersions: [selectedVersion],
    });

    expect(getTransitionDisplayPrompt(transition, selectedVersion.id)).toBe("Selected transition prompt");
  });

  test("falls back to the live transition prompt when no clip prompt exists yet", () => {
    const transition = createTransitionView({
      transitionPrompt: "Whip pan into the next shot",
      currentVideo: null,
      latestVideoVersion: null,
      galleryVersions: [],
    });

    expect(getTransitionDisplayPrompt(transition)).toBe("Whip pan into the next shot");
  });

  test("falls back when neither clip prompt nor transition prompt exists", () => {
    const transition = createTransitionView({
      transitionPrompt: "   ",
      currentVideo: null,
      latestVideoVersion: null,
      galleryVersions: [],
    });

    expect(getTransitionDisplayPrompt(transition)).toBe("No transition prompt yet");
  });

  test("uses a structural transition title in card metadata even when prompt is empty", () => {
    const transition = createTransitionView({
      transitionPrompt: "   ",
      fromFrame: createFrameView({ position: 0 }),
      toFrame: createFrameView({ id: "frame_2", position: 1 }),
      approvedVideoVersion: null,
      latestVideoVersion: null,
      currentVideo: null,
      galleryVersions: [],
      versions: [],
      approvedVideoVersionId: null,
      videoStatus: "not_ready",
    });

    expect(getTransitionCardMeta(transition, "__add__")).toMatchObject({
      title: "Transition 1 -> 2",
      prompt: "No transition prompt yet",
      statusLabel: "Generate",
      action: {
        label: "Generate Clip",
      },
    });
  });

  test("uses the selected clip prompt in transition card metadata", () => {
    const selectedVersion = createTransitionVersion("transitionver_selected", {
      sourcePrompt: "Selected clip prompt",
    });
    const transition = createTransitionView({
      galleryVersions: [selectedVersion],
      latestVideoVersion: selectedVersion,
      currentVideo: selectedVersion,
    });

    expect(getTransitionCardMeta(transition, selectedVersion.id)).toMatchObject({
      prompt: "Selected clip prompt",
      promptPlaceholder: false,
    });
  });

  test("uses the selected clip prompt to prefill transition generation", () => {
    const selectedVersion = createTransitionVersion("transitionver_selected", {
      sourcePrompt: "Selected clip prompt",
    });
    const transition = createTransitionView({
      galleryVersions: [selectedVersion],
      latestVideoVersion: selectedVersion,
      currentVideo: selectedVersion,
    });

    expect(getTransitionGenerationDraft(transition, selectedVersion.id)).toEqual({
      modelId: "bytedance/seedance-v1.5-pro/image-to-video",
      prompt: "Selected clip prompt",
      settings: {
        aspectRatio: "1:1",
        cameraFixed: true,
        duration: "4",
        generateAudio: true,
        resolution: "480p",
      },
      systemPromptTemplate: "{{prompt}}",
    });
  });

  test("auto-selects the new clip after generation when the current clip had been selected", () => {
    expect(
      shouldAutoSelectGeneratedTile({
        selectedTileId: "transitionver_current",
        addTileId: "__add__",
        defaultTileId: "transitionver_generated",
        previousDefaultTileId: "transitionver_current",
        wasPending: true,
        isPending: false,
      }),
    ).toBe(true);
  });

  test("does not override a manually selected alternate clip after generation completes", () => {
    expect(
      shouldAutoSelectGeneratedTile({
        selectedTileId: "transitionver_alternate",
        addTileId: "__add__",
        defaultTileId: "transitionver_generated",
        previousDefaultTileId: "transitionver_current",
        wasPending: true,
        isPending: false,
      }),
    ).toBe(false);
  });

  test("detects active queued or running generation jobs", () => {
    expect(
      hasActiveGenerationJobs({
        manifest: {
          ...createEmptyManifest("moviegen"),
          jobs: [
            {
              id: "job_1",
              kind: "frame_image",
              targetId: "framecand_1",
              targetParentId: "frame_1",
              provider: "atlas",
              model: "mock-model",
              status: "running",
              requestPayload: {},
              providerPredictionId: null,
              errorMessage: null,
              startedAt: null,
              completedAt: null,
              createdAt: "2026-04-03T00:00:00.000Z",
              updatedAt: "2026-04-03T00:00:00.000Z",
            },
          ],
        },
      } as const),
    ).toBe(true);
    expect(
      hasActiveGenerationJobs({
        manifest: createEmptyManifest("moviegen"),
      } as const),
    ).toBe(false);
  });

  test("rejects stale sync responses", () => {
    expect(shouldApplySyncedSnapshot(3, 3)).toBe(true);
    expect(shouldApplySyncedSnapshot(2, 3)).toBe(false);
  });

  test("reconciles a reloaded pending frame to the finished asset on refresh", () => {
    const currentVersion = createVersion("framever_current", {
      sourcePrompt: "Current prompt",
    });
    const generatedVersion = createVersion("framever_generated", {
      sourcePrompt: "Generated prompt",
    });
    const snapshot = {
      projectPath: "/tmp/moviegen",
      manifest: createEmptyManifest("moviegen"),
      frames: [
        createFrameView({
          id: "frame_reload",
          status: "generated_unreviewed",
          currentVersion: generatedVersion,
          latestVersion: generatedVersion,
          approvedVersion: currentVersion,
          galleryVersions: [currentVersion, generatedVersion],
        }),
      ],
      transitions: [],
      tracks: [],
    } as const;

    const nextState = reconcileGallerySelectionAfterSnapshot({
      currentSelection: {},
      snapshot: snapshot as never,
      addTileId: "__add__",
      previousPendingByEntry: {
        "frame:frame_reload": true,
      },
      previousDefaultTileByEntry: {
        "frame:frame_reload": currentVersion.id,
      },
    });

    expect(nextState.pendingByEntry["frame:frame_reload"]).toBe(false);
    expect(nextState.defaultTileByEntry["frame:frame_reload"]).toBe(generatedVersion.id);
    expect(nextState.selection["frame:frame_reload"]).toBeUndefined();
  });

  test("uses the first refresh after reload to show a completed clip immediately", () => {
    const currentVideo = createTransitionVersion("transitionver_current", {
      sourcePrompt: "Current prompt",
    });
    const generatedVideo = createTransitionVersion("transitionver_generated", {
      sourcePrompt: "Generated prompt",
    });
    const transition = createTransitionView({
      id: "transition_reload",
      videoStatus: "generated_unreviewed",
      currentVideo: generatedVideo,
      latestVideoVersion: generatedVideo,
      approvedVideoVersion: currentVideo,
      galleryVersions: [currentVideo, generatedVideo],
    });
    const snapshot = {
      projectPath: "/tmp/moviegen",
      manifest: createEmptyManifest("moviegen"),
      frames: [transition.fromFrame, transition.toFrame],
      transitions: [transition],
      tracks: [],
    } as const;

    const nextState = reconcileGallerySelectionAfterSnapshot({
      currentSelection: {},
      snapshot: snapshot as never,
      addTileId: "__add__",
      previousPendingByEntry: {
        "transition:transition_reload": true,
      },
      previousDefaultTileByEntry: {
        "transition:transition_reload": currentVideo.id,
      },
    });

    expect(nextState.pendingByEntry["transition:transition_reload"]).toBe(false);
    expect(nextState.defaultTileByEntry["transition:transition_reload"]).toBe(generatedVideo.id);
    expect(nextState.selection["transition:transition_reload"]).toBeUndefined();
  });
});

describe("bulk frame helpers", () => {
  test("pairs uploaded images with prompt lines in order", () => {
    expect(
      buildBulkFrameRows("First shot\nSecond shot", ["refs/a.png"]),
    ).toEqual([
      {
        imagePrompt: "First shot",
        referenceImages: ["refs/a.png"],
        usePreviousFrameAsReference: false,
      },
      {
        imagePrompt: "Second shot",
      },
    ]);
  });

  test("keeps extra images as image-led frames", () => {
    expect(
      buildBulkFrameRows("First shot", ["refs/a.png", "refs/b.png"]),
    ).toEqual([
      {
        imagePrompt: "First shot",
        referenceImages: ["refs/a.png"],
        usePreviousFrameAsReference: false,
      },
      {
        imagePrompt: "",
        referenceImages: ["refs/b.png"],
        usePreviousFrameAsReference: false,
      },
    ]);
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
      missingInputCount: 1,
      actionableGenerationCount: 2,
      inProgressCount: 2,
    });
  });

  test("prioritizes frame prompt gaps before ready generation and pending work", () => {
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
      kind: "frame",
      entryId: "frame_2",
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
