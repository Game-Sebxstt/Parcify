import { generateText, Output, type ImagePart } from 'ai';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AiRefusedError } from '../../../core/ai/errors.js';
import { ASSISTANT_INSTRUCTIONS, assistantUserText } from '../../../core/ai/prompts/assistant.js';
import { AI_UNITS } from '../../../core/ai/quota.js';
import { AppError } from '../../../core/errors.js';
import { requireProject } from '../../../core/permissions.js';
import { mimeForKey, readAll, type StorageDriver } from '../../../core/storage/index.js';
import type { Db } from '../../../core/db.js';
import {
  ASSISTANT_LIMITS,
  AssistantPlanSchema,
  AssistantRequestSchema,
  AssistantResponseSchema,
  sanitizeAssistantPlan,
  type AssistantRequest,
  type AssistantResponse,
} from '../../../shared/ai/assistant.js';
import { ProjectParamsSchema } from '../../../shared/api/projects.js';
import type { NodeType } from '../../../shared/document/schema.js';
import type { Actor } from '../../types.js';
import { aiRateLimit, requireAiFeature, type AiService } from '../../plugins/ai.js';
import { requireSession } from '../../plugins/auth.js';
import { storedVariants } from '../assets/service.js';

const MAX_OUTPUT_TOKENS = 4_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

// Solo assets listos del mismo proyecto; los bytes salen del storage propio, nunca de una URL.
export async function contextImages(deps: { db: Db; storage: StorageDriver }, projectId: string, ids: string[]): Promise<ImagePart[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await deps.db.asset.findMany({
    where: { id: { in: unique }, projectId, status: 'ready', deletedAt: null },
    select: { id: true, variants: true },
  });
  if (rows.length !== unique.length) throw new AppError('INVALID_ATTACHMENT');
  return Promise.all(
    rows.map(async (row) => {
      const variants = storedVariants(row.variants);
      const variant = variants.medium ?? variants.full ?? variants.thumb;
      if (!variant) throw new AppError('INVALID_ATTACHMENT');
      try {
        const bytes = await readAll(await deps.storage.getStream(variant.key), IMAGE_MAX_BYTES);
        return { type: 'image', image: new Uint8Array(bytes), mediaType: mimeForKey(variant.key) } satisfies ImagePart;
      } catch (cause) {
        throw new AppError('STORAGE_ERROR', { cause });
      }
    }),
  );
}

export interface AssistantDeps {
  db: Db;
  storage: StorageDriver;
  ai: AiService;
}

export async function runAssistant(deps: AssistantDeps, actor: Actor, projectId: string, body: AssistantRequest): Promise<AssistantResponse> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'ai:use');
  if (Buffer.byteLength(JSON.stringify(body.canvas)) > ASSISTANT_LIMITS.canvasBytesMax) throw new AppError('PAYLOAD_TOO_LARGE');
  const images = await contextImages(deps, projectId, body.imageAssetIds ?? []);
  const canvas = new Map<string, NodeType>(body.canvas.map((node) => [node.id, node.type]));

  return deps.ai.run({
    feature: 'assistant',
    organizationId: access.project.organizationId,
    projectId,
    userId: actor.userId,
    units: AI_UNITS.assistant,
    promptLength: body.prompt.length,
    call: async (abortSignal) => {
      const result = await generateText({
        model: deps.ai.models.languageModel('assistant'),
        instructions: ASSISTANT_INSTRUCTIONS,
        messages: [{ role: 'user', content: [{ type: 'text', text: assistantUserText(body) }, ...images] }],
        output: Output.object({ schema: AssistantPlanSchema }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // El esquema tiene campos opcionales; el modo estricto de OpenAI los rechaza.
        providerOptions: { openai: { strictJsonSchema: false } },
        abortSignal,
      });
      if (result.finishReason === 'content-filter') throw new AiRefusedError();
      const { plan, dropped } = sanitizeAssistantPlan(result.output, { canvas });
      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      return {
        value: { plan, dropped, usage: { units: AI_UNITS.assistant, inputTokens, outputTokens } },
        inputTokens,
        outputTokens,
      };
    },
  });
}

export const aiAssistantRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: AssistantDeps = { db: app.db, storage: app.storage, ai: app.ai };

  app.post(
    '/projects/:id/ai/assistant',
    {
      bodyLimit: ASSISTANT_LIMITS.bodyLimitBytes,
      preHandler: [requireSession, aiRateLimit, requireAiFeature('assistant')],
      schema: { params: ProjectParamsSchema, body: AssistantRequestSchema, response: { 200: AssistantResponseSchema } },
    },
    async (request) => runAssistant(deps, request.actor!, request.params.id, request.body),
  );
};
