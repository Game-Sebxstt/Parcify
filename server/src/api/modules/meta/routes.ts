import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { MetaResponseSchema } from '../../../shared/api/meta.js';
import { buildMeta } from './service.js';

export const metaRoutes: FastifyPluginAsyncZod = async (app) => {
  const meta = buildMeta(app.config);
  app.get('/meta', { schema: { response: { 200: MetaResponseSchema } } }, async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return meta;
  });
};
