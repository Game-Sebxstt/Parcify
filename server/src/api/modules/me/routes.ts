import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authHeaders, requireSession } from '../../plugins/auth.js';
import {
  MeResponseSchema,
  SecurityEventsQuerySchema,
  SecurityEventsResponseSchema,
  SetPasswordBodySchema,
  UpdateMeBodySchema,
} from './schemas.js';
import { deleteMe, getMe, listSecurityEvents, setPassword, updateMe, type MeDeps } from './service.js';

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: MeDeps = { db: app.db, redis: app.redis, auth: app.auth, logger: app.log };

  app.get('/me', { preHandler: requireSession, schema: { response: { 200: MeResponseSchema } } }, async (request) =>
    getMe(deps, request.actor!),
  );

  app.patch(
    '/me',
    { preHandler: requireSession, schema: { body: UpdateMeBodySchema, response: { 200: MeResponseSchema } } },
    async (request) => updateMe(deps, request.actor!, authHeaders(request), request.body),
  );

  app.get(
    '/me/security-events',
    {
      preHandler: requireSession,
      schema: { querystring: SecurityEventsQuerySchema, response: { 200: SecurityEventsResponseSchema } },
    },
    async (request) => listSecurityEvents(deps, request.actor!, request.query),
  );

  app.post(
    '/me/password',
    { preHandler: requireSession, schema: { body: SetPasswordBodySchema } },
    async (request, reply) => {
      await setPassword(deps, authHeaders(request), new Date(request.authSession!.session.createdAt), request.body);
      return reply.status(204).send();
    },
  );

  app.delete('/me', { preHandler: requireSession }, async (request, reply) => {
    await deleteMe(deps, request.actor!, new Date(request.authSession!.session.createdAt));
    return reply.status(204).send();
  });
};
