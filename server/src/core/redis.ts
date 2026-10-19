import { Redis, type RedisOptions } from 'ioredis';
import type { LogSink } from './logger.js';

export type { Redis };

export const REDIS_MAX_BACKOFF_MS = 2_000;

export function redisRetryDelay(times: number): number {
  return Math.min(times * 200, REDIS_MAX_BACKOFF_MS);
}

export interface CreateRedisOptions {
  name: string;
  logger?: LogSink;
  // Tope por comando; en la API evita que una petición quede colgada si Redis cae.
  commandTimeout?: number;
}

export function createRedis(url: string, options: CreateRedisOptions): Redis {
  const redisOptions: RedisOptions = {
    connectionName: options.name,
    maxRetriesPerRequest: null,
    retryStrategy: redisRetryDelay,
    connectTimeout: 5_000,
    // IPv4 e IPv6: la red privada de Railway (*.railway.internal) solo resuelve a IPv6.
    family: 0,
    ...(options.commandTimeout ? { commandTimeout: options.commandTimeout } : {}),
  };
  const client = new Redis(url, redisOptions);

  const logger = options.logger;
  let down = false;
  client.on('error', (error: Error) => {
    if (down) return;
    down = true;
    logger?.error({ err: { message: error.message }, redis: options.name }, 'Redis no responde');
  });
  client.on('ready', () => {
    if (!down) return;
    down = false;
    logger?.info({ redis: options.name }, 'Redis recuperado');
  });
  return client;
}

export async function pingRedis(client: Redis): Promise<void> {
  const reply = await client.ping();
  if (reply !== 'PONG') throw new Error(`Respuesta inesperada de Redis: ${reply}`);
}
