import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { generateFrameImagesMock, generateTransitionVideoMock } = vi.hoisted(() => ({
  generateFrameImagesMock: vi.fn(),
  generateTransitionVideoMock: vi.fn(),
}));

vi.mock("./provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./provider")>();
  return {
    ...actual,
    generateFrameImages: generateFrameImagesMock,
    generateTransitionVideo: generateTransitionVideoMock,
  };
});

import {
  createEmptyManifest,
  createId,
  nowIso,
  reconcileTransitions,
  reorderFrames,
} from "./project-ops";
import { enqueueFrameGeneration, enqueueTransitionGeneration } from "./job-runner";
import { readProjectSnapshot, saveManifest, setCurrentProjectPath } from "./project-store";
import type { Frame, FrameVersion, ProjectManifest } from "./types";

function createFrame(name: string, position: number): Frame {
  const timestamp = nowIso();
  return {
    id: createId("frame"),
    position,
    imagePrompt: `${name} prompt`,
    referenceImages: [],
    usePreviousFrameAsReference: false,
    approvedVersionId: null,
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createFrameVersion(
  outputPath: string,
  overrides: Partial<FrameVersion> = {},
): FrameVersion {
  const id = createId("framever");
  return {
    id,
    model: "mock-model",
    inputPayload: {},
    outputPath,
    thumbnailPath: outputPath,
    generationJobId: createId("job"),
    createdAt: nowIso(),
    reviewerDecision: "unreviewed" as const,
    reviewerNotes: "",
    sourcePrompt: null,
    usePreviousFrameAsReference: null,
    dependencyFrameId: null,
    dependencyVersionId: null,
    ...overrides,
  };
}

async function createTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "moviegen-job-runner-"));
}

async function seedProject(projectPath: string, manifestFactory: () => ProjectManifest) {
  const manifest = manifestFactory();
  await saveManifest(projectPath, manifest);
  setCurrentProjectPath(projectPath);
  return manifest;
}

