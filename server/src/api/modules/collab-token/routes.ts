import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CollabTokenResponseSchema, ProjectParamsSchema } from '../../../shared/api/projects.js';
import { requireVerified } from '../../plugins/auth.js';
import { perUserRateLimit } from '../../plugins/rate-limit.js';
import { issueCollabToken, type CollabTokenDeps } from './service.js';

export const COLLAB_TOKENS_PER_MINUTE = 30;

export const collabTokenRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: CollabTokenDeps = { db: app.db, config: app.config };

  // POST: requireVerified consulta la sesión sin caché de cookie.
  app.post(
    '/projects/:id/collab-token',
    {
      preHandler: requireVerified,
      config: { rateLimit: perUserRateLimit(COLLAB_TOKENS_PER_MINUTE, 60_000) },
      schema: { params: ProjectParamsSchema, response: { 200: CollabTokenResponseSchema } },
    },
    async (request) => issueCollabToken(deps, request.actor!, request.params.id),
  );
};
