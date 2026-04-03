import { z } from "zod";

const reviewerDecisionSchema = z.enum(["approved", "rejected", "unreviewed"]);
const jobStatusSchema = z.enum(["queued", "running", "completed", "error"]);
const sequenceScopeSchema = z.enum(["active", "archived"]);

export const frameVersionSchema = z.object({
  id: z.string(),
  model: z.string(),
  inputPayload: z.record(z.string(), z.unknown()),
  outputPath: z.string(),
  thumbnailPath: z.string(),
  generationJobId: z.string(),
  createdAt: z.string(),
  reviewerDecision: reviewerDecisionSchema,
  reviewerNotes: z.string(),
  sourcePrompt: z.string().nullable().optional(),
  usePreviousFrameAsReference: z.boolean().nullable().optional(),
  dependencyFrameId: z.string().nullable().optional(),
  dependencyVersionId: z.string().nullable().optional(),
});

export const frameSchema = z.object({
  id: z.string(),
  position: z.number(),
  imagePrompt: z.string(),
  referenceImages: z.array(z.string()),
  usePreviousFrameAsReference: z.boolean().default(true),
  approvedVersionId: z.string().nullable(),
  versions: z.array(frameVersionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const transitionVersionSchema = z.object({
  id: z.string(),
  model: z.string(),
  inputPayload: z.record(z.string(), z.unknown()),
  outputPath: z.string(),
  posterPath: z.string(),
  generationJobId: z.string(),
  createdAt: z.string(),
  reviewerDecision: reviewerDecisionSchema,
  reviewerNotes: z.string(),
  promptRevision: z.number(),
  fromApprovedVersionId: z.string().nullable(),
  toApprovedVersionId: z.string().nullable(),
});

export const transitionSchema = z.object({
  id: z.string(),
  fromFrameId: z.string(),
  toFrameId: z.string(),
  transitionPrompt: z.string(),
  promptRevision: z.number(),
  confirmedFromVersionId: z.string().nullable(),
  confirmedToVersionId: z.string().nullable(),
  approvedVideoVersionId: z.string().nullable(),
  invalidationReason: z.string().nullable(),
  sequenceScope: sequenceScopeSchema,
  versions: z.array(transitionVersionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const generationJobSchema = z.object({
  id: z.string(),
  kind: z.enum(["frame_image", "transition_video"]),
  targetId: z.string(),
  targetParentId: z.string(),
  provider: z.enum(["mock", "atlas"]),
  model: z.string(),
  status: jobStatusSchema,
  requestPayload: z.record(z.string(), z.unknown()),
  providerPredictionId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const projectManifestSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    schemaVersion: z.number(),
  }),
  frames: z.array(frameSchema),
  transitions: z.array(transitionSchema),
  jobs: z.array(generationJobSchema),
  ui: z.object({
    themeMode: z.literal("dark"),
    viewMode: z.enum(["sequence", "table"]).catch("sequence").transform(() => "sequence" as const),
    selectedFrameId: z.string().nullable(),
    selectedTransitionId: z.string().nullable(),
    filter: z.enum(["all", "needsRepair", "needsAttention", "approved"]).catch("needsRepair").transform((value) => {
      if (value === "all") {
        return "all" as const;
      }

      return "needsRepair" as const;
    }),
  }),
});
