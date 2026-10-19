import { generateImage } from 'ai';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AI_IMAGE_TIMEOUT_MS } from '../../../core/ai/errors.js';
import { readAiJob } from '../../../core/ai/jobs.js';
import { AI_UNITS } from '../../../core/ai/quota.js';
import type { AiActionHandle } from '../../../core/ai/run.js';
import { AppError } from '../../../core/errors.js';
import { uuidv7 } from '../../../core/ids.js';
import type { LogSink } from '../../../core/logger.js';
import { requireProject } from '../../../core/permissions.js';
import {
  AiImageRequestSchema,
  AiJobAcceptedSchema,
  AiJobParamsSchema,
  AiJobSchema,
  type AiImageRequest,
} from '../../../shared/api/ai.js';
import { ProjectParamsSchema } from '../../../shared/api/projects.js';
import type { Actor } from '../../types.js';
import { aiRateLimit, requireAiFeature, type AiService } from '../../plugins/ai.js';
import { requireSession } from '../../plugins/auth.js';
import { storeGeneratedImage, type AssetDeps } from '../assets/service.js';

export interface ImageJobDeps extends AssetDeps {
  ai: AiService;
  logger: LogSink;
}

// Acepta la generación: hueco en la cola (si no, 503 sin cobrar), reserva de 4 unidades por imagen pedida y el
// trabajo en segundo plano. Al terminar se cobran solo las imágenes que llegaron a guardarse.
export async function startImageJob(deps: ImageJobDeps, actor: Actor, projectId: string, body: AiImageRequest): Promise<string> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'ai:use');
  const release = deps.ai.jobs.admit();
  let handle: AiActionHandle;
  try {
    handle = await deps.ai.begin({
      feature: 'image',
      organizationId: access.project.organizationId,
      projectId,
      userId: actor.userId,
      units: AI_UNITS.image * body.count,
      promptLength: body.prompt.length,
      timeoutMs: AI_IMAGE_TIMEOUT_MS,
    });
  } catch (error) {
    release();
    throw error;
  }

  const jobId = uuidv7();
  const work = async (): Promise<string[]> => {
    // El tope de 120 s cuenta desde que la generación sale de la cola.
    const timeout = AbortSignal.timeout(AI_IMAGE_TIMEOUT_MS);
    let images: Uint8Array[];
    try {
      const result = await generateImage({
        model: deps.ai.models.imageModel(),
        prompt: body.prompt,
        n: body.count,
        aspectRatio: body.aspect,
        abortSignal: timeout,
      });
      images = result.images.slice(0, body.count).map((image) => image.uint8Array);
    } catch (error) {
      throw await handle.fail(error, timeout.aborted);
    }

    const saved: string[] = [];
    for (const bytes of images) {
      try {
        const asset = await storeGeneratedImage(deps, {
          bytes: Buffer.from(bytes),
          projectId,
          organizationId: access.project.organizationId,
          ownerId: actor.userId,
          prompt: body.prompt,
        });
        if (!saved.includes(asset.id)) saved.push(asset.id);
      } catch (error) {
        deps.logger.warn({ jobId, code: error instanceof AppError ? error.code : 'INTERNAL' }, 'No se pudo guardar una imagen generada');
      }
    }
    if (!saved.length) throw await handle.fail(new AppError('AI_BAD_OUTPUT'));
    await handle.succeed({ units: AI_UNITS.image * saved.length, images: saved.length });
    return saved;
  };

  try {
    await deps.ai.jobs.start(
      { jobId, userId: actor.userId, projectId, count: body.count, reservation: handle.reservation },
      release,
      work,
      () => handle.cancel(),
    );
  } catch (error) {
    await handle.cancel();
    throw error;
  }
  return jobId;
}

export const aiImageRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: ImageJobDeps = {
    db: app.db,
    redis: app.redis,
    storage: app.storage,
    semaphore: app.imageSemaphore,
    logger: app.log,
    ai: app.ai,
  };

  app.post(
    '/projects/:id/ai/images',
    {
      preHandler: [requireSession, aiRateLimit, requireAiFeature('image')],
      schema: { params: ProjectParamsSchema, body: AiImageRequestSchema, response: { 202: AiJobAcceptedSchema } },
    },
    async (request, reply) => {
      const jobId = await startImageJob(deps, request.actor!, request.params.id, request.body);
      return reply.status(202).send({ jobId });
    },
  );

  // Solo quien lo creó lo ve; para cualquier otro no existe.
  app.get(
    '/ai/jobs/:jobId',
    { preHandler: requireSession, schema: { params: AiJobParamsSchema, response: { 200: AiJobSchema } } },
    async (request) => {
      const job = await readAiJob(app.redis, request.params.jobId, request.actor!.userId);
      if (!job) throw new AppError('NOT_FOUND');
      return job;
    },
  );
};
