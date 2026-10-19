import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { RpcClient } from '../../../core/rpc.js';
import { requireSession } from '../../plugins/auth.js';
import { perUserRateLimit } from '../../plugins/rate-limit.js';
import {
  ProjectParamsSchema,
  PublishTemplateBodySchema,
  TemplateLikeResponseSchema,
  TemplateListQuerySchema,
  TemplateListResponseSchema,
  TemplateParamsSchema,
  TemplateSummarySchema,
  WorkspaceParamsSchema,
} from './schemas.js';
import {
  deleteTemplate,
  listTemplates,
  publishTemplate,
  setTemplateLike,
  type TemplateDeps,
} from './service.js';

// Publicar copia todos los objetos del proyecto en el storage.
const PUBLISH_REQUESTS_PER_MINUTE = 10;

export const templateRoutes: FastifyPluginAsyncZod = async (app) => {
  const rpc = new RpcClient(app.redis, { owner: `api:${app.config.instanceId}`, logger: app.log });
  app.addHook('onClose', async () => rpc.close());
  const deps: TemplateDeps = { db: app.db, storage: app.storage, rpc, logger: app.log };

  app.post(
    '/projects/:id/template',
    {
      preHandler: requireSession,
      config: { rateLimit: perUserRateLimit(PUBLISH_REQUESTS_PER_MINUTE, 60_000) },
      schema: { params: ProjectParamsSchema, body: PublishTemplateBodySchema, response: { 201: TemplateSummarySchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await publishTemplate(deps, request.actor!, request.params.id, request.body)),
  );

  app.get(
    '/workspaces/:slug/templates',
    {
      preHandler: requireSession,
      schema: {
        params: WorkspaceParamsSchema,
        querystring: TemplateListQuerySchema,
        response: { 200: TemplateListResponseSchema },
      },
    },
    async (request) => listTemplates(deps, request.actor!, request.params.slug, request.query),
  );

  app.delete('/templates/:id', { preHandler: requireSession, schema: { params: TemplateParamsSchema } }, async (request, reply) => {
    await deleteTemplate(deps, request.actor!, request.params.id);
    return reply.status(204).send();
  });

  app.put(
    '/templates/:id/like',
    { preHandler: requireSession, schema: { params: TemplateParamsSchema, response: { 200: TemplateLikeResponseSchema } } },
    async (request) => setTemplateLike(deps, request.actor!, request.params.id, true),
  );

  app.delete(
    '/templates/:id/like',
    { preHandler: requireSession, schema: { params: TemplateParamsSchema, response: { 200: TemplateLikeResponseSchema } } },
    async (request) => setTemplateLike(deps, request.actor!, request.params.id, false),
  );
};
