import { z } from "zod";
import { failure, ok } from "@/lib/http";
import { validateSystemPromptTemplate, sanitizeGenerationSettings } from "@/lib/generation-config";
import { getModelDefinition } from "@/lib/generation-models";
import { mutateCurrentProject } from "@/lib/project-store";

const requestSchema = z.object({
  generationDefaults: z.object({
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
      for (const [modelId, config] of Object.entries(body.generationDefaults.byModel)) {
        if (!getModelDefinition(modelId)) {
          throw new Error(`Unsupported model "${modelId}"`);
        }

        validateSystemPromptTemplate(config.systemPromptTemplate);
        manifest.generationDefaults.byModel[modelId] = {
          systemPromptTemplate: config.systemPromptTemplate,
          settings: sanitizeGenerationSettings(modelId, config.settings),
        };
      }
    });

    return ok(snapshot);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Failed to update project settings");
  }
}

