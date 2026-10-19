import { pipeUIMessageStreamToResponse, streamText, toUIMessageStream, type ModelMessage, type ToolSet, type UIMessage } from 'ai';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { translateAiError } from '../../../core/ai/errors.js';
import { chatInstructions } from '../../../core/ai/prompts/chat.js';
import { AI_UNITS } from '../../../core/ai/quota.js';
import type { Db } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { uuidv7 } from '../../../core/ids.js';
import type { LogSink } from '../../../core/logger.js';
import { requireProject } from '../../../core/permissions.js';
import {
  AI_CHAT_LIMITS,
  AiChatBodySchema,
  AiConversationDetailSchema,
  AiConversationListSchema,
  AiConversationParamsSchema,
  AiStoredTextPartSchema,
  type AiStoredMessage,
} from '../../../shared/api/ai.js';
import { ProjectParamsSchema } from '../../../shared/api/projects.js';
import type { Actor } from '../../types.js';
import { aiRateLimit, requireAiFeature } from '../../plugins/ai.js';
import { requireSession } from '../../plugins/auth.js';
import { contextImages } from './assistant.js';

const MAX_OUTPUT_TOKENS = 2_000;
const StoredPartsSchema = z.array(AiStoredTextPartSchema);

// Recorta las partes para que el total quepa en lo que se puede releer.
function clipParts(parts: { type: 'text'; text: string }[]): { type: 'text'; text: string }[] {
  let left = AI_CHAT_LIMITS.storedMessageMax;
  const clipped: { type: 'text'; text: string }[] = [];
  for (const part of parts) {
    if (left <= 0) break;
    const text = part.text.slice(0, left);
    left -= text.length;
    clipped.push({ type: 'text', text });
  }
  return clipped;
}

interface MessageRow {
  id: string;
  role: string;
  parts: unknown;
  createdAt: Date;
}

function textOf(parts: readonly { text: string }[]): string {
  return parts.map((part) => part.text).join('');
}

function toStored(row: MessageRow): AiStoredMessage | null {
  const parts = StoredPartsSchema.safeParse(row.parts);
  if (!parts.success || (row.role !== 'user' && row.role !== 'assistant')) return null;
  return { id: row.id, role: row.role, parts: parts.data, createdAt: row.createdAt.toISOString() };
}

// Las conversaciones son privadas: de otro usuario o de otro proyecto no existen.
async function ownConversation(db: Db, actor: Actor, projectId: string, conversationId: string) {
  const conversation = await db.aiConversation.findFirst({
    where: { id: conversationId, projectId, userId: actor.userId },
    select: { id: true, title: true, updatedAt: true },
  });
  if (!conversation) throw new AppError('NOT_FOUND');
  return conversation;
}

// Historial para el modelo: siempre de la base de datos, nunca del cliente.
async function historyFor(db: Db, conversationId: string): Promise<ModelMessage[]> {
  const rows = await db.aiMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: AI_CHAT_LIMITS.historyMessages,
    select: { id: true, role: true, parts: true, createdAt: true },
  });
  return rows
    .reverse()
    .map(toStored)
    .filter((message): message is AiStoredMessage => message !== null && textOf(message.parts).length > 0)
    .map((message) => ({ role: message.role, content: textOf(message.parts) }));
}

