import {
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  SYSTEM_PROMPT_TEMPLATE_TOKEN,
  type GenerationModelDefinition,
  type GenerationSettingDefinition,
  getDefaultModelIdForAssetKind,
  getModelDefaultSettings,
  getModelDefinition,
} from "@/lib/generation-models";
import type {
  GenerationAssetKind,
  GenerationOverrides,
  GenerationSettings,
  GenerationSnapshot,
  ModelGenerationDefaults,
  ProjectGenerationDefaults,
} from "@/lib/types";

export type ResolvedGenerationConfig = GenerationSnapshot;

export function validateSystemPromptTemplate(template: string) {
  const matches = template.match(/\{\{prompt\}\}/g) ?? [];
  if (matches.length !== 1) {
    throw new Error(`System prompt templates must include ${SYSTEM_PROMPT_TEMPLATE_TOKEN} exactly once`);
  }
}

export function applySystemPromptTemplate(template: string, prompt: string) {
  validateSystemPromptTemplate(template);
  return template.replace(SYSTEM_PROMPT_TEMPLATE_TOKEN, prompt);
}

export function filterGenerationSettingsForModel(modelId: string, settings: GenerationSettings | null | undefined) {
  const definition = getModelDefinition(modelId) as GenerationModelDefinition | null;
  if (!definition || !settings) {
    return {};
  }

  const allowed = new Set(definition.settings.map((setting: GenerationSettingDefinition) => setting.key));
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => allowed.has(key)),
  );
}

export function sanitizeGenerationSettings(modelId: string, settings: GenerationSettings | null | undefined) {
  const definition = getModelDefinition(modelId) as GenerationModelDefinition | null;
  if (!definition) {
    throw new Error(`Unsupported model "${modelId}"`);
  }

  const filtered = filterGenerationSettingsForModel(modelId, settings);
  const inputKeys = Object.keys(settings ?? {});
  const filteredKeys = new Set(Object.keys(filtered));
  for (const key of inputKeys) {
    if (!filteredKeys.has(key)) {
      throw new Error(`Setting "${key}" is not supported for model "${modelId}"`);
    }
  }

  const sanitized: GenerationSettings = {};
  for (const setting of definition.settings) {
    const value = filtered[setting.key];
    if (value === undefined) {
      continue;
    }

    if (setting.kind === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(`Setting "${setting.key}" must be a boolean`);
      }

      sanitized[setting.key] = value;
      continue;
    }

    if (typeof value !== "string") {
      throw new Error(`Setting "${setting.key}" must be a string`);
    }

    const allowedValues = new Set((setting.options ?? []).map((option: { value: string }) => option.value));
    if (allowedValues.size > 0 && !allowedValues.has(value)) {
      throw new Error(`Setting "${setting.key}" has an unsupported value "${value}"`);
    }

    sanitized[setting.key] = value;
  }

  return sanitized;
}

export function normalizeGenerationOverrides(
  assetKind: GenerationAssetKind,
  overrides: GenerationOverrides | null | undefined,
): GenerationOverrides {
  if (!overrides) {
    return {};
  }

  const modelId = overrides.modelId ?? undefined;
  const effectiveModelId = modelId ?? getDefaultModelIdForAssetKind(assetKind);
  const definition = getModelDefinition(effectiveModelId);
  if (!definition || definition.assetKind !== assetKind) {
    throw new Error(`Model "${effectiveModelId}" is not supported for ${assetKind} generation`);
  }

  const nextOverrides: GenerationOverrides = {};
  if (modelId) {
    nextOverrides.modelId = effectiveModelId;
  }

  if (overrides.systemPromptTemplate != null) {
    validateSystemPromptTemplate(overrides.systemPromptTemplate);
    nextOverrides.systemPromptTemplate = overrides.systemPromptTemplate;
  }

  if (overrides.settings != null) {
    nextOverrides.settings = sanitizeGenerationSettings(effectiveModelId, overrides.settings);
  }

  return nextOverrides;
}

export function getModelDefaults(
  generationDefaults: ProjectGenerationDefaults | null | undefined,
  modelId: string,
): ModelGenerationDefaults {
  const storedDefaults = generationDefaults?.byModel?.[modelId];
  const systemPromptTemplate = storedDefaults?.systemPromptTemplate ?? DEFAULT_SYSTEM_PROMPT_TEMPLATE;

  validateSystemPromptTemplate(systemPromptTemplate);

  return {
    systemPromptTemplate,
    settings: {
      ...getModelDefaultSettings(modelId),
      ...sanitizeGenerationSettings(modelId, storedDefaults?.settings),
    },
  };
}

export function resolveGenerationConfig(input: {
  assetKind: GenerationAssetKind;
  prompt: string;
  generationDefaults: ProjectGenerationDefaults | null | undefined;
  assetOverrides?: GenerationOverrides | null;
  requestOverrides?: GenerationOverrides | null;
}): ResolvedGenerationConfig {
  const defaultModelId = getDefaultModelIdForAssetKind(input.assetKind);
  const modelId =
    input.requestOverrides?.modelId ??
    input.assetOverrides?.modelId ??
    defaultModelId;
  const definition = getModelDefinition(modelId);
  if (!definition || definition.assetKind !== input.assetKind) {
    throw new Error(`Model "${modelId}" is not supported for ${input.assetKind} generation`);
  }

  const modelDefaults = getModelDefaults(input.generationDefaults, modelId);
  const assetOverrides = normalizeGenerationOverrides(input.assetKind, input.assetOverrides);
  const requestOverrides = normalizeGenerationOverrides(input.assetKind, input.requestOverrides);
  const systemPromptTemplate =
    requestOverrides.systemPromptTemplate ??
    assetOverrides.systemPromptTemplate ??
    modelDefaults.systemPromptTemplate;
  const settings = sanitizeGenerationSettings(modelId, {
    ...modelDefaults.settings,
    ...(assetOverrides.settings ?? {}),
    ...(requestOverrides.settings ?? {}),
  });

  return {
    modelId,
    systemPromptTemplate,
    settings,
    resolvedPrompt: applySystemPromptTemplate(systemPromptTemplate, input.prompt),
  };
}
