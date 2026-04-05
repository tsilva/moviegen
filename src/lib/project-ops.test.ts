import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildProjectSnapshot,
  createEmptyManifest,
  createId,
  nowIso,
  reconcileTransitions,
  reorderFrames,
} from "./project-ops";
import type { Frame, FrameVersion } from "./types";
import { deleteFrameFromProject, deleteTransitionFromProject } from "./delete-ops";

function frame(name: string): Frame {
  const timestamp = nowIso();
  return {
    id: createId("frame"),
    position: 0,
    imagePrompt: `${name} prompt`,
    referenceImages: [],
    usePreviousFrameAsReference: false,
    generationOverrides: {},
    approvedVersionId: null,
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function frameVersion(id: string): FrameVersion {
  return {
    id,
    model: "mock-model",
    inputPayload: {},
    outputPath: `frames/${id}.png`,
    thumbnailPath: `frames/${id}.png`,
    generationJobId: createId("job"),
    createdAt: nowIso(),
    reviewerDecision: "unreviewed" as const,
    reviewerNotes: "",
    sourcePrompt: null,
    usePreviousFrameAsReference: null,
    dependencyFrameId: null,
    dependencyVersionId: null,
  };
}

describe("project transition reconciliation", () => {
  test("creates active adjacency transitions in frame order", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);

    expect(manifest.transitions).toHaveLength(2);
    expect(manifest.transitions.map((transition) => [transition.fromFrameId, transition.toFrameId])).toEqual([
      [first.id, second.id],
      [second.id, third.id],
    ]);
  });

  test("archives invalidated transition and creates new pair after reorder", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);

    reorderFrames(manifest, [first.id, third.id, second.id]);
    reconcileTransitions(manifest);

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(
      snapshot.transitions.map((transition) => [transition.fromFrame.position, transition.toFrame.position]),
    ).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(
      manifest.transitions.filter((transition) => transition.sequenceScope === "archived").length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("transitions become generatable when adjacent frames have generated versions even without a prompt", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    first.versions.push(frameVersion("framever_a"));
    second.versions.push(frameVersion("framever_b"));
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions).toHaveLength(1);
    expect(snapshot.transitions[0]?.promptStatus).toBe("needs_confirmation");
    expect(snapshot.transitions[0]?.nextAction).toBe("generate");
  });

  test("transitions block when the source frame is explicitly unselected", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const firstVersion = frameVersion("framever_a");
    const secondVersion = frameVersion("framever_b");
    first.versions.push(firstVersion);
    second.versions.push(secondVersion);
    first.transitionEndpointSelected = false;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions).toHaveLength(1);
    expect(snapshot.transitions[0]?.promptStatus).toBe("blocked");
    expect(snapshot.transitions[0]?.nextAction).toBeNull();
    expect(snapshot.transitions[0]?.disabledReason).toBe("Select a source frame asset before generating this clip");
  });

  test("transition next action becomes generate without a prompt once endpoints are confirmed", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const firstVersion = frameVersion("framever_a");
    const secondVersion = frameVersion("framever_b");
    first.versions.push(firstVersion);
    second.versions.push(secondVersion);
    first.approvedVersionId = firstVersion.id;
    second.approvedVersionId = secondVersion.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);
    manifest.transitions[0]!.confirmedFromVersionId = firstVersion.id;
    manifest.transitions[0]!.confirmedToVersionId = secondVersion.id;

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions[0]?.promptStatus).toBe("confirmed");
    expect(snapshot.transitions[0]?.nextAction).toBe("generate");
  });

  test("transition stays generatable when the target frame is still missing", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const firstVersion = frameVersion("framever_a");
    first.versions.push(firstVersion);
    first.approvedVersionId = firstVersion.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);
    manifest.transitions[0]!.confirmedFromVersionId = firstVersion.id;

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions[0]?.promptStatus).toBe("confirmed");
    expect(snapshot.transitions[0]?.nextAction).toBe("generate");
    expect(snapshot.transitions[0]?.blockedByFrameIds).toEqual([]);
  });

  test("frame next actions require prompts before generation work", () => {
    const manifest = createEmptyManifest("test");
    const blankDraft = { ...frame("Blank"), imagePrompt: "" };
    const draft = frame("Draft");
    const candidateOnly = frame("Candidate only");
    const approved = frame("Approved");
    const reviewVersion = frameVersion("framever_review");
    const approvedVersion = frameVersion("framever_approved");

    candidateOnly.versions.push(reviewVersion);
    approved.versions.push(approvedVersion);
    approved.approvedVersionId = approvedVersion.id;
    manifest.frames = [blankDraft, draft, candidateOnly, approved].map((item, index) => ({
      ...item,
      position: index,
    }));

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");

    expect(snapshot.frames.map((item) => item.status)).toEqual([
      "draft",
      "draft",
      "generated_unreviewed",
      "approved",
    ]);
    expect(snapshot.frames.map((item) => [item.position, item.nextAction])).toEqual([
      [0, "write_prompt"],
      [1, "generate"],
      [2, null],
      [3, null],
    ]);
  });

  test("retains the latest failed frame job in the snapshot", () => {
    const manifest = createEmptyManifest("test");
    const draft = frame("Broken");
    const createdAt = nowIso();
    manifest.frames = [{ ...draft, position: 0 }];
    manifest.jobs.push({
      id: createId("job"),
      kind: "frame_image",
      targetId: draft.id,
      targetParentId: draft.id,
      provider: "atlas",
      model: "wan",
      status: "error",
      requestPayload: { prompt: "broken prompt" },
      providerPredictionId: "pred_1",
      errorMessage: "Upstream provider failed",
      startedAt: createdAt,
      completedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");

    expect(snapshot.frames[0]?.status).toBe("error");
    expect(snapshot.frames[0]?.latestErrorJob).toMatchObject({
      status: "error",
      errorMessage: "Upstream provider failed",
      requestPayload: { prompt: "broken prompt" },
    });
  });

  test("transition next action becomes generate once prompt exists and endpoints are available", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const firstVersion = frameVersion("framever_a");
    const secondVersion = frameVersion("framever_b");
    first.versions.push(firstVersion);
    second.versions.push(secondVersion);
    first.approvedVersionId = firstVersion.id;
    second.approvedVersionId = secondVersion.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);
    manifest.transitions[0]!.transitionPrompt = "Slow cinematic push";

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions[0]?.nextAction).toBe("generate");
    expect(snapshot.transitions[0]?.disabledReason).toBeNull();
  });

  test("transition remains generatable once a matching clip exists", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const firstVersion = frameVersion("framever_a");
    const secondVersion = frameVersion("framever_b");
    first.versions.push(firstVersion);
    second.versions.push(secondVersion);
    first.approvedVersionId = firstVersion.id;
    second.approvedVersionId = secondVersion.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);

    const transition = manifest.transitions[0]!;
    transition.transitionPrompt = "Slow cinematic push";
    transition.promptRevision = 1;
    transition.confirmedFromVersionId = firstVersion.id;
    transition.confirmedToVersionId = secondVersion.id;
    transition.versions.push({
      id: createId("transitionver"),
      model: "mock-video-model",
      inputPayload: {},
      outputPath: "transitions/clip.mp4",
      posterPath: "transitions/poster.png",
      generationJobId: createId("job"),
      createdAt: nowIso(),
      reviewerDecision: "unreviewed",
      reviewerNotes: "",
      promptRevision: 1,
      fromApprovedVersionId: firstVersion.id,
      toApprovedVersionId: secondVersion.id,
    });

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions[0]?.videoStatus).toBe("generated_unreviewed");
    expect(snapshot.transitions[0]?.nextAction).toBe("generate");
    expect(snapshot.tracks[0]?.slots.transition.canGenerate).toBe(true);
  });

  test("approved frame stays selected when a newer alternate candidate exists", () => {
    const manifest = createEmptyManifest("test");
    const current = frame("Current");
    const approvedVersion = {
      ...frameVersion("framever_current"),
      sourcePrompt: current.imagePrompt,
    };
    const alternateVersion = {
      ...frameVersion("framever_alternate"),
      sourcePrompt: current.imagePrompt,
    };

    current.versions.push(approvedVersion, alternateVersion);
    current.approvedVersionId = approvedVersion.id;
    manifest.frames = [{ ...current, position: 0 }];

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.frames[0]?.status).toBe("approved");
    expect(snapshot.frames[0]?.currentVersion?.id).toBe(approvedVersion.id);
    expect(snapshot.frames[0]?.latestVersion?.id).toBe(alternateVersion.id);
    expect(snapshot.frames[0]?.galleryVersions.map((version) => version.id)).toEqual([
      alternateVersion.id,
      approvedVersion.id,
    ]);
  });

  test("frame entry prompt changes do not make compatible versions stale", () => {
    const manifest = createEmptyManifest("test");
    const current = frame("Current");
    const approvedVersion = {
      ...frameVersion("framever_current"),
      sourcePrompt: "Original prompt",
    };

    current.versions.push(approvedVersion);
    current.approvedVersionId = approvedVersion.id;
    current.imagePrompt = "Revised draft prompt";
    manifest.frames = [{ ...current, position: 0 }];

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.frames[0]?.status).toBe("approved");
    expect(snapshot.frames[0]?.currentVersion?.id).toBe(approvedVersion.id);
    expect(snapshot.frames[0]?.galleryVersions.map((version) => version.id)).toEqual([
      approvedVersion.id,
    ]);
  });

  test("frame gallery keeps multiple prompt variants when dependency state still matches", () => {
    const manifest = createEmptyManifest("test");
    const current = frame("Current");
    const firstCompatible = {
      ...frameVersion("framever_first"),
      sourcePrompt: "First prompt variant",
    };
    const secondCompatible = {
      ...frameVersion("framever_second"),
      sourcePrompt: "Second prompt variant",
    };

    current.versions.push(firstCompatible, secondCompatible);
    current.approvedVersionId = firstCompatible.id;
    manifest.frames = [{ ...current, position: 0 }];

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.frames[0]?.galleryVersions.map((version) => version.id)).toEqual([
      secondCompatible.id,
      firstCompatible.id,
    ]);
  });

  test("frame gallery hides versions whose upstream dependency no longer matches", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    second.usePreviousFrameAsReference = true;

    const firstOld = frameVersion("framever_first_old");
    const firstNew = frameVersion("framever_first_new");
    const staleVersion = {
      ...frameVersion("framever_second_stale"),
      sourcePrompt: "Second prompt",
      usePreviousFrameAsReference: true,
      dependencyFrameId: first.id,
      dependencyVersionId: firstOld.id,
    };
    const currentVersion = {
      ...frameVersion("framever_second_current"),
      sourcePrompt: "Second prompt updated",
      usePreviousFrameAsReference: true,
      dependencyFrameId: first.id,
      dependencyVersionId: firstNew.id,
    };

    first.versions.push(firstOld, firstNew);
    first.approvedVersionId = firstNew.id;
    second.versions.push(staleVersion, currentVersion);
    second.approvedVersionId = currentVersion.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.frames[1]?.galleryVersions.map((version) => version.id)).toEqual([
      currentVersion.id,
    ]);
  });

  test("downstream dependency flags derive from the current version metadata", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    second.usePreviousFrameAsReference = true;

    const standaloneVersion = {
      ...frameVersion("framever_second_standalone"),
      sourcePrompt: "Standalone shot",
      usePreviousFrameAsReference: false,
    };

    second.versions.push(standaloneVersion);
    second.approvedVersionId = standaloneVersion.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.frames[1]?.dependsOnPreviousFrame).toBe(false);
    expect(snapshot.frames[1]?.status).toBe("approved");
  });

  test("approved transition stays selected when a newer alternate clip exists", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const firstVersion = frameVersion("framever_a");
    const secondVersion = frameVersion("framever_b");
    first.versions.push(firstVersion);
    second.versions.push(secondVersion);
    first.approvedVersionId = firstVersion.id;
    second.approvedVersionId = secondVersion.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);

    const transition = manifest.transitions[0]!;
    transition.transitionPrompt = "Slow cinematic push";
    transition.promptRevision = 1;
    transition.confirmedFromVersionId = firstVersion.id;
    transition.confirmedToVersionId = secondVersion.id;
    const approvedVideo = {
      id: createId("transitionver"),
      model: "mock-video-model",
      inputPayload: {},
      outputPath: "transitions/current.mp4",
      posterPath: "transitions/current.png",
      generationJobId: createId("job"),
      createdAt: nowIso(),
      reviewerDecision: "approved" as const,
      reviewerNotes: "",
      promptRevision: 1,
      fromApprovedVersionId: firstVersion.id,
      toApprovedVersionId: secondVersion.id,
    };
    const alternateVideo = {
      ...approvedVideo,
      id: createId("transitionver"),
      outputPath: "transitions/alternate.mp4",
      posterPath: "transitions/alternate.png",
      generationJobId: createId("job"),
      reviewerDecision: "unreviewed" as const,
    };
    transition.versions.push(approvedVideo, alternateVideo);
    transition.approvedVideoVersionId = approvedVideo.id;

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions[0]?.videoStatus).toBe("approved");
    expect(snapshot.transitions[0]?.currentVideo?.id).toBe(approvedVideo.id);
    expect(snapshot.transitions[0]?.latestVideoVersion?.id).toBe(alternateVideo.id);
    expect(snapshot.transitions[0]?.galleryVersions.map((version) => version.id)).toEqual([
      alternateVideo.id,
      approvedVideo.id,
    ]);
  });

  test("transition gallery hides stale clips and keeps newest compatible clips first", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const firstVersion = frameVersion("framever_a");
    const secondVersion = frameVersion("framever_b");
    first.versions.push(firstVersion);
    second.versions.push(secondVersion);
    first.approvedVersionId = firstVersion.id;
    second.approvedVersionId = secondVersion.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);

    const transition = manifest.transitions[0]!;
    transition.transitionPrompt = "Slow cinematic push";
    transition.promptRevision = 1;
    transition.confirmedFromVersionId = firstVersion.id;
    transition.confirmedToVersionId = secondVersion.id;

    const staleVideo = {
      id: createId("transitionver"),
      model: "mock-video-model",
      inputPayload: {},
      outputPath: "transitions/stale.mp4",
      posterPath: "transitions/stale.png",
      generationJobId: createId("job"),
      createdAt: nowIso(),
      reviewerDecision: "unreviewed" as const,
      reviewerNotes: "",
      promptRevision: 0,
      fromApprovedVersionId: firstVersion.id,
      toApprovedVersionId: secondVersion.id,
    };
    const firstCompatible = {
      ...staleVideo,
      id: createId("transitionver"),
      outputPath: "transitions/compatible-a.mp4",
      posterPath: "transitions/compatible-a.png",
      generationJobId: createId("job"),
      promptRevision: 1,
    };
    const secondCompatible = {
      ...firstCompatible,
      id: createId("transitionver"),
      outputPath: "transitions/compatible-b.mp4",
      posterPath: "transitions/compatible-b.png",
      generationJobId: createId("job"),
    };

    transition.versions.push(staleVideo, firstCompatible, secondCompatible);
    transition.approvedVideoVersionId = firstCompatible.id;

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions[0]?.galleryVersions.map((version) => version.id)).toEqual([
      secondCompatible.id,
      firstCompatible.id,
    ]);
  });

  test("transition gallery falls back to the visible preview clip when no compatible clips remain", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const firstVersion = frameVersion("framever_a");
    const secondVersion = frameVersion("framever_b");
    first.versions.push(firstVersion);
    second.versions.push(secondVersion);
    first.approvedVersionId = firstVersion.id;
    second.approvedVersionId = secondVersion.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);

    const transition = manifest.transitions[0]!;
    transition.transitionPrompt = "Slow cinematic push";
    transition.promptRevision = 2;
    transition.confirmedFromVersionId = firstVersion.id;
    transition.confirmedToVersionId = secondVersion.id;

    const latestGeneratedVideo = {
      id: createId("transitionver"),
      model: "mock-video-model",
      inputPayload: {},
      outputPath: "transitions/generated.mp4",
      posterPath: "transitions/generated.png",
      generationJobId: createId("job"),
      createdAt: nowIso(),
      reviewerDecision: "unreviewed" as const,
      reviewerNotes: "",
      promptRevision: 1,
      fromApprovedVersionId: firstVersion.id,
      toApprovedVersionId: secondVersion.id,
    };

    transition.versions.push(latestGeneratedVideo);

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions[0]?.latestVideoVersion?.id).toBe(latestGeneratedVideo.id);
    expect(snapshot.transitions[0]?.galleryVersions.map((version) => version.id)).toEqual([
      latestGeneratedVideo.id,
    ]);
  });

  test("transition disabled reason explains blocked generation when endpoint frames are missing", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));

    reconcileTransitions(manifest);
    manifest.transitions[0]!.transitionPrompt = "Crossfade";

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions[0]?.nextAction).toBeNull();
    expect(snapshot.transitions[0]?.disabledReason).toMatch(/Waiting on Frame 1/i);
  });

  test("upstream frame changes mark the next anchored frame stale and the following frame blocked", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    second.usePreviousFrameAsReference = true;
    third.usePreviousFrameAsReference = true;

    const firstOld = {
      ...frameVersion("framever_first_old"),
      sourcePrompt: first.imagePrompt,
    };
    const firstNew = {
      ...frameVersion("framever_first_new"),
      sourcePrompt: first.imagePrompt,
    };
    const secondApproved = {
      ...frameVersion("framever_second"),
      sourcePrompt: second.imagePrompt,
      usePreviousFrameAsReference: true,
      dependencyFrameId: first.id,
      dependencyVersionId: firstOld.id,
    };
    const thirdApproved = {
      ...frameVersion("framever_third"),
      sourcePrompt: third.imagePrompt,
      usePreviousFrameAsReference: true,
      dependencyFrameId: second.id,
      dependencyVersionId: secondApproved.id,
    };

    first.versions.push(firstOld, firstNew);
    first.approvedVersionId = firstNew.id;
    second.versions.push(secondApproved);
    second.approvedVersionId = secondApproved.id;
    third.versions.push(thirdApproved);
    third.approvedVersionId = thirdApproved.id;

    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.frames.map((item) => item.status)).toEqual([
      "approved",
      "stale_dependency",
      "blocked_upstream",
    ]);
    expect(snapshot.frames[1]?.nextAction).toBe("generate");
    expect(snapshot.frames[2]?.blockedByFrameId).toBe(second.id);
  });

  test("transitions touching stale frames become blocked and stale", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    second.usePreviousFrameAsReference = true;

    const firstOld = frameVersion("framever_first_old");
    const firstNew = frameVersion("framever_first_new");
    const secondApproved = {
      ...frameVersion("framever_second"),
      sourcePrompt: second.imagePrompt,
      usePreviousFrameAsReference: true,
      dependencyFrameId: first.id,
      dependencyVersionId: firstOld.id,
    };

    first.versions.push(firstOld, firstNew);
    first.approvedVersionId = firstNew.id;
    second.versions.push(secondApproved);
    second.approvedVersionId = secondApproved.id;
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);

    const transition = manifest.transitions[0]!;
    transition.transitionPrompt = "Crossfade";
    transition.promptRevision = 1;
    transition.confirmedFromVersionId = firstOld.id;
    transition.confirmedToVersionId = secondApproved.id;
    transition.versions.push({
      id: createId("transitionver"),
      model: "mock-video-model",
      inputPayload: {},
      outputPath: "transitions/stale.mp4",
      posterPath: "transitions/stale.png",
      generationJobId: createId("job"),
      createdAt: nowIso(),
      reviewerDecision: "approved",
      reviewerNotes: "",
      promptRevision: 1,
      fromApprovedVersionId: firstOld.id,
      toApprovedVersionId: secondApproved.id,
    });
    transition.approvedVideoVersionId = transition.versions[0]!.id;

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.transitions[0]?.videoStatus).toBe("stale");
    expect(snapshot.transitions[0]?.blockedByFrameIds).toEqual([]);
    expect(snapshot.transitions[0]?.nextAction).toBe("generate");
    expect(snapshot.tracks[0]?.slots.startFrame.isStale).toBe(false);
    expect(snapshot.tracks[0]?.slots.endFrame.isStale).toBe(true);
    expect(snapshot.tracks[0]?.slots.endFrame.isBlocked).toBe(false);
    expect(snapshot.tracks[0]?.slots.transition.isStale).toBe(true);
    expect(snapshot.tracks[0]?.slots.transition.isBlocked).toBe(false);
  });

  test("builds one derived track per active transition with shared boundary frames", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");

    expect(snapshot.tracks).toHaveLength(2);
    expect(snapshot.tracks[0]?.startFrame.id).toBe(first.id);
    expect(snapshot.tracks[0]?.endFrame.id).toBe(second.id);
    expect(snapshot.tracks[1]?.startFrame.id).toBe(second.id);
    expect(snapshot.tracks[1]?.endFrame.id).toBe(third.id);
    expect(snapshot.tracks[0]?.endFrame).toBe(snapshot.tracks[1]?.startFrame);
  });

  test("maps legacy selected ids onto the first matching track slot", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);

    (
      manifest.ui as typeof manifest.ui & {
        selectedFrameId?: string | null;
        selectedTransitionId?: string | null;
      }
    ).selectedFrameId = second.id;

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");

    expect(snapshot.manifest.ui.selectedSlot).toEqual({
      trackId: snapshot.tracks[0]!.id,
      slotKind: "endFrame",
    });
  });

  test("queue ranks remain upstream to downstream after reorder", () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);
    reorderFrames(manifest, [third.id, first.id, second.id]);
    reconcileTransitions(manifest);

    const snapshot = buildProjectSnapshot(manifest, "/tmp/project");
    expect(snapshot.frames.map((item) => item.queueRank)).toEqual([0, 2, 4]);
    expect(snapshot.transitions.map((item) => item.queueRank)).toEqual([1, 3]);
  });

  test("deleting a frame archives frame and touching transition assets, then removes JSON entries", async () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    const third = frame("C");
    manifest.frames = [first, second, third].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-delete-frame-"));
    await fs.mkdir(path.join(tempDir, "frames", second.id), { recursive: true });
    await fs.mkdir(path.join(tempDir, "transitions", manifest.transitions[0]!.id), { recursive: true });
    await fs.mkdir(path.join(tempDir, "transitions", manifest.transitions[1]!.id), { recursive: true });
    await fs.writeFile(path.join(tempDir, "frames", second.id, "candidate.svg"), "<svg />");

    await deleteFrameFromProject(manifest, tempDir, second.id);

    expect(manifest.frames.map((item) => item.id)).toEqual([first.id, third.id]);
    expect(manifest.transitions.filter((transition) => transition.sequenceScope === "active")).toHaveLength(1);
    expect(manifest.transitions[0]?.fromFrameId).toBe(first.id);
    expect(manifest.transitions[0]?.toFrameId).toBe(third.id);

    const deletedFrameEntries = await fs.readdir(path.join(tempDir, "deleted", "frames"));
    const deletedTransitionEntries = await fs.readdir(path.join(tempDir, "deleted", "transitions"));
    expect(deletedFrameEntries.some((entry) => entry.startsWith(second.id))).toBe(true);
    expect(deletedTransitionEntries).toHaveLength(2);
  });

  test("deleting a transition archives its assets and creates a fresh blank transition for the same adjacency", async () => {
    const manifest = createEmptyManifest("test");
    const first = frame("A");
    const second = frame("B");
    manifest.frames = [first, second].map((item, index) => ({ ...item, position: index }));
    reconcileTransitions(manifest);
    const [transition] = manifest.transitions;
    if (!transition) {
      throw new Error("Transition not created");
    }
    transition.transitionPrompt = "Old transition prompt";

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moviegen-delete-transition-"));
    await fs.mkdir(path.join(tempDir, "transitions", transition.id), { recursive: true });
    await fs.writeFile(path.join(tempDir, "transitions", transition.id, "clip.svg"), "<svg />");

    await deleteTransitionFromProject(manifest, tempDir, transition.id);

    expect(manifest.transitions).toHaveLength(1);
    expect(manifest.transitions[0]?.id).not.toBe(transition.id);
    expect(manifest.transitions[0]?.transitionPrompt).toBe("");
    const deletedTransitionEntries = await fs.readdir(path.join(tempDir, "deleted", "transitions"));
    expect(deletedTransitionEntries.some((entry) => entry.startsWith(transition.id))).toBe(true);
  });
});
