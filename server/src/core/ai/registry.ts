import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createProviderRegistry, type ImageModel, type LanguageModel } from 'ai';
import type { AiFeature, Config } from '../config.js';
import { AppError } from '../errors.js';
import { createMockProvider } from './mock.js';

type Providers = Parameters<typeof createProviderRegistry>[0];
type ModelKey = `${string}:${string}`;

export type AiTextFeature = Exclude<AiFeature, 'image'>;

export interface AiModels {
  enabled(feature: AiFeature): boolean;
  // "proveedor:modelo" que se guarda en AiUsage.
  modelId(feature: AiFeature): string | undefined;
  languageModel(feature: AiTextFeature): LanguageModel;
  imageModel(): ImageModel;
}

export interface ModelSource {
  languageModel(id: string): LanguageModel;
  imageModel(id: string): ImageModel;
}

// Un proveedor por clave presente; añadir otro es una entrada más aquí y su paquete.
export function providersFor(ai: Config['ai']): Providers {
  const providers: Providers = {};
  if (ai.keys.openai) {
    const openai = createOpenAI({ apiKey: ai.keys.openai, baseURL: ai.openaiBaseUrl });
    // Las APIs compatibles (OpenRouter, Groq, Ollama…) solo implementan Chat Completions.
    providers.openai = ai.openaiBaseUrl
      ? {
          specificationVersion: 'v4',
          languageModel: (id: string) => openai.chat(id),
          embeddingModel: (id: string) => openai.embeddingModel(id),
          imageModel: (id: string) => openai.imageModel(id),
        }
      : openai;
  }
  if (ai.keys.google) providers.google = createGoogleGenerativeAI({ apiKey: ai.keys.google });
  if (ai.keys.anthropic) providers.anthropic = createAnthropic({ apiKey: ai.keys.anthropic });
  return providers;
}

function resolvedRef(models: Config['ai']['models'], feature: AiFeature) {
  return feature === 'vision' ? (models.vision ?? models.assistant) : models[feature];
}

export function aiModelsFrom(source: ModelSource, models: Config['ai']['models']): AiModels {
  const idOf = (feature: AiFeature) => {
    const ref = resolvedRef(models, feature);
    if (!ref) throw new AppError('NOT_FOUND');
    return ref.id;
  };
  return {
    enabled: (feature) => resolvedRef(models, feature) !== undefined,
    modelId: (feature) => resolvedRef(models, feature)?.id,
    languageModel: (feature) => source.languageModel(idOf(feature)),
    imageModel: () => source.imageModel(idOf('image')),
  };
}

export async function createAiModels(config: Pick<Config, 'ai' | 'nodeEnv'>): Promise<AiModels> {
  const providers = providersFor(config.ai);
  if (config.nodeEnv === 'test') providers.mock = await createMockProvider();
  const registry = createProviderRegistry(providers);
  return aiModelsFrom(
    {
      languageModel: (id) => registry.languageModel(id as ModelKey),
      imageModel: (id) => registry.imageModel(id as ModelKey),
    },
    config.ai.models,
  );
}
