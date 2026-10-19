import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../../core/errors.js';
import { sha256Hex } from '../../../core/ids.js';
import { isLocalStorage, StorageKeyError, StorageNotFoundError } from '../../../core/storage/index.js';
import { SignedQuerySchema } from '../assets/schemas.js';

const IMAGE_TYPE = /^image\/(png|jpeg|webp|gif|avif)$/;
const FILES_PER_MINUTE = 3_000;

// Solo con el driver local: S3 sirve sus propias URLs prefirmadas.
export const fileRoutes: FastifyPluginAsyncZod = async (app) => {
  const storage = app.storage;
  if (!isLocalStorage(storage)) return;

  app.get(
    '/files/*',
    {
      // Un lienzo con cientos de imágenes pide muchos ficheros de golpe; cada URL ya va firmada.
      config: { rateLimit: { max: FILES_PER_MINUTE, timeWindow: 60_000 } },
      schema: { params: z.object({ '*': z.string().max(200) }), querystring: SignedQuerySchema },
    },
    async (request, reply) => {
      const key = request.params['*'];
      let head: Awaited<ReturnType<typeof storage.head>>;
      try {
        if (!storage.verify('GET', key, request.query)) throw new AppError('FORBIDDEN');
        head = await storage.head(key);
      } catch (error) {
        if (error instanceof StorageKeyError) throw new AppError('NOT_FOUND');
        throw error;
      }
      if (!head) throw new AppError('NOT_FOUND');

      // Las claves son inmutables: la etiqueta depende solo de la clave y el tamaño.
      const etag = `"${sha256Hex(`${key}:${head.size}`).slice(0, 32)}"`;
      reply
        .header('cache-control', 'private, max-age=3600')
        .header('etag', etag)
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'");
      if (request.headers['if-none-match'] === etag) return reply.status(304).send();

      const downloadName = request.query.name;
      if (downloadName) {
        reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
      } else if (IMAGE_TYPE.test(head.contentType)) {
        reply.header('content-disposition', 'inline');
      }
      reply.header('content-type', head.contentType).header('content-length', head.size);
      try {
        return reply.send(await storage.getStream(key));
      } catch (error) {
        if (error instanceof StorageNotFoundError) throw new AppError('NOT_FOUND');
        throw error;
      }
    },
  );
};
