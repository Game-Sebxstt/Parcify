import type { Auth, AuthSession } from '../core/auth/index.js';
import type { Config } from '../core/config.js';
import type { Db } from '../core/db.js';
import type { Mailer } from '../core/mailer/index.js';
import type { Redis } from '../core/redis.js';
import type { Semaphore } from '../core/images/semaphore.js';
import type { StorageDriver } from '../core/storage/index.js';
import type { ApiMetrics } from '../core/metrics.js';
import type { AiService } from './plugins/ai.js';

export interface Actor {
  userId: string;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    redis: Redis;
    mailer: Mailer;
    auth: Auth;
    storage: StorageDriver;
    imageSemaphore: Semaphore;
    ai: AiService;
    metrics: ApiMetrics;
  }

  interface FastifyRequest {
    actor: Actor | null;
    authSession: AuthSession | null;
  }
}
