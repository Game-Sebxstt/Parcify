import { z } from 'zod';
import { AuthIdSchema, NameSchema, UuidSchema } from '../shared/api/common.js';
import type { LogSink } from './logger.js';
import type { Redis } from './redis.js';

// Peticiones de la API a las instancias de collab que tienen el documento en memoria.
export const RPC_CHANNEL = 'parcify:rpc:collab';
export const RPC_CLAIM_TTL_MS = 15_000;
// Sin respuesta en este plazo, la API (o una instancia sin el documento) intenta el reclamo.
export const RPC_FALLBACK_MS = 1_000;
export const RPC_TIMEOUT_MS = 10_000;
export const RESTORE_LOCK_TTL_MS = 30_000;

export function replyChannel(requestId: string): string {
  return `parcify:rpc:reply:${requestId}`;
}

export function claimKey(requestId: string): string {
  return `parcify:rpc:claim:${requestId}`;
}

export function restoreLockKey(projectId: string): string {
  return `parcify:restore:${projectId}`;
}

export const RpcRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('version.create'),
    requestId: UuidSchema,
    projectId: UuidSchema,
    userId: AuthIdSchema,
    name: NameSchema.nullable(),
  }),
  z.object({
    type: z.literal('version.restore'),
    requestId: UuidSchema,
    projectId: UuidSchema,
    userId: AuthIdSchema,
    versionId: UuidSchema,
  }),
  // Guarda ya el estado vivo para que la API lo lea de ProjectDocument (exportar .parcify).
  z.object({
    type: z.literal('document.flush'),
    requestId: UuidSchema,
    projectId: UuidSchema,
    userId: AuthIdSchema,
  }),
]);

export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RPC_ERRORS = ['epoch_changed', 'restore_in_progress', 'not_found', 'failed'] as const;

export const RpcReplySchema = z.union([
  z.object({ ok: z.literal(true), versionId: UuidSchema, restorePointId: UuidSchema.optional() }),
  z.object({ ok: z.literal(true), flushed: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.enum(RPC_ERRORS) }),
]);

export type RpcReply = z.infer<typeof RpcReplySchema>;

// SET NX es atómico: un solo ejecutor por petición entre todas las instancias y la API.
export async function claimRequest(redis: Redis, requestId: string, owner: string): Promise<boolean> {
  return (await redis.set(claimKey(requestId), owner, 'PX', RPC_CLAIM_TTL_MS, 'NX')) === 'OK';
}

export async function publishReply(redis: Redis, requestId: string, reply: RpcReply): Promise<void> {
  await redis.publish(replyChannel(requestId), JSON.stringify(RpcReplySchema.parse(reply)));
}

// Tras un reemplazo, el bloqueo sigue este tiempo para que el update llegue a las demás instancias por Redis.
export const RESTORE_SETTLE_MS = 1_500;

// Con ARGV[2] > 0 deja caducar la clave en ese plazo en vez de borrarla.
const RELEASE_IF_OWNER = `if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
if tonumber(ARGV[2]) > 0 then return redis.call('pexpire', KEYS[1], ARGV[2]) end
return redis.call('del', KEYS[1])`;

export async function acquireRestoreLock(redis: Redis, projectId: string, requestId: string): Promise<boolean> {
  return (await redis.set(restoreLockKey(projectId), requestId, 'PX', RESTORE_LOCK_TTL_MS, 'NX')) === 'OK';
}

export async function releaseRestoreLock(redis: Redis, projectId: string, requestId: string, settleMs = 0): Promise<boolean> {
  return (await redis.eval(RELEASE_IF_OWNER, 1, restoreLockKey(projectId), requestId, settleMs)) === 1;
}

export interface RpcCallOptions {
  // Camino alternativo de la API si gana el reclamo tras `fallbackAfterMs`.
  fallback?: () => Promise<RpcReply>;
  fallbackAfterMs?: number;
  timeoutMs?: number;
}

// Espera que gana `answered` o vence a los `ms` con `onTimeout`; el temporizador no sobrevive a la respuesta.
async function within<T, U>(answered: Promise<T>, ms: number, onTimeout: U): Promise<T | U> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([answered, new Promise<U>((resolve) => (timer = setTimeout(() => resolve(onTimeout), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

// Lado de la API: publica la petición y espera la respuesta en su canal propio. Una sola conexión de suscripción
// para todas las peticiones en vuelo de este proceso.
export class RpcClient {
  private subscriber: Redis | null = null;
  private readonly waiting = new Map<string, (reply: RpcReply) => void>();

  constructor(
    private readonly redis: Redis,
    private readonly options: { owner: string; logger: LogSink },
  ) {}

  private ensureSubscriber(): Redis {
    if (this.subscriber) return this.subscriber;
    const subscriber = this.redis.duplicate({ connectionName: 'api-rpc' });
    subscriber.on('error', (error: Error) =>
      this.options.logger.warn({ err: { message: error.message } }, 'Redis no responde (rpc)'),
    );
    subscriber.on('message', (channel: string, message: string) => {
      const resolve = this.waiting.get(channel);
      if (!resolve) return;
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        payload = null;
      }
      const parsed = RpcReplySchema.safeParse(payload);
      if (parsed.success) resolve(parsed.data);
      else this.options.logger.warn({ channel }, 'Respuesta rpc ignorada: formato desconocido');
    });
    this.subscriber = subscriber;
    return subscriber;
  }

  // Devuelve null si nadie respondió a tiempo.
  async call(request: RpcRequest, options: RpcCallOptions = {}): Promise<RpcReply | null> {
    const subscriber = this.ensureSubscriber();
    const channel = replyChannel(request.requestId);
    const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
    const started = Date.now();
    let settle!: (reply: RpcReply | null) => void;
    const answered = new Promise<RpcReply | null>((resolve) => (settle = resolve));
    this.waiting.set(channel, (reply) => settle(reply));
    try {
      await subscriber.subscribe(channel);
      await this.redis.publish(RPC_CHANNEL, JSON.stringify(RpcRequestSchema.parse(request)));

      const early = await within(answered, options.fallbackAfterMs ?? RPC_FALLBACK_MS, undefined);
      if (early !== undefined) return early;
      if (options.fallback && (await claimRequest(this.redis, request.requestId, this.options.owner))) {
        return await options.fallback();
      }
      const reply = await within(answered, Math.max(0, timeoutMs - (Date.now() - started)), null);
      if (!reply) {
        // El ejecutor puede seguir trabajando: una restauración tardía se aplica aunque aquí se responda 503.
        this.options.logger.warn(
          { requestId: request.requestId, projectId: request.projectId, rpc: request.type, timeoutMs },
          'Petición rpc sin respuesta a tiempo',
        );
      }
      return reply;
    } finally {
      this.waiting.delete(channel);
      await subscriber.unsubscribe(channel).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (subscriber) await subscriber.quit().catch(() => subscriber.disconnect());
  }
}
