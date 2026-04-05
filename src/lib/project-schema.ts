import { z } from "zod";
import { createDefaultGenerationDefaults } from "@/lib/generation-defaults";

const reviewerDecisionSchema = z.enum(["approved", "rejected", "unreviewed"]);
const jobStatusSchema = z.enum(["queued", "running", "completed", "error"]);
const sequenceScopeSchema = z.enum(["active", "archived"]);
const trackSlotKindSchema = z.enum(["startFrame", "transition", "endFrame"]);
const generationSettingsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
const generationOverridesSchema = z.object({
  modelId: z.string().nullable().optional(),
  systemPromptTemplate: z.string().nullable().optional(),
  settings: generationSettingsSchema.nullable().optional(),
});
const generationSnapshotSchema = z.object({
  modelId: z.string(),
  systemPromptTemplate: z.string(),
  settings: generationSettingsSchema,
  resolvedPrompt: z.string(),
});
const generationDefaultsSchema = z.object({
  selectedModels: z
    .object({
      frame: z.string(),
      transition: z.string(),
    })
    .optional(),
  byModel: z.record(
    z.string(),
    z.object({
      systemPromptTemplate: z.string(),
      settings: generationSettingsSchema,
    }),
  ),
});

export const frameVersionSchema = z.object({
  id: z.string(),
  model: z.string(),
  inputPayload: z.record(z.string(), z.unknown()),
  responsePayload: z.unknown().optional(),
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
  generationSnapshot: generationSnapshotSchema.optional(),
});

export const frameSchema = z.object({
  id: z.string(),
  position: z.number(),
  imagePrompt: z.string(),
  referenceImages: z.array(z.string()),
  usePreviousFrameAsReference: z.boolean().default(true),
  transitionEndpointSelected: z.boolean().default(true),
  generationOverrides: generationOverridesSchema.default({}),
  approvedVersionId: z.string().nullable(),
  versions: z.array(frameVersionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const transitionVersionSchema = z.object({
  id: z.string(),
  model: z.string(),
  inputPayload: z.record(z.string(), z.unknown()),
  responsePayload: z.unknown().optional(),
  outputPath: z.string(),
  posterPath: z.string(),
  generationJobId: z.string(),
  createdAt: z.string(),
  reviewerDecision: reviewerDecisionSchema,
  reviewerNotes: z.string(),
  sourcePrompt: z.string().nullable().optional(),
  promptRevision: z.number(),
  fromApprovedVersionId: z.string().nullable(),
  toApprovedVersionId: z.string().nullable(),
  generationSnapshot: generationSnapshotSchema.optional(),
});

export const transitionSchema = z.object({
  id: z.string(),
  fromFrameId: z.string(),
  toFrameId: z.string(),
  transitionPrompt: z.string(),
  generationOverrides: generationOverridesSchema.default({}),
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
  generationDefaults: generationDefaultsSchema.optional(),
  frames: z.array(frameSchema),
  transitions: z.array(transitionSchema),
  jobs: z.array(generationJobSchema),
  ui: z
    .object({
      themeMode: z.literal("dark"),
      viewMode: z.enum(["sequence", "play", "table"]).catch("sequence").transform((value) => {
        if (value === "play") {
          return "play" as const;
        }

        return "sequence" as const;
      }),
      selectedSlot: z
        .object({
          trackId: z.string(),
          slotKind: trackSlotKindSchema,
        })
        .nullable()
        .optional(),
      selectedFrameId: z.string().nullable().optional(),
      selectedTransitionId: z.string().nullable().optional(),
      filter: z.enum(["all", "needsRepair", "needsAttention", "approved"]).catch("needsRepair").transform((value) => {
        if (value === "all") {
          return "all" as const;
        }

        return "needsRepair" as const;
      }),
    })
    .transform((ui) => ({
      themeMode: ui.themeMode,
      viewMode: ui.viewMode,
      selectedSlot: ui.selectedSlot ?? null,
      filter: ui.filter,
      selectedFrameId: ui.selectedFrameId ?? null,
      selectedTransitionId: ui.selectedTransitionId ?? null,
    })),
}).transform((manifest) => {
  const defaultGenerationDefaults = createDefaultGenerationDefaults();

  return {
    ...manifest,
    generationDefaults: {
      ...defaultGenerationDefaults,
      ...(manifest.generationDefaults ?? {}),
      selectedModels: {
        ...defaultGenerationDefaults.selectedModels,
        ...(manifest.generationDefaults?.selectedModels ?? {}),
      },
      byModel: {
        ...defaultGenerationDefaults.byModel,
        ...(manifest.generationDefaults?.byModel ?? {}),
      },
    },
  };
});
