import fp from 'fastify-plugin';
import { createRedis, type Redis } from '../../core/redis.js';

export const redisPlugin = fp<{ redis?: Redis }>(
  async (app, options) => {
    // Con tope por comando: si Redis cae, las peticiones fallan rápido en vez de quedarse esperando.
    const redis = options.redis ?? createRedis(app.config.redisUrl, { name: 'api', logger: app.log, commandTimeout: 1_000 });
    app.decorate('redis', redis);
    if (!options.redis) {
      app.addHook('onClose', async () => {
        await redis.quit().catch(() => redis.disconnect());
      });
    }
  },
  { name: 'redis', dependencies: ['config'] },
);
