import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { pingDb } from '../../../core/db.js';
import { pingRedis } from '../../../core/redis.js';
import { HealthResponseSchema, ReadyResponseSchema } from '../../../shared/api/meta.js';

const READY_TIMEOUT_MS = 1_000;

async function check(task: () => Promise<unknown>): Promise<'ok' | 'fail'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), READY_TIMEOUT_MS);
  });
  try {
    await Promise.race([task(), timeout]);
    return 'ok';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  const noLimit = { rateLimit: false } as const;

  app.get('/health', { config: noLimit, schema: { response: { 200: HealthResponseSchema } } }, async () => ({
    status: 'ok' as const,
  }));

  app.get(
    '/ready',
    { config: noLimit, schema: { response: { 200: ReadyResponseSchema, 503: ReadyResponseSchema } } },
    async (_request, reply) => {
      const [postgres, redis] = await Promise.all([check(() => pingDb(app.db)), check(() => pingRedis(app.redis))]);
      const ok = postgres === 'ok' && redis === 'ok';
      reply.header('cache-control', 'no-store');
      return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'unavailable', checks: { postgres, redis } });
    },
  );
};
