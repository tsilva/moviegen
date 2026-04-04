import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { validateSystemPromptTemplate, sanitizeGenerationSettings } from "@/lib/generation-config";
import { getModelDefinition } from "@/lib/generation-models";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  generationDefaults: z.object({
    selectedModels: z.object({
      frame: z.string(),
      transition: z.string(),
    }),
    byModel: z.record(
      z.string(),
      z.object({
        systemPromptTemplate: z.string(),
        settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      }),
    ),
  }),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const { snapshot } = await mutateCurrentProject((manifest) => {
      const frameModel = getModelDefinition(body.generationDefaults.selectedModels.frame);
      if (!frameModel || frameModel.assetKind !== "frame") {
        throw new Error(`Unsupported frame model "${body.generationDefaults.selectedModels.frame}"`);
      }

      const transitionModel = getModelDefinition(body.generationDefaults.selectedModels.transition);
      if (!transitionModel || transitionModel.assetKind !== "transition") {
        throw new Error(`Unsupported transition model "${body.generationDefaults.selectedModels.transition}"`);
      }

      const byModel = Object.fromEntries(
        Object.entries(body.generationDefaults.byModel).map(([modelId, config]) => {
          if (!getModelDefinition(modelId)) {
            throw new Error(`Unsupported model "${modelId}"`);
          }

          validateSystemPromptTemplate(config.systemPromptTemplate);

          return [
            modelId,
            {
              systemPromptTemplate: config.systemPromptTemplate,
              settings: sanitizeGenerationSettings(modelId, config.settings),
            },
          ];
        }),
      );

      manifest.generationDefaults.selectedModels = body.generationDefaults.selectedModels;
      manifest.generationDefaults.byModel = {
        ...manifest.generationDefaults.byModel,
        ...byModel,
      };
    });

    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to update project settings");
  }
}
