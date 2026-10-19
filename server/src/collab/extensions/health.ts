import type { ServerResponse } from 'node:http';
import type { Extension, onRequestPayload } from '@hocuspocus/server';
import type { Db } from '../../core/db.js';
import { pingDb } from '../../core/db.js';
import { safeEqual } from '../../core/ids.js';
import type { Redis } from '../../core/redis.js';
import { pingRedis } from '../../core/redis.js';
import { COLLAB_LIMITS } from '../../shared/document/limits.js';
import type { CollabMetrics } from '../metrics.js';

const READY_TIMEOUT_MS = 1_000;
const MAX_READY_DOCUMENTS = COLLAB_LIMITS.maxDocumentsPerInstance * COLLAB_LIMITS.readyDocumentRatio;

async function check(task: () => Promise<unknown>): Promise<'ok' | 'fail'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), READY_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

// Atiende /health, /ready y /metrics antes de que Hocuspocus responda; rechazar sin error corta la cadena de hooks.
export class HealthExtension implements Extension {
  extensionName = 'health';
  priority = 1000;

  constructor(
    private readonly deps: { db: Db; redis: Redis; metrics?: CollabMetrics; metricsToken?: string | undefined },
  ) {}

  async onRequest({ request, response, instance }: onRequestPayload): Promise<void> {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/health') {
      json(response, 200, { status: 'ok' });
      return Promise.reject();
    }
    if (path === '/ready') {
      const [postgres, redis] = await Promise.all([
        check(() => pingDb(this.deps.db)),
        check(() => pingRedis(this.deps.redis)),
      ]);
      const documents = instance.getDocumentsCount() < MAX_READY_DOCUMENTS ? 'ok' : 'fail';
      const ok = postgres === 'ok' && redis === 'ok' && documents === 'ok';
      json(response, ok ? 200 : 503, { status: ok ? 'ok' : 'unavailable', checks: { postgres, redis, documents } });
      return Promise.reject();
    }
    if (path === '/metrics' && this.deps.metrics) {
      const header = request.headers.authorization ?? '';
      const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
      const token = this.deps.metricsToken;
      if (!token || !provided || !safeEqual(provided, token)) {
        json(response, 401, { error: { code: 'UNAUTHORIZED' } });
        return Promise.reject();
      }
      const body = await this.deps.metrics.registry.metrics();
      response.writeHead(200, { 'content-type': this.deps.metrics.registry.contentType, 'cache-control': 'no-store' });
      response.end(body);
      return Promise.reject();
    }
  }
}
