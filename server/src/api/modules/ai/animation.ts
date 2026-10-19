import { generateText, Output } from 'ai';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AiRefusedError } from '../../../core/ai/errors.js';
import { ANIMATION_INSTRUCTIONS, animationUserText } from '../../../core/ai/prompts/animation.js';
import { AI_UNITS } from '../../../core/ai/quota.js';
import type { Db } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { requireProject } from '../../../core/permissions.js';
import {
  ANIMATION_CANVAS_BYTES_MAX,
  AnimationPlanSchema,
  AnimationRequestSchema,
  AnimationResponseSchema,
  sanitizeAnimationPlan,
  type AnimationRequest,
  type AnimationResponse,
} from '../../../shared/ai/animation.js';
import { ASSISTANT_LIMITS } from '../../../shared/ai/assistant.js';
import { ProjectParamsSchema } from '../../../shared/api/projects.js';
import type { NodeType } from '../../../shared/document/schema.js';
import type { Actor } from '../../types.js';
import { aiRateLimit, requireAiFeature, type AiService } from '../../plugins/ai.js';
import { requireSession } from '../../plugins/auth.js';

const MAX_OUTPUT_TOKENS = 4_000;

export interface AnimationDeps {
  db: Db;
  ai: AiService;
}

export async function runAnimation(deps: AnimationDeps, actor: Actor, projectId: string, body: AnimationRequest): Promise<AnimationResponse> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'ai:use');
  if (Buffer.byteLength(JSON.stringify(body.canvas)) > ANIMATION_CANVAS_BYTES_MAX) throw new AppError('PAYLOAD_TOO_LARGE');
  const nodeIds = new Set(body.nodeIds);
  const canvas = new Map<string, NodeType>(body.canvas.map((node) => [node.id, node.type]));

  return deps.ai.run({
    feature: 'animation',
    organizationId: access.project.organizationId,
    projectId,
    userId: actor.userId,
    units: AI_UNITS.animation,
    promptLength: body.prompt.length,
    call: async (abortSignal) => {
      const result = await generateText({
        model: deps.ai.models.languageModel('animation'),
        instructions: ANIMATION_INSTRUCTIONS,
        messages: [{ role: 'user', content: [{ type: 'text', text: animationUserText(body) }] }],
        output: Output.object({ schema: AnimationPlanSchema }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // El esquema tiene campos opcionales; el modo estricto de OpenAI los rechaza.
        providerOptions: { openai: { strictJsonSchema: false } },
        abortSignal,
      });
      if (result.finishReason === 'content-filter') throw new AiRefusedError();
      const { plan, dropped } = sanitizeAnimationPlan(result.output, { nodeIds, canvas });
      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      return {
        value: { plan, dropped, usage: { units: AI_UNITS.animation, inputTokens, outputTokens } },
        inputTokens,
        outputTokens,
      };
    },
  });
}

export const aiAnimationRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: AnimationDeps = { db: app.db, ai: app.ai };

  app.post(
    '/projects/:id/ai/animation',
    {
      bodyLimit: ASSISTANT_LIMITS.bodyLimitBytes,
      preHandler: [requireSession, aiRateLimit, requireAiFeature('animation')],
      schema: { params: ProjectParamsSchema, body: AnimationRequestSchema, response: { 200: AnimationResponseSchema } },
    },
    async (request) => runAnimation(deps, request.actor!, request.params.id, request.body),
  );
};
