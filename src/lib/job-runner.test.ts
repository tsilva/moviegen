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
  IMAGE_MODEL,
  nowIso,
  reconcileTransitions,
  reorderFrames,
} from "./project-ops";
import { STANDARD_FRAME_MODEL_ID } from "./generation-models";
import {
  cancelFrameGeneration,
  cancelTransitionGeneration,
  enqueueFrameGeneration,
  enqueueProjectStartupGeneration,
  enqueueTransitionGeneration,
  importFrameAssets,
  resumeProjectJobs,
} from "./job-runner";
import type { GeneratedFrameAsset, GeneratedTransitionAsset } from "./provider";
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
    generationOverrides: {},
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

async function waitForAssertion(assertion: () => void | Promise<void>) {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  await assertion();
}

async function waitForRunnerIdle(projectPath: string) {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const runnerState = (globalThis as Record<string, unknown>).__moviegenJobRunnerState__ as
      | {
          processingFrameProjects: Set<string>;
          processingTransitionProjects: Set<string>;
        }
      | undefined;

    const frameBusy = runnerState?.processingFrameProjects.has(projectPath) ?? false;
    const transitionBusy = runnerState?.processingTransitionProjects.has(projectPath) ?? false;

    if (!frameBusy && !transitionBusy) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for the job runner to go idle");
}

