import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { RpcClient } from '../../../core/rpc.js';
import { requireSession } from '../../plugins/auth.js';
import { perUserRateLimit } from '../../plugins/rate-limit.js';
import {
  CreateVersionBodySchema,
  RestoreVersionResponseSchema,
  VersionItemParamsSchema,
  VersionListQuerySchema,
  VersionListResponseSchema,
  VersionParamsSchema,
  VersionSchema,
} from './schemas.js';
import { createVersion, listVersions, restoreVersion, versionState, type VersionDeps } from './service.js';

// Cada versión copia el documento entero: un tope por usuario evita llenar la tabla a golpe de Ctrl+S.
export const VERSION_WRITES_PER_MINUTE = 20;

export const versionRoutes: FastifyPluginAsyncZod = async (app) => {
  const rpc = new RpcClient(app.redis, { owner: `api:${app.config.instanceId}`, logger: app.log });
  app.addHook('onClose', async () => rpc.close());
  const deps: VersionDeps = { db: app.db, rpc };
  const writeLimit = perUserRateLimit(VERSION_WRITES_PER_MINUTE, 60_000);

  app.get(
    '/projects/:id/versions',
    {
      preHandler: requireSession,
      schema: { params: VersionParamsSchema, querystring: VersionListQuerySchema, response: { 200: VersionListResponseSchema } },
    },
    async (request) => listVersions(deps, request.actor!, request.params.id, request.query),
  );

  app.post(
    '/projects/:id/versions',
    {
      preHandler: requireSession,
      config: { rateLimit: writeLimit },
      schema: { params: VersionParamsSchema, body: CreateVersionBodySchema, response: { 201: VersionSchema } },
    },
    async (request, reply) => reply.status(201).send(await createVersion(deps, request.actor!, request.params.id, request.body)),
  );

  app.post(
    '/projects/:id/versions/:vid/restore',
    {
      preHandler: requireSession,
      config: { rateLimit: writeLimit },
      schema: { params: VersionItemParamsSchema, response: { 200: RestoreVersionResponseSchema } },
    },
    async (request) => restoreVersion(deps, request.actor!, request.params.id, request.params.vid),
  );

  app.get(
    '/projects/:id/versions/:vid/state',
    { preHandler: requireSession, schema: { params: VersionItemParamsSchema } },
    async (request, reply) => {
      const state = await versionState(deps, request.actor!, request.params.id, request.params.vid);
      // Una versión no cambia nunca; la caché es privada porque depende del acceso.
      return reply
        .header('content-type', 'application/octet-stream')
        .header('cache-control', 'private, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        .send(state);
    },
  );
};
