import { getHeapStatistics } from 'node:v8';
import underPressure from '@fastify/under-pressure';
import fp from 'fastify-plugin';
import { AppError } from '../../core/errors.js';

const RETRY_AFTER_SECONDS = 10;

class OverloadedError extends AppError {
  constructor() {
    super('SERVICE_UNAVAILABLE', { headers: { 'retry-after': String(RETRY_AFTER_SECONDS) } });
  }
}

export const underPressurePlugin = fp(
  async (app) => {
    await app.register(underPressure, {
      maxEventLoopDelay: 1_000,
      maxHeapUsedBytes: Math.floor(getHeapStatistics().heap_size_limit * 0.85),
      retryAfter: RETRY_AFTER_SECONDS,
      customError: OverloadedError,
      exposeStatusRoute: false,
    });
  },
  { name: 'under-pressure' },
);