async function waitForAllRunnersToGoIdle() {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const runnerState = (globalThis as Record<string, unknown>).__moviegenJobRunnerState__ as
      | {
          processingFrameProjects: Set<string>;
          processingTransitionProjects: Set<string>;
        }
      | undefined;

    const activeFrameProjects = runnerState?.processingFrameProjects.size ?? 0;
    const activeTransitionProjects = runnerState?.processingTransitionProjects.size ?? 0;

    if (activeFrameProjects === 0 && activeTransitionProjects === 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for all job runner work to finish");
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
        responsePayload: { id: "pred_test", status: "completed" },
      },
    ]);
    generateTransitionVideoMock.mockResolvedValue({
      model: "mock-video-model",
      providerPredictionId: "pred_transition",
      relativePath: path.join("transitions", "generated", "clip.mp4"),
      posterRelativePath: path.join("transitions", "generated", "poster.png"),
      inputPayload: { model: "mock-video-model" },
      responsePayload: { id: "pred_transition", status: "completed" },
    });
  });

  afterEach(async () => {
    await waitForAllRunnersToGoIdle();
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    delete (globalThis as Record<string, unknown>).__moviegenRuntimeState__;
    delete (globalThis as Record<string, unknown>).__moviegenJobRunnerState__;
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    expect(snapshot.manifest.frames[0]?.versions.at(-1)?.usePreviousFrameAsReference).toBe(false);
    expect(snapshot.manifest.frames[0]?.usePreviousFrameAsReference).toBe(true);
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

  test("imports uploaded frame assets directly without calling the generator", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    const importedPath = path.join("frames", "references", "uploaded.png");
    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      draft.frames = [first, second];
      reconcileTransitions(draft);
      return draft;
    });

    const snapshot = await importFrameAssets(manifest.frames[0]!.id, [importedPath], {
      usePreviousFrameAsReference: false,
    });

    const importedFrame = snapshot.manifest.frames[0]!;
    const importedVersion = importedFrame.versions.at(-1);
    const importJob = snapshot.manifest.jobs.at(-1);

    expect(generateFrameImagesMock).not.toHaveBeenCalled();
    expect(importedFrame.approvedVersionId).toBe(importedVersion?.id);
    expect(importedVersion).toMatchObject({
      model: "uploaded/image",
      outputPath: importedPath,
      thumbnailPath: importedPath,
      sourcePrompt: null,
      reviewerDecision: "approved",
    });
    expect(importJob).toMatchObject({
      kind: "frame_image",
      provider: "mock",
      model: "uploaded/image",
      status: "completed",
      requestPayload: {
        mode: "direct_upload",
        directAssetPath: importedPath,
      },
    });
    expect(snapshot.manifest.transitions[0]?.invalidationReason).toBe("endpoint_versions_changed");
    expect(snapshot.frames[0]?.currentVersion?.outputPath).toBe(importedPath);
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

  test("prompt draft changes do not stop an in-flight compatible frame from becoming current", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    let resolveGeneration:
      | ((value: Array<{
          model: string;
          providerPredictionId: string;
          relativePath: string;
          inputPayload: Record<string, unknown>;
        }>) => void)
      | null = null;
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

    const finishFrameGeneration = resolveGeneration;
    if (!finishFrameGeneration) {
      throw new Error("Expected frame generation promise to be pending");
    }

    (finishFrameGeneration as (value: Array<{
      model: string;
      providerPredictionId: string;
      relativePath: string;
      inputPayload: Record<string, unknown>;
    }>) => void)([
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

    expect(generatedFrame.approvedVersionId).toBe(latestVersion?.id);
    expect(latestVersion?.reviewerDecision).toBe("approved");
    expect(latestVersion?.sourcePrompt).toBe("First prompt");
  });

  test("stopping an in-flight frame generation removes the active job and ignores a late result", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    let resolveGeneration:
      | ((value: Array<{
          model: string;
          providerPredictionId: string;
          relativePath: string;
          inputPayload: Record<string, unknown>;
        }>) => void)
      | null = null;
    generateFrameImagesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
    );

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      draft.frames = [createFrame("First", 0)];
      return draft;
    });

    await enqueueFrameGeneration([manifest.frames[0]!.id], {
      candidateCount: 1,
      size: "1280x720",
      seedMode: "random",
    });

    await waitForJobToStart(projectPath, "frame_image");

    const canceledSnapshot = await cancelFrameGeneration(manifest.frames[0]!.id);
    expect(canceledSnapshot.manifest.jobs).toHaveLength(0);
    expect(canceledSnapshot.manifest.frames[0]!.versions).toHaveLength(0);

    const finishFrameGeneration = resolveGeneration;
    if (!finishFrameGeneration) {
      throw new Error("Expected frame generation promise to be pending");
    }

    (finishFrameGeneration as (value: Array<{
      model: string;
      providerPredictionId: string;
      relativePath: string;
      inputPayload: Record<string, unknown>;
    }>) => void)([
      {
        model: "mock-edit-model",
        providerPredictionId: "pred_frame_stopped",
        relativePath: path.join("frames", "generated", "stopped-late.png"),
        inputPayload: { model: "mock-edit-model" },
      },
    ]);

    await waitForAssertion(async () => {
      const snapshot = await readProjectSnapshot(projectPath);
      expect(snapshot.manifest.jobs).toHaveLength(0);
      expect(snapshot.manifest.frames[0]!.versions).toHaveLength(0);
    });
    await waitForRunnerIdle(projectPath);
  });

  test("queues explicit generation overrides and persists them as the latest frame defaults", async () => {
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
      overridesByFrameId: {
        [manifest.frames[0]!.id]: {
          prompt: "Override prompt",
          usePreviousFrameAsReference: true,
        },
      },
      size: "1280x720",
      seedMode: "random",
    });

    expect(queuedSnapshot.manifest.jobs[0]?.requestPayload).toMatchObject({
      prompt: "Override prompt",
      usePreviousFrameAsReference: false,
    });
    expect(queuedSnapshot.manifest.frames[0]?.imagePrompt).toBe("Override prompt");
    expect(queuedSnapshot.manifest.frames[0]?.usePreviousFrameAsReference).toBe(false);

    const snapshot = await waitForFrameJobToSettle(projectPath);
    const latestVersion = snapshot.manifest.frames[0]?.versions.at(-1);

    expect(latestVersion?.sourcePrompt).toBe("Override prompt");
    expect(latestVersion?.usePreviousFrameAsReference).toBe(false);
  });

  test("derives frame generation size from the selected image model settings", async () => {
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
      overridesByFrameId: {
        [manifest.frames[0]!.id]: {
          generationOverrides: {
            modelId: STANDARD_FRAME_MODEL_ID,
            settings: {
              resolution: "1080p",
            },
          },
        },
      },
      size: "1280x720",
      seedMode: "random",
    });

    expect(queuedSnapshot.manifest.jobs[0]?.requestPayload).toMatchObject({
      size: "1920x1080",
      generationSnapshot: {
        modelId: STANDARD_FRAME_MODEL_ID,
        settings: {
          resolution: "1080p",
        },
      },
    });

    await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: STANDARD_FRAME_MODEL_ID,
        size: "1920x1080",
      }),
    );
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

  test("processes a queued frame chain in order when multiple prompts are started together", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    generateFrameImagesMock
      .mockResolvedValueOnce([
        {
          model: "mock-edit-model",
          providerPredictionId: "pred_frame_1",
          relativePath: path.join("frames", "generated", "frame-1.png"),
          inputPayload: { model: "mock-edit-model", step: 1 },
        },
      ])
      .mockResolvedValueOnce([
        {
          model: "mock-edit-model",
          providerPredictionId: "pred_frame_2",
          relativePath: path.join("frames", "generated", "frame-2.png"),
          inputPayload: { model: "mock-edit-model", step: 2 },
        },
      ])
      .mockResolvedValueOnce([
        {
          model: "mock-edit-model",
          providerPredictionId: "pred_frame_3",
          relativePath: path.join("frames", "generated", "frame-3.png"),
          inputPayload: { model: "mock-edit-model", step: 3 },
        },
      ]);

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      const third = createFrame("Third", 2);
      first.usePreviousFrameAsReference = true;
      second.usePreviousFrameAsReference = true;
      third.usePreviousFrameAsReference = true;
      draft.frames = [first, second, third];
      return draft;
    });

    await enqueueFrameGeneration(
      manifest.frames.map((frame) => frame.id),
      {
        candidateCount: 1,
        size: "1280x720",
        seedMode: "random",
      },
    );

    const snapshot = await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).toHaveBeenCalledTimes(3);
    expect(generateFrameImagesMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        frameId: manifest.frames[0]?.id,
        referenceImages: [],
      }),
    );
    expect(generateFrameImagesMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        frameId: manifest.frames[1]?.id,
        referenceImages: [path.join("frames", "generated", "frame-1.png")],
      }),
    );
    expect(generateFrameImagesMock.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        frameId: manifest.frames[2]?.id,
        referenceImages: [path.join("frames", "generated", "frame-2.png")],
      }),
    );
    expect(snapshot.frames.every((frame) => frame.currentVersion != null)).toBe(true);
  });

  test("project startup generation overlaps transition 1-2 with frame 3 once frame 2 settles", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    let resolveFrame1: ((value: GeneratedFrameAsset[]) => void) | null = null;
    let resolveFrame2: ((value: GeneratedFrameAsset[]) => void) | null = null;
    let resolveFrame3: ((value: GeneratedFrameAsset[]) => void) | null = null;
    let resolveTransition1: ((value: GeneratedTransitionAsset) => void) | null = null;
    let resolveTransition2: ((value: GeneratedTransitionAsset) => void) | null = null;

    generateFrameImagesMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFrame1 = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFrame2 = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFrame3 = resolve;
          }),
      );
    generateTransitionVideoMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTransition1 = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTransition2 = resolve;
          }),
      );

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      const third = createFrame("Third", 2);
      first.usePreviousFrameAsReference = true;
      second.usePreviousFrameAsReference = true;
      third.usePreviousFrameAsReference = true;
      draft.frames = [first, second, third];
      reconcileTransitions(draft);
      return draft;
    });

    await enqueueProjectStartupGeneration({
      frameIds: manifest.frames.map((frame) => frame.id),
      transitionIds: manifest.transitions.map((transition) => transition.id),
      frameOptions: {
        candidateCount: 1,
        size: "1280x720",
        seedMode: "random",
      },
      transitionOptions: {
        duration: 4,
        size: "1280x720",
        fps: 24,
      },
    });

    await waitForAssertion(() => {
      expect(generateFrameImagesMock).toHaveBeenCalledTimes(1);
      expect(generateTransitionVideoMock).toHaveBeenCalledTimes(0);
    });

    if (!resolveFrame1) {
      throw new Error("Missing frame resolver 1");
    }
    (resolveFrame1 as (value: GeneratedFrameAsset[]) => void)([
      {
        model: "mock-edit-model",
        providerPredictionId: "pred_frame_1",
        relativePath: path.join("frames", "generated", "frame-1.png"),
        inputPayload: { model: "mock-edit-model", step: 1 },
        responsePayload: { id: "pred_frame_1", status: "completed" },
      },
    ]);

    await waitForAssertion(() => {
      expect(generateFrameImagesMock).toHaveBeenCalledTimes(2);
      expect(generateTransitionVideoMock).toHaveBeenCalledTimes(0);
    });

    if (!resolveFrame2) {
      throw new Error("Missing frame resolver 2");
    }
    (resolveFrame2 as (value: GeneratedFrameAsset[]) => void)([
      {
        model: "mock-edit-model",
        providerPredictionId: "pred_frame_2",
        relativePath: path.join("frames", "generated", "frame-2.png"),
        inputPayload: { model: "mock-edit-model", step: 2 },
        responsePayload: { id: "pred_frame_2", status: "completed" },
      },
    ]);

    await waitForAssertion(() => {
      expect(generateFrameImagesMock).toHaveBeenCalledTimes(3);
      expect(generateTransitionVideoMock).toHaveBeenCalledTimes(1);
    });

    if (!resolveFrame3) {
      throw new Error("Missing frame resolver 3");
    }
    (resolveFrame3 as (value: GeneratedFrameAsset[]) => void)([
      {
        model: "mock-edit-model",
        providerPredictionId: "pred_frame_3",
        relativePath: path.join("frames", "generated", "frame-3.png"),
        inputPayload: { model: "mock-edit-model", step: 3 },
        responsePayload: { id: "pred_frame_3", status: "completed" },
      },
    ]);

    await waitForAssertion(() => {
      expect(generateTransitionVideoMock).toHaveBeenCalledTimes(1);
    });

    if (!resolveTransition1) {
      throw new Error("Missing transition resolver 1");
    }
    (resolveTransition1 as (value: GeneratedTransitionAsset) => void)({
      model: "mock-video-model",
      providerPredictionId: "pred_transition_1",
      relativePath: path.join("transitions", "generated", "clip-1.mp4"),
      posterRelativePath: path.join("transitions", "generated", "poster-1.png"),
      inputPayload: { model: "mock-video-model", step: 1 },
      responsePayload: { id: "pred_transition_1", status: "completed" },
    });

    await waitForAssertion(() => {
      expect(generateTransitionVideoMock).toHaveBeenCalledTimes(2);
    });

    if (!resolveTransition2) {
      throw new Error("Missing transition resolver 2");
    }
    (resolveTransition2 as (value: GeneratedTransitionAsset) => void)({
      model: "mock-video-model",
      providerPredictionId: "pred_transition_2",
      relativePath: path.join("transitions", "generated", "clip-2.mp4"),
      posterRelativePath: path.join("transitions", "generated", "poster-2.png"),
      inputPayload: { model: "mock-video-model", step: 2 },
      responsePayload: { id: "pred_transition_2", status: "completed" },
    });

    const frameSnapshot = await waitForFrameJobToSettle(projectPath);
    const snapshot = await waitForTransitionJobToSettle(projectPath);

    expect(frameSnapshot.frames.every((frame) => frame.currentVersion != null)).toBe(true);
    expect(snapshot.transitions).toHaveLength(2);
    expect(snapshot.transitions.every((transition) => transition.currentVideo != null)).toBe(true);
  });

  test("resumeProjectJobs requeues interrupted running frame work and completes the chain", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    generateFrameImagesMock
      .mockResolvedValueOnce([
        {
          model: "mock-edit-model",
          providerPredictionId: "pred_frame_resume_1",
          relativePath: path.join("frames", "generated", "resume-1.png"),
          inputPayload: { model: "mock-edit-model", step: 1 },
        },
      ])
      .mockResolvedValueOnce([
        {
          model: "mock-edit-model",
          providerPredictionId: "pred_frame_resume_2",
          relativePath: path.join("frames", "generated", "resume-2.png"),
          inputPayload: { model: "mock-edit-model", step: 2 },
        },
      ]);

    const manifest = await seedProject(projectPath, () => {
      const draft = createEmptyManifest("moviegen");
      const first = createFrame("First", 0);
      const second = createFrame("Second", 1);
      second.usePreviousFrameAsReference = true;
      draft.frames = [first, second];
      draft.jobs.push(
        {
          id: createId("job"),
          kind: "frame_image",
          targetId: createId("framecand"),
          targetParentId: first.id,
          provider: "atlas",
          model: IMAGE_MODEL,
          status: "running",
          requestPayload: {
            frameId: first.id,
            prompt: first.imagePrompt,
            usePreviousFrameAsReference: false,
            size: "1280x720",
            seedMode: "random",
            seed: 1,
          },
          providerPredictionId: null,
          errorMessage: null,
          startedAt: nowIso(),
          completedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
        {
          id: createId("job"),
          kind: "frame_image",
          targetId: createId("framecand"),
          targetParentId: second.id,
          provider: "atlas",
          model: IMAGE_MODEL,
          status: "queued",
          requestPayload: {
            frameId: second.id,
            prompt: second.imagePrompt,
            usePreviousFrameAsReference: true,
            size: "1280x720",
            seedMode: "random",
            seed: 2,
          },
          providerPredictionId: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      );
      return draft;
    });

    const resumedSnapshot = await resumeProjectJobs(projectPath);

    expect(["queued", "running"]).toContain(resumedSnapshot.manifest.jobs[0]?.status);

    const snapshot = await waitForFrameJobToSettle(projectPath);

    expect(generateFrameImagesMock).toHaveBeenCalledTimes(2);
    expect(snapshot.frames[0]?.currentVersion?.outputPath).toBe(path.join("frames", "generated", "resume-1.png"));
    expect(snapshot.frames[1]?.currentVersion?.outputPath).toBe(path.join("frames", "generated", "resume-2.png"));
    expect(snapshot.manifest.jobs.map((job) => job.status)).toEqual(["completed", "completed"]);
    expect(snapshot.manifest.frames[1]?.approvedVersionId).toBeTruthy();
    expect(snapshot.manifest.frames[1]?.approvedVersionId).not.toBe(manifest.frames[1]?.approvedVersionId);
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
      draft.generationDefaults.byModel["bytedance/seedance-v1.5-pro/image-to-video"]!.settings.duration = "8";
      reconcileTransitions(draft);
      draft.transitions[0]!.transitionPrompt = "Match cut";
      draft.transitions[0]!.invalidationReason = "endpoint_versions_changed";
      return draft;
    });

    const queuedSnapshot = await enqueueTransitionGeneration([manifest.transitions[0]!.id], {
      duration: 4,
      size: "1280x720",
      fps: 24,
      cameraFixed: true,
      generateAudio: false,
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
      duration: 8,
      cameraFixed: true,
      generateAudio: false,
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
        modelId: "bytedance/seedance-v1.5-pro/image-to-video",
        prompt: "Match cut",
        duration: 8,
        settings: expect.objectContaining({
          cameraFixed: true,
          duration: "8",
          generateAudio: false,
        }),
      }),
    );
    expect(generatedTransition.approvedVideoVersionId).toBeTruthy();
    expect(approvedVideo?.reviewerDecision).toBe("approved");
    expect(approvedVideo?.sourcePrompt).toBe("Match cut");
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

    let resolveGeneration:
      | ((value: {
          model: string;
          providerPredictionId: string;
          relativePath: string;
          posterRelativePath: string;
          inputPayload: Record<string, unknown>;
        }) => void)
      | null = null;
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

    const finishTransitionGeneration = resolveGeneration;
    if (!finishTransitionGeneration) {
      throw new Error("Expected transition generation promise to be pending");
    }

    (finishTransitionGeneration as (value: {
      model: string;
      providerPredictionId: string;
      relativePath: string;
      posterRelativePath: string;
      inputPayload: Record<string, unknown>;
    }) => void)({
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
    expect(latestVersion?.sourcePrompt).toBe("Match cut");
  });

  test("stopping an in-flight transition generation removes the active job and ignores a late result", async () => {
    const projectPath = await createTempProject();
    tempDirs.push(projectPath);

    let resolveGeneration:
      | ((value: {
          model: string;
          providerPredictionId: string;
          relativePath: string;
          posterRelativePath: string;
          inputPayload: Record<string, unknown>;
        }) => void)
      | null = null;
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
      return draft;
    });

    await enqueueTransitionGeneration([manifest.transitions[0]!.id], {
      duration: 4,
      size: "1280x720",
      fps: 24,
    });

    await waitForJobToStart(projectPath, "transition_video");

    const canceledSnapshot = await cancelTransitionGeneration(manifest.transitions[0]!.id);
    expect(canceledSnapshot.manifest.jobs).toHaveLength(0);
    expect(canceledSnapshot.manifest.transitions[0]!.versions).toHaveLength(0);

    const finishTransitionGeneration = resolveGeneration;
    if (!finishTransitionGeneration) {
      throw new Error("Expected transition generation promise to be pending");
    }

    (finishTransitionGeneration as (value: {
      model: string;
      providerPredictionId: string;
      relativePath: string;
      posterRelativePath: string;
      inputPayload: Record<string, unknown>;
    }) => void)({
      model: "mock-video-model",
      providerPredictionId: "pred_transition_stopped",
      relativePath: path.join("transitions", "generated", "stopped-late.mp4"),
      posterRelativePath: path.join("transitions", "generated", "stopped-late.png"),
      inputPayload: { model: "mock-video-model" },
    });

    await waitForAssertion(async () => {
      const snapshot = await readProjectSnapshot(projectPath);
      expect(snapshot.manifest.jobs).toHaveLength(0);
      expect(snapshot.manifest.transitions[0]!.versions).toHaveLength(0);
    });
    await waitForRunnerIdle(projectPath);
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
