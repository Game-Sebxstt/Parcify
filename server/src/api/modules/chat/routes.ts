import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireSession } from '../../plugins/auth.js';
import { perUserRateLimit } from '../../plugins/rate-limit.js';
import {
  ChatListQuerySchema,
  ChatListResponseSchema,
  ChatMessageParamsSchema,
  ChatMessageSchema,
  ChatParamsSchema,
  CreateChatMessageBodySchema,
  UpdateChatMessageBodySchema,
} from './schemas.js';
import { createMessage, deleteMessage, listMessages, updateMessage, type ChatDeps } from './service.js';

export const CHAT_MESSAGES_PER_WINDOW = 20;
export const CHAT_WINDOW_MS = 10_000;

export const chatRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: ChatDeps = { db: app.db, redis: app.redis, logger: app.log };

  app.get(
    '/projects/:id/chat',
    {
      preHandler: requireSession,
      schema: { params: ChatParamsSchema, querystring: ChatListQuerySchema, response: { 200: ChatListResponseSchema } },
    },
    async (request) => listMessages(deps, request.actor!, request.params.id, request.query),
  );

  app.post(
    '/projects/:id/chat',
    {
      preHandler: requireSession,
      config: { rateLimit: perUserRateLimit(CHAT_MESSAGES_PER_WINDOW, CHAT_WINDOW_MS) },
      schema: { params: ChatParamsSchema, body: CreateChatMessageBodySchema, response: { 201: ChatMessageSchema } },
    },
    async (request, reply) => reply.status(201).send(await createMessage(deps, request.actor!, request.params.id, request.body)),
  );

  app.patch(
    '/projects/:id/chat/:msgId',
    {
      preHandler: requireSession,
      schema: { params: ChatMessageParamsSchema, body: UpdateChatMessageBodySchema, response: { 200: ChatMessageSchema } },
    },
    async (request) => updateMessage(deps, request.actor!, request.params.id, request.params.msgId, request.body),
  );

  app.delete(
    '/projects/:id/chat/:msgId',
    { preHandler: requireSession, schema: { params: ChatMessageParamsSchema } },
    async (request, reply) => {
      await deleteMessage(deps, request.actor!, request.params.id, request.params.msgId);
      return reply.status(204).send();
    },
  );
};