async function waitForFrameJobToSettle(projectPath: string) {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const snapshot = await readProjectSnapshot(projectPath);
    const hasActiveFrameJobs = snapshot.manifest.jobs.some(
      (job) =>
        job.kind === "frame_image" && (job.status === "queued" || job.status === "running"),
    );

    if (!hasActiveFrameJobs) {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for frame job to settle");
}

async function waitForTransitionJobToSettle(projectPath: string) {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const snapshot = await readProjectSnapshot(projectPath);
    const hasActiveTransitionJobs = snapshot.manifest.jobs.some(
      (job) =>
        job.kind === "transition_video" && (job.status === "queued" || job.status === "running"),
    );

    if (!hasActiveTransitionJobs) {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for transition job to settle");
}

async function waitForJobToStart(
  projectPath: string,
  kind: "frame_image" | "transition_video",
) {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const snapshot = await readProjectSnapshot(projectPath);
    const activeJob = snapshot.manifest.jobs.find(
      (job) => job.kind === kind && job.status === "running",
    );

    if (activeJob) {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${kind} job to start`);
}

describe("frame job anchoring", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    generateFrameImagesMock.mockReset();
    generateTransitionVideoMock.mockReset();
    generateFrameImagesMock.mockResolvedValue([
      {
        model: "mock-edit-model",
        providerPredictionId: "pred_test",
        relativePath: path.join("frames", "generated", "candidate.png"),
        inputPayload: { model: "mock-edit-model" },
      },
    ]);
    generateTransitionVideoMock.mockResolvedValue({
      model: "mock-video-model",
      providerPredictionId: "pred_transition",
      relativePath: path.join("transitions", "generated", "clip.mp4"),
      posterRelativePath: path.join("transitions", "generated", "poster.png"),
      inputPayload: { model: "mock-video-model" },
    });
  });

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).__moviegenRuntimeState__;
    delete (globalThis as Record<string, unknown>).__moviegenJobRunnerState__;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  });

  test("uses explicit reference images when previous-frame anchoring is off", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const secondReference = path.join("refs", "custom.png");
    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      second.referenceImages = [secondReference];
      draft.frames = [first, second];
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[1]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [secondReference],
      }),
    );
  });

  test("does not error when previous-frame anchoring is enabled on the first frame", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const firstReference = path.join("refs", "opening-shot.png");
    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      first.referenceImages = [firstReference];
      first.usePreviousFrameAsReference = true;
      draft.frames = [first, second];
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[0]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    const snapshot = await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [firstReference],
      }),
    );
    expect(snapshot.manifest.jobs[0]?.status).toBe("completed");
  });

  test("first generated frame auto-approves itself", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      draft.frames = [first];
      return draft;
    });

    const queuedSnapshot = await enqueueFrameGeneration([manifest.frames[0]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    expect(queuedSnapshot.manifest.frames[0]?.approvedVersionId).toBeNull();

    const snapshot = await waitForFrameJobToSettle(projectPath);
    const generatedFrame = snapshot.manifest.frames[0]!;
    const approvedVersion = generatedFrame.versions.find(
      (version) => version.id === generatedFrame.approvedVersionId,
    );

    expect(generatedFrame.approvedVersionId).toBeTruthy();
    expect(approvedVersion?.reviewerDecision).toBe("approved");
  });

  test("new generated frame replaces an existing current frame when it is still current", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const approvedVersion = createFrameVersion(path.join("frames", "first", "approved.png"), {
        sourcePrompt: first.imagePrompt,
      });
      first.versions.push(approvedVersion);
      first.approvedVersionId = approvedVersion.id;
      draft.frames = [first];
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[0]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    const snapshot = await waitForFrameJobToSettle(projectPath);
    const generatedFrame = snapshot.manifest.frames[0]!;
    const latestVersion = generatedFrame.versions.at(-1);

    expect(generatedFrame.approvedVersionId).toBe(latestVersion?.id);
    expect(latestVersion?.reviewerDecision).toBe("approved");
  });

  test("does not replace the current frame when the prompt changes while generation is in flight", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    let resolveGeneration: ((value: Awaited<ReturnType<typeof generateFrameImagesMock>>) => void) | null = null;
    generateFrameImagesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
    );

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const approvedVersion = createFrameVersion(path.join("frames", "first", "approved.png"), {
        sourcePrompt: first.imagePrompt,
      });
      first.versions.push(approvedVersion);
      first.approvedVersionId = approvedVersion.id;
      draft.frames = [first];
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[0]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    await waitForJobToStart(projectPath, "frame_image");

    const pendingSnapshot = await readProjectSnapshot(projectPath);
    pendingSnapshot.manifest.frames[0]!.imagePrompt = "First prompt revised";
    await saveManifest(projectPath, pendingSnapshot.manifest);

    resolveGeneration?.([
      {
        model: "mock-edit-model",
        providerPredictionId: "pred_prompt_change",
        relativePath: path.join("frames", "generated", "revised-late.png"),
        inputPayload: { model: "mock-edit-model" },
      },
    ]);

    const snapshot = await waitForFrameJobToSettle(projectPath);
    const generatedFrame = snapshot.manifest.frames[0]!;
    const latestVersion = generatedFrame.versions.at(-1);

    expect(generatedFrame.approvedVersionId).toBe(manifest.frames[0]!.approvedVersionId);
    expect(latestVersion?.reviewerDecision).toBe("unreviewed");
    expect(latestVersion?.sourcePrompt).toBe("First prompt");
  });

  test("uses the previous approved frame as the anchor reference", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const approvedPath = path.join("frames", "first", "approved.png");
    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      const approvedVersion = createFrameVersion(approvedPath);
      const latestVersion = createFrameVersion(path.join("frames", "first", "latest.png"));
      first.versions.push(approvedVersion, latestVersion);
      first.approvedVersionId = approvedVersion.id;
      second.referenceImages = [path.join("refs", "ignored.png")];
      second.usePreviousFrameAsReference = true;
      draft.frames = [first, second];
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[1]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [approvedPath],
      }),
    );
  });

  test("falls back to the previous frame latest candidate when there is no approved version", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const latestPath = path.join("frames", "first", "latest.png");
    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      first.versions.push(createFrameVersion(latestPath));
      second.usePreviousFrameAsReference = true;
      draft.frames = [first, second];
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[1]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [latestPath],
      }),
    );
  });

  test("errors when anchoring is enabled but the previous frame has no generated image", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      second.usePreviousFrameAsReference = true;
      draft.frames = [first, second];
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[1]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    const snapshot = await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).not.toHaveBeenCalled();
    expect(snapshot.manifest.jobs[0]?.status).toBe("error");
    expect(snapshot.manifest.jobs[0]?.errorMessage).toMatch(/does not have a generated image/);
  });

  test("uses the current preceding frame after frames are reordered", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const firstApprovedPath = path.join("frames", "first", "approved.png");
    const secondApprovedPath = path.join("frames", "second", "approved.png");
    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      const third = createFrame("Third", 2);
      const firstApproved = createFrameVersion(firstApprovedPath);
      const secondApproved = createFrameVersion(secondApprovedPath);
      first.versions.push(firstApproved);
      second.versions.push(secondApproved);
      first.approvedVersionId = firstApproved.id;
      second.approvedVersionId = secondApproved.id;
      third.usePreviousFrameAsReference = true;
      draft.frames = [first, second, third];
      reorderFrames(draft, [second.id, first.id, third.id]);
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[2]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [firstApprovedPath],
      }),
    );
  });

  test("passes a single anchored reference image into frame generation", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const approvedPath = path.join("frames", "first", "approved.png");
    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      const approvedVersion = createFrameVersion(approvedPath);
      first.versions.push(approvedVersion);
      first.approvedVersionId = approvedVersion.id;
      second.usePreviousFrameAsReference = true;
      second.referenceImages = [path.join("refs", "a.png"), path.join("refs", "b.png")];
      draft.frames = [first, second];
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[1]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [approvedPath],
      }),
    );
    expect(generateFrameImagesMock.mock.calls[0]?.[0].referenceImages).toHaveLength(1);
  });

  test("transition generation implicitly confirms the current endpoints before queueing", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const fromOutputPath = path.join("frames", "first", "approved.png");
    const toOutputPath = path.join("frames", "second", "approved.png");

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      const firstVersion = createFrameVersion(fromOutputPath);
      const secondVersion = createFrameVersion(toOutputPath);
      first.versions.push(firstVersion);
      second.versions.push(secondVersion);
      first.approvedVersionId = firstVersion.id;
      second.approvedVersionId = secondVersion.id;
      draft.frames = [first, second];
      reconcileTransitions(draft);
      draft.transitions[0]!.transitionPrompt = "Match cut";
      draft.transitions[0]!.invalidationReason = "endpoint_versions_changed";
      return draft;
    });

    const queuedSnapshot = await enqueueTransitionGeneration([manifest.transitions[0]!.id], {
      duration: 4,
      size: "1280x720",
      fps: 24,
    });

    expect(queuedSnapshot.manifest.transitions[0]?.confirmedFromVersionId).toBe(
      manifest.frames[0]!.approvedVersionId,
    );
    expect(queuedSnapshot.manifest.transitions[0]?.confirmedToVersionId).toBe(
      manifest.frames[1]!.approvedVersionId,
    );
    expect(queuedSnapshot.manifest.transitions[0]?.invalidationReason).toBeNull();
    expect(queuedSnapshot.manifest.jobs.at(-1)?.requestPayload).toMatchObject({
      prompt: "Match cut",
      fromApprovedVersionId: manifest.frames[0]!.approvedVersionId,
      toApprovedVersionId: manifest.frames[1]!.approvedVersionId,
    });

    const settledSnapshot = await waitForTransitionJobToSettle(projectPath);
    const generatedTransition = settledSnapshot.manifest.transitions[0]!;
    const approvedVideo = generatedTransition.versions.find(
      (version) => version.id === generatedTransition.approvedVideoVersionId,
    );

    expect(generateTransitionVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromImagePath: fromOutputPath,
        toImagePath: toOutputPath,
        prompt: "Match cut",
      }),
    );
    expect(generatedTransition.approvedVideoVersionId).toBeTruthy();
    expect(approvedVideo?.reviewerDecision).toBe("approved");
  });

  test("new generated transition replaces an existing current clip when it is still current", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const fromOutputPath = path.join("frames", "first", "approved.png");
    const toOutputPath = path.join("frames", "second", "approved.png");

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      const firstVersion = createFrameVersion(fromOutputPath);
      const secondVersion = createFrameVersion(toOutputPath);
      first.versions.push(firstVersion);
      second.versions.push(secondVersion);
      first.approvedVersionId = firstVersion.id;
      second.approvedVersionId = secondVersion.id;
      draft.frames = [first, second];
      reconcileTransitions(draft);

      const transition = draft.transitions[0]!;
      transition.transitionPrompt = "Match cut";
      transition.promptRevision = 1;
      transition.confirmedFromVersionId = firstVersion.id;
      transition.confirmedToVersionId = secondVersion.id;
      transition.versions.push({
        id: createId("transitionver"),
        model: "mock-video-model",
        inputPayload: {},
        outputPath: "transitions/current.mp4",
        posterPath: "transitions/current.png",
        generationJobId: createId("job"),
        createdAt: nowIso(),
        reviewerDecision: "approved",
        reviewerNotes: "",
        promptRevision: 1,
        fromApprovedVersionId: firstVersion.id,
        toApprovedVersionId: secondVersion.id,
      });
      transition.approvedVideoVersionId = transition.versions[0]!.id;

      return draft;
    });

    await enqueueTransitionGeneration([manifest.transitions[0]!.id], {
      duration: 4,
      size: "1280x720",
      fps: 24,
    });

    const snapshot = await waitForTransitionJobToSettle(projectPath);
    const generatedTransition = snapshot.manifest.transitions[0]!;
    const latestVersion = generatedTransition.versions.at(-1);

    expect(generatedTransition.approvedVideoVersionId).toBe(latestVersion?.id);
    expect(latestVersion?.reviewerDecision).toBe("approved");
  });

  test("does not replace the current transition when the prompt revision changes while generation is in flight", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    let resolveGeneration: ((value: Awaited<ReturnType<typeof generateTransitionVideoMock>>) => void) | null = null;
    generateTransitionVideoMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
    );

    const fromOutputPath = path.join("frames", "first", "approved.png");
    const toOutputPath = path.join("frames", "second", "approved.png");

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      const firstVersion = createFrameVersion(fromOutputPath);
      const secondVersion = createFrameVersion(toOutputPath);
      first.versions.push(firstVersion);
      second.versions.push(secondVersion);
      first.approvedVersionId = firstVersion.id;
      second.approvedVersionId = secondVersion.id;
      draft.frames = [first, second];
      reconcileTransitions(draft);

      const transition = draft.transitions[0]!;
      transition.transitionPrompt = "Match cut";
      transition.promptRevision = 1;
      transition.confirmedFromVersionId = firstVersion.id;
      transition.confirmedToVersionId = secondVersion.id;
      transition.versions.push({
        id: createId("transitionver"),
        model: "mock-video-model",
        inputPayload: {},
        outputPath: "transitions/current.mp4",
        posterPath: "transitions/current.png",
        generationJobId: createId("job"),
        createdAt: nowIso(),
        reviewerDecision: "approved",
        reviewerNotes: "",
        promptRevision: 1,
        fromApprovedVersionId: firstVersion.id,
        toApprovedVersionId: secondVersion.id,
      });
      transition.approvedVideoVersionId = transition.versions[0]!.id;

      return draft;
    });

    await enqueueTransitionGeneration([manifest.transitions[0]!.id], {
      duration: 4,
      size: "1280x720",
      fps: 24,
    });

    await waitForJobToStart(projectPath, "transition_video");

    const pendingSnapshot = await readProjectSnapshot(projectPath);
    pendingSnapshot.manifest.transitions[0]!.transitionPrompt = "Match cut revised";
    pendingSnapshot.manifest.transitions[0]!.promptRevision = 2;
    await saveManifest(projectPath, pendingSnapshot.manifest);

    resolveGeneration?.({
      model: "mock-video-model",
      providerPredictionId: "pred_transition_prompt_change",
      relativePath: path.join("transitions", "generated", "late-clip.mp4"),
      posterRelativePath: path.join("transitions", "generated", "late-poster.png"),
      inputPayload: { model: "mock-video-model" },
    });

    const snapshot = await waitForTransitionJobToSettle(projectPath);
    const generatedTransition = snapshot.manifest.transitions[0]!;
    const latestVersion = generatedTransition.versions.at(-1);

    expect(generatedTransition.approvedVideoVersionId).toBe(manifest.transitions[0]!.approvedVideoVersionId);
    expect(latestVersion?.reviewerDecision).toBe("unreviewed");
    expect(latestVersion?.promptRevision).toBe(1);
  });

  test("transition generation allows an empty prompt", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const fromOutputPath = path.join("frames", "first", "approved.png");
    const toOutputPath = path.join("frames", "second", "approved.png");

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      const firstVersion = createFrameVersion(fromOutputPath);
      const secondVersion = createFrameVersion(toOutputPath);
      first.versions.push(firstVersion);
      second.versions.push(secondVersion);
      first.approvedVersionId = firstVersion.id;
      second.approvedVersionId = secondVersion.id;
      draft.frames = [first, second];
      reconcileTransitions(draft);
      return draft;
    });

    const queuedSnapshot = await enqueueTransitionGeneration([manifest.transitions[0]!.id], {
      duration: 4,
      size: "1280x720",
      fps: 24,
    });

    expect(queuedSnapshot.manifest.jobs.at(-1)?.requestPayload).toMatchObject({
      prompt: "",
    });

    await waitForTransitionJobToSettle(projectPath);

    expect(generateTransitionVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "",
        fromImagePath: fromOutputPath,
        toImagePath: toOutputPath,
      }),
    );
  });

  test("stale dependent frames are not treated as current transition endpoints", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      second.usePreviousFrameAsReference = true;

      const firstOld = createFrameVersion(path.join("frames", "first", "old.png"));
      const firstNew = createFrameVersion(path.join("frames", "first", "new.png"));
      const secondApproved = createFrameVersion(path.join("frames", "second", "approved.png"), {
        sourcePrompt: second.imagePrompt,
        usePreviousFrameAsReference: true,
        dependencyFrameId: first.id,
        dependencyVersionId: firstOld.id,
      });

      first.versions.push(firstOld, firstNew);
      first.approvedVersionId = firstNew.id;
      second.versions.push(secondApproved);
      second.approvedVersionId = secondApproved.id;
      draft.frames = [first, second];
      reconcileTransitions(draft);
      draft.transitions[0]!.transitionPrompt = "Crossfade";
      return draft;
    });

    await expect(
      enqueueTransitionGeneration([manifest.transitions[0]!.id], {
        duration: 4,
        size: "1280x720",
        fps: 24,
      }),
    ).rejects.toThrow(/Both endpoint frames need at least one generated version/i);
  });

  test("transition generation uses refreshed current endpoints after the chain is repaired", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const firstOldPath = path.join("frames", "first", "old.png");
    const firstNewPath = path.join("frames", "first", "new.png");
    const secondOldPath = path.join("frames", "second", "old.png");
    const secondNewPath = path.join("frames", "second", "new.png");

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      second.usePreviousFrameAsReference = true;

      const firstOld = createFrameVersion(firstOldPath);
      const firstNew = createFrameVersion(firstNewPath);
      const secondOld = createFrameVersion(secondOldPath, {
        sourcePrompt: second.imagePrompt,
        usePreviousFrameAsReference: true,
        dependencyFrameId: first.id,
        dependencyVersionId: firstOld.id,
      });
      const secondNew = createFrameVersion(secondNewPath, {
        sourcePrompt: second.imagePrompt,
        usePreviousFrameAsReference: true,
        dependencyFrameId: first.id,
        dependencyVersionId: firstNew.id,
      });

      first.versions.push(firstOld, firstNew);
      first.approvedVersionId = firstNew.id;
      second.versions.push(secondOld, secondNew);
      second.approvedVersionId = secondOld.id;
      draft.frames = [first, second];
      reconcileTransitions(draft);
      draft.transitions[0]!.transitionPrompt = "Repair chain";
      return draft;
    });

    const queuedSnapshot = await enqueueTransitionGeneration([manifest.transitions[0]!.id], {
      duration: 4,
      size: "1280x720",
      fps: 24,
    });

    expect(queuedSnapshot.manifest.transitions[0]?.confirmedFromVersionId).toBe(
      manifest.frames[0]!.approvedVersionId,
    );
    expect(queuedSnapshot.manifest.transitions[0]?.confirmedToVersionId).toBe(
      manifest.frames[1]!.versions[1]!.id,
    );
    expect(queuedSnapshot.manifest.jobs.at(-1)?.requestPayload).toMatchObject({
      fromApprovedVersionId: manifest.frames[0]!.approvedVersionId,
      toApprovedVersionId: manifest.frames[1]!.versions[1]!.id,
    });

    await waitForTransitionJobToSettle(projectPath);

    expect(generateTransitionVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromImagePath: firstNewPath,
        toImagePath: secondNewPath,
        prompt: "Repair chain",
      }),
    );
  });
});
