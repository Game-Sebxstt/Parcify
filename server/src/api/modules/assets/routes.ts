import type { Readable } from 'node:stream';
import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ProjectParamsSchema } from '../../../shared/api/projects.js';
import { requireSession } from '../../plugins/auth.js';
import { perUserRateLimit } from '../../plugins/rate-limit.js';
import {
  AssetListQuerySchema,
  AssetListResponseSchema,
  AssetParamsSchema,
  AssetSchema,
  CopyAssetsBodySchema,
  CopyAssetsResponseSchema,
  CreateUploadBodySchema,
  CreateUploadResponseSchema,
  DownloadAssetResponseSchema,
  ResolveAssetsBodySchema,
  ResolveAssetsResponseSchema,
  SetPreviewBodySchema,
  SignedQuerySchema,
  UpdateAssetBodySchema,
} from './schemas.js';
import {
  completeUpload,
  copyAssets,
  createUpload,
  deleteAsset,
  downloadAsset,
  listProjectAssets,
  receiveUploadContent,
  resolveAssets,
  setProjectPreview,
  updateAsset,
  type AssetDeps,
} from './service.js';

export const UPLOADS_PER_HOUR = 60;

function depsOf(app: Parameters<FastifyPluginAsync>[0]): AssetDeps {
  return { db: app.db, redis: app.redis, storage: app.storage, semaphore: app.imageSemaphore, logger: app.log };
}

// Ruta del driver local: el cuerpo llega en crudo y se escribe en streaming con tope de bytes.
const uploadContentRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = depsOf(app);
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

  app.put(
    '/assets/uploads/:id/content',
    { schema: { params: AssetParamsSchema, querystring: SignedQuerySchema } },
    async (request, reply) => {
      const length = Number(request.headers['content-length']);
      await receiveUploadContent(
        deps,
        request.params.id,
        request.query,
        Number.isFinite(length) ? length : undefined,
        request.body as Readable,
      );
      return reply.status(204).send();
    },
  );
};

export const assetRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = depsOf(app);

  await app.register(uploadContentRoutes);

  app.post(
    '/assets/uploads',
    {
      preHandler: requireSession,
      config: { rateLimit: perUserRateLimit(UPLOADS_PER_HOUR, 60 * 60_000) },
      schema: { body: CreateUploadBodySchema, response: { 201: CreateUploadResponseSchema } },
    },
    async (request, reply) => reply.status(201).send(await createUpload(deps, request.actor!, request.body)),
  );

  app.post(
    '/assets/uploads/:id/complete',
    { preHandler: requireSession, schema: { params: AssetParamsSchema, response: { 200: AssetSchema } } },
    async (request) => completeUpload(deps, request.actor!, request.params.id),
  );

  app.post(
    '/assets/resolve',
    { preHandler: requireSession, schema: { body: ResolveAssetsBodySchema, response: { 200: ResolveAssetsResponseSchema } } },
    async (request) => resolveAssets(deps, request.actor!, request.body),
  );

  app.post(
    '/assets/copy',
    { preHandler: requireSession, schema: { body: CopyAssetsBodySchema, response: { 200: CopyAssetsResponseSchema } } },
    async (request) => copyAssets(deps, request.actor!, request.body),
  );

  app.post(
    '/assets/:id/download',
    { preHandler: requireSession, schema: { params: AssetParamsSchema, response: { 200: DownloadAssetResponseSchema } } },
    async (request) => downloadAsset(deps, request.actor!, request.params.id),
  );

  app.get(
    '/projects/:id/assets',
    {
      preHandler: requireSession,
      schema: { params: ProjectParamsSchema, querystring: AssetListQuerySchema, response: { 200: AssetListResponseSchema } },
    },
    async (request) => listProjectAssets(deps, request.actor!, request.params.id, request.query),
  );

  app.patch(
    '/assets/:id',
    {
      preHandler: requireSession,
      schema: { params: AssetParamsSchema, body: UpdateAssetBodySchema, response: { 200: AssetSchema } },
    },
    async (request) => updateAsset(deps, request.actor!, request.params.id, request.body),
  );

  app.delete('/assets/:id', { preHandler: requireSession, schema: { params: AssetParamsSchema } }, async (request, reply) => {
    await deleteAsset(deps, request.actor!, request.params.id);
    return reply.status(204).send();
  });

  app.post(
    '/projects/:id/preview',
    { preHandler: requireSession, schema: { params: ProjectParamsSchema, body: SetPreviewBodySchema } },
    async (request, reply) => {
      await setProjectPreview(deps, request.actor!, request.params.id, request.body.assetId);
      return reply.status(204).send();
    },
  );
};
