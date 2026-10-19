import multipart from '@fastify/multipart';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AppError } from '../../../core/errors.js';
import { RpcClient } from '../../../core/rpc.js';
import { ImportProjectResponseSchema, ProjectParamsSchema } from '../../../shared/api/projects.js';
import { WorkspaceParamsSchema } from '../../../shared/api/workspaces.js';
import { requireSession } from '../../plugins/auth.js';
import { perUserRateLimit } from '../../plugins/rate-limit.js';
import { exportProject, type ExportDeps } from './export.js';
import { ImportGate } from './gate.js';
import { importProject, type ImportDeps } from './import.js';
import { ARCHIVE_LIMITS } from './zip.js';

// Importar procesa cientos de MiB y decenas de imágenes: diez por hora y usuario.
export const IMPORTS_PER_HOUR = 10;

export const exportRoutes: FastifyPluginAsyncZod = async (app) => {
  // Encapsulado: solo las rutas de este módulo aceptan multipart.
  await app.register(multipart, {
    limits: { fileSize: ARCHIVE_LIMITS.maxArchiveBytes, files: 1, fields: 4, parts: 5 },
  });
  const rpc = new RpcClient(app.redis, { owner: `api:${app.config.instanceId}`, logger: app.log });
  app.addHook('onClose', async () => rpc.close());
  const exportDeps: ExportDeps = { db: app.db, storage: app.storage, rpc, logger: app.log };
  const importDeps: ImportDeps = {
    db: app.db,
    redis: app.redis,
    storage: app.storage,
    semaphore: app.imageSemaphore,
    gate: new ImportGate(),
    logger: app.log,
  };

  app.get('/projects/:id/export.parcify', { preHandler: requireSession, schema: { params: ProjectParamsSchema } }, async (request, reply) => {
    const { fileName, stream } = await exportProject(exportDeps, request.actor!, request.params.id);
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(stream);
  });

  app.post(
    '/workspaces/:slug/import',
    {
      preHandler: requireSession,
      config: { rateLimit: perUserRateLimit(IMPORTS_PER_HOUR, 3_600_000) },
      schema: { params: WorkspaceParamsSchema, response: { 201: ImportProjectResponseSchema } },
    },
    async (request, reply) => {
      const result = await importProject(importDeps, request.actor!, request.params.slug, async () => {
        if (!request.isMultipart()) throw new AppError('VALIDATION_FAILED', { details: { reason: 'multipart' } });
        const file = await request.file();
        if (!file) throw new AppError('VALIDATION_FAILED', { details: { reason: 'file' } });
        return file.toBuffer();
      });
      return reply.status(201).send(result);
    },
  );
};