export const aiChatRoutes: FastifyPluginAsyncZod = async (app) => {
  const db = app.db;
  const logger: LogSink = app.log;

  app.get(
    '/projects/:id/ai/conversations',
    {
      preHandler: [requireSession, requireAiFeature('chat')],
      schema: { params: ProjectParamsSchema, response: { 200: AiConversationListSchema } },
    },
    async (request) => {
      await requireProject(db, request.actor!.userId, request.params.id, 'ai:use');
      const rows = await db.aiConversation.findMany({
        where: { projectId: request.params.id, userId: request.actor!.userId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: AI_CHAT_LIMITS.conversationsListed,
        select: { id: true, title: true, updatedAt: true },
      });
      return { items: rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() })) };
    },
  );

  app.get(
    '/projects/:id/ai/conversations/:conversationId',
    {
      preHandler: [requireSession, requireAiFeature('chat')],
      schema: { params: AiConversationParamsSchema, response: { 200: AiConversationDetailSchema } },
    },
    async (request) => {
      const actor = request.actor!;
      await requireProject(db, actor.userId, request.params.id, 'ai:use');
      const conversation = await ownConversation(db, actor, request.params.id, request.params.conversationId);
      const rows = await db.aiMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: AI_CHAT_LIMITS.messagesListed,
        select: { id: true, role: true, parts: true, createdAt: true },
      });
      return {
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt.toISOString(),
        messages: rows.reverse().flatMap((row) => toStored(row) ?? []),
      };
    },
  );

  app.post(
    '/projects/:id/ai/chat',
    {
      preHandler: [requireSession, aiRateLimit, requireAiFeature('chat')],
      schema: { params: ProjectParamsSchema, body: AiChatBodySchema },
    },
    async (request, reply) => {
      const actor = request.actor!;
      const projectId = request.params.id;
      const body = request.body;
      const access = await requireProject(db, actor.userId, projectId, 'ai:use');
      const existing = body.conversationId ? await ownConversation(db, actor, projectId, body.conversationId) : null;
      const text = textOf(body.message.parts).trim();
      // Antes de reservar: una imagen ajena da 400 sin cobrar.
      const images = await contextImages({ db, storage: app.storage }, projectId, body.imageAssetIds ?? []);

      const abort = new AbortController();
      const action = await app.ai.begin({
        feature: 'chat',
        organizationId: access.project.organizationId,
        projectId,
        userId: actor.userId,
        units: AI_UNITS.chat,
        promptLength: text.length,
        signal: abort.signal,
      });

      let conversationId: string;
      let messages: ModelMessage[];
      try {
        conversationId =
          existing?.id ??
          (await db.aiConversation.create({ data: { projectId, userId: actor.userId, title: text.slice(0, AI_CHAT_LIMITS.titleMax) } })).id;
        await db.aiMessage.create({ data: { conversationId, role: 'user', parts: [{ type: 'text', text }] } });
        if (existing) await db.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        messages = await historyFor(db, conversationId);
        const last = messages.at(-1);
        if (images.length && last?.role === 'user') {
          messages[messages.length - 1] = { role: 'user', content: [{ type: 'text', text }, ...images] };
        }
      } catch (error) {
        await action.cancel();
        throw error;
      }

      let usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } = {};
      let failure: unknown = null;
      const result = streamText({
        model: app.ai.models.languageModel('chat'),
        instructions: chatInstructions(body.canvas),
        messages,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: action.signal,
        onError: ({ error }) => {
          failure = error;
        },
        onEnd: (event) => {
          usage = { inputTokens: event.totalUsage.inputTokens, outputTokens: event.totalUsage.outputTokens };
        },
      });

      const assistantId = uuidv7();
      const stream = toUIMessageStream<ToolSet, UIMessage<{ conversationId: string }>>({
        stream: result.stream,
        generateMessageId: () => assistantId,
        messageMetadata: ({ part }) => (part.type === 'start' ? { conversationId } : undefined),
        onError: (error) => translateAiError(error, false).message,
        // Al terminar, también si el cliente cortó: se guarda lo generado hasta ese punto.
        onEnd: async ({ responseMessage }) => {
          const reply = clipParts(
            responseMessage.parts.flatMap((part) => (part.type === 'text' && part.text ? [{ type: 'text' as const, text: part.text }] : [])),
          );
          try {
            if (reply.length) {
              await db.aiMessage.create({ data: { id: assistantId, conversationId, role: 'assistant', parts: reply } });
              await db.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
            }
          } catch (error) {
            logger.error({ err: { message: (error as Error).message } }, 'No se pudo guardar la respuesta del chat de IA');
          }
          if (reply.length) await action.succeed(usage);
          else if (failure) await action.fail(failure);
          else await action.cancel();
        },
      });

      // Si el cliente corta la conexión, se deja de pedir al modelo.
      reply.raw.once('close', () => {
        if (!reply.raw.writableFinished) abort.abort();
      });
      // Las cabeceras ya fijadas (CORS, seguridad, id de petición) se copian a la respuesta cruda.
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      reply.hijack();
      try {
        await pipeUIMessageStreamToResponse({ response: reply.raw, stream });
      } catch (error) {
        logger.warn({ err: { message: (error as Error).message } }, 'El stream del chat de IA se cortó');
        abort.abort();
      }
    },
  );
};
