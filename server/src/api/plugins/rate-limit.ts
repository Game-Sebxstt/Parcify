import rateLimit, { type RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../../core/errors.js';

export const GLOBAL_RATE_LIMIT = 300;
const NOISY_THRESHOLD = 10;

// Límite propio de una ruta, por usuario: corre en preHandler, después de requireSession.
export function perUserRateLimit(max: number, timeWindowMs: number): RateLimitOptions {
  return {
    max,
    timeWindow: timeWindowMs,
    hook: 'preHandler',
    keyGenerator: (request: FastifyRequest) => (request.actor ? `u:${request.actor.userId}` : `ip:${request.ip}`),
  };
}

export const rateLimitPlugin = fp<{ max?: number }>(
  async (app, options) => {
    // Cuenta en memoria los rechazos por IP para avisar una sola vez por minuto de un cliente insistente.
    let windowStart = Date.now();
    const rejections = new Map<string, number>();

    await app.register(rateLimit, {
      global: true,
      max: options.max ?? GLOBAL_RATE_LIMIT,
      timeWindow: 60_000,
      redis: app.redis,
      nameSpace: 'parcify:rl:',
      skipOnError: true,
      keyGenerator: (request) => (request.actor ? `u:${request.actor.userId}` : `ip:${request.ip}`),
      onExceeded: (request) => {
        const now = Date.now();
        if (now - windowStart > 60_000) {
          windowStart = now;
          rejections.clear();
        }
        const count = (rejections.get(request.ip) ?? 0) + 1;
        rejections.set(request.ip, count);
        if (count === NOISY_THRESHOLD + 1) request.log.warn({ ip: request.ip }, 'Rate limit superado de forma repetida');
      },
      errorResponseBuilder: (_request, context) =>
        new AppError('RATE_LIMITED', { details: { retryAfterSeconds: Math.ceil(context.ttl / 1000) } }),
    });
  },
  { name: 'rate-limit', dependencies: ['redis'] },
);
