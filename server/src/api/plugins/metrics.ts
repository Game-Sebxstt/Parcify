import fp from 'fastify-plugin';
import { AppError } from '../../core/errors.js';
import { safeEqual } from '../../core/ids.js';
import { createApiMetrics } from '../../core/metrics.js';

export const metricsPlugin = fp(
  async (app) => {
    const metrics = createApiMetrics(app.config.instanceId);
    app.decorate('metrics', metrics);
    metrics.watchQueue('assets', app.imageSemaphore);
    metrics.watchQueue('ai-images', app.ai.jobs.slots);
    app.ai.deps.onUsage = (feature, status) => metrics.aiUsage.inc({ feature, status });

    app.addHook('onResponse', async (request, reply) => {
      metrics.httpDuration.observe(
        { method: request.method, route: request.routeOptions.url ?? 'unmatched', status_code: String(reply.statusCode) },
        reply.elapsedTime / 1000,
      );
    });

    const token = app.config.metricsToken;
    app.get('/metrics', { config: { rateLimit: false } }, async (request, reply) => {
      const header = request.headers.authorization ?? '';
      const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token || !provided || !safeEqual(provided, token)) throw new AppError('UNAUTHORIZED');
      reply.header('content-type', metrics.registry.contentType);
      reply.header('cache-control', 'no-store');
      return metrics.registry.metrics();
    });
  },
  { name: 'metrics', dependencies: ['config', 'storage', 'ai'] },
);
