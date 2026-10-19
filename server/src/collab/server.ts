import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import { Server } from '@hocuspocus/server';
import type { Logger } from 'pino';
import type { Config } from '../core/config.js';
import type { Db } from '../core/db.js';
import type { Redis } from '../core/redis.js';
import { COLLAB_LIMITS, DOCUMENT_LIMITS } from '../shared/document/limits.js';
import type { NormalizeOptions } from '../shared/document/normalize.js';
import { ActivityExtension } from './extensions/activity.js';
import { AuthExtension } from './extensions/auth.js';
import { PersistenceExtension } from './extensions/database.js';
import { EventsExtension } from './extensions/events.js';
import { GuardExtension } from './extensions/guard.js';
import { HealthExtension } from './extensions/health.js';
import { NormalizeExtension } from './extensions/normalize.js';
import { RpcExtension } from './extensions/rpc.js';
import { createCollabMetrics } from './metrics.js';
import { CollabRuntime, StrikeCounter, type CollabContext } from './state.js';

export const REDIS_PREFIX = 'parcify:hp';

export interface CollabServerDeps {
  config: Pick<Config, 'instanceId' | 'port' | 'collabTokenSecret' | 'collabMaxConnPerDoc' | 'metricsToken'>;
  db: Db;
  redis: Redis;
  logger: Logger;
}

export interface CollabServerOptions {
  port?: number;
  address?: string;
  stopOnSignals?: boolean;
  debounce?: number;
  maxDebounce?: number;
  normalizeBatchMs?: number;
  normalize?: NormalizeOptions;
  retryDelaysMs?: readonly number[];
  autoVersionMs?: number;
  restoreDelayMs?: number;
  activityFlushMs?: number;
}

export function createCollabServer(deps: CollabServerDeps, options: CollabServerOptions = {}) {
  const { config, db, redis, logger } = deps;
  const runtime = new CollabRuntime(new StrikeCounter(COLLAB_LIMITS.strikeLimit, COLLAB_LIMITS.strikeWindowMs));
  const metrics = createCollabMetrics(config.instanceId);

  const guard = new GuardExtension({
    runtime,
    redis,
    logger,
    metrics,
    options: { maxConnectionsPerDocument: config.collabMaxConnPerDoc },
  });
  const normalize = new NormalizeExtension({
    logger,
    metrics,
    guard,
    batchMs: options.normalizeBatchMs,
    options: options.normalize,
  });
  const persistence = new PersistenceExtension({
    db,
    redis,
    logger,
    metrics,
    runtime,
    instanceId: config.instanceId,
    retryDelaysMs: options.retryDelaysMs,
    autoVersionMs: options.autoVersionMs,
  });
  const activity = new ActivityExtension({ db, redis, logger, flushMs: options.activityFlushMs });
  const events = new EventsExtension({ redis, logger, runtime });
  const rpc = new RpcExtension({
    db,
    redis,
    logger,
    runtime,
    persistence,
    instanceId: config.instanceId,
    restoreDelayMs: options.restoreDelayMs,
  });

  const server = new Server<CollabContext>({
    port: options.port ?? config.port,
    address: options.address ?? '0.0.0.0',
    name: config.instanceId,
    quiet: true,
    timeout: 30_000,
    debounce: options.debounce ?? 2_000,
    maxDebounce: options.maxDebounce ?? 10_000,
    unloadImmediately: false,
    stopOnSignals: options.stopOnSignals ?? true,
    websocketOptions: { maxPayload: DOCUMENT_LIMITS.maxMessageBytes },
    extensions: [
      new HealthExtension({ db, redis, metrics, metricsToken: config.metricsToken }),
      new RedisExtension({ redis, prefix: REDIS_PREFIX, identifier: config.instanceId }),
      new AuthExtension({ db, redis, logger, metrics, runtime, guard, collabTokenSecret: config.collabTokenSecret }),
      guard,
      normalize,
      persistence,
      activity,
      events,
      rpc,
    ],
  });
  metrics.bind(server.hocuspocus);

  return {
    server,
    runtime,
    metrics,
    guard,
    normalize,
    events,
    persistence,
    activity,
    rpc,
    async listen(): Promise<number> {
      await server.listen();
      await Promise.all([events.start(), rpc.start()]);
      return server.address.port;
    },
  };
}

export type CollabServer = ReturnType<typeof createCollabServer>;
