import type { Redis } from '../core/redis.js';

// Registro en Redis de quién tiene cargado (o está a punto de cargar) cada documento.
// El compactador toma `parcify:compact:{id}` y después lee el conjunto; `fetch` y `onAuthenticate`
// se registran y después miran el bloqueo. Redis serializa los comandos, así que nunca pasan los dos.

export const INSTANCE_TTL_MS = 90_000;
export const PENDING_TTL_MS = 15_000;
export const HEARTBEAT_MS = 30_000;
export const COMPACT_LOCK_TTL_MS = 60_000;
export const COMPACT_POLL_MS = 250;
export const COMPACT_WAIT_MS = 5_000;

export function instancesKey(projectId: string): string {
  return `parcify:doc:${projectId}:instances`;
}

export function memberKey(projectId: string, member: string): string {
  return `parcify:doc:${projectId}:inst:${member}`;
}

export function compactLockKey(projectId: string): string {
  return `parcify:compact:${projectId}`;
}

export function pendingMember(socketId: string): string {
  return `pending:${socketId}`;
}

async function register(redis: Redis, projectId: string, member: string, ttlMs: number): Promise<void> {
  const key = instancesKey(projectId);
  await redis
    .multi()
    .sadd(key, member)
    .set(memberKey(projectId, member), '1', 'PX', ttlMs)
    .pexpire(key, INSTANCE_TTL_MS)
    .exec();
}

export function registerInstance(redis: Redis, projectId: string, instanceId: string): Promise<void> {
  return register(redis, projectId, instanceId, INSTANCE_TTL_MS);
}

export function registerPending(redis: Redis, projectId: string, socketId: string): Promise<void> {
  return register(redis, projectId, pendingMember(socketId), PENDING_TTL_MS);
}

export async function unregister(redis: Redis, projectId: string, member: string): Promise<void> {
  await redis.multi().srem(instancesKey(projectId), member).del(memberKey(projectId, member)).exec();
}

export async function heartbeat(redis: Redis, projectId: string, instanceId: string): Promise<void> {
  const key = instancesKey(projectId);
  await redis
    .multi()
    .sadd(key, instanceId)
    .set(memberKey(projectId, instanceId), '1', 'PX', INSTANCE_TTL_MS)
    .pexpire(key, INSTANCE_TTL_MS)
    .exec();
}

// Miembros con su clave propia viva; los caducados se eliminan del conjunto.
export async function liveMembers(redis: Redis, projectId: string): Promise<string[]> {
  const key = instancesKey(projectId);
  const members = await redis.smembers(key);
  if (members.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const member of members) pipeline.exists(memberKey(projectId, member));
  const flags = ((await pipeline.exec()) ?? []).map(([error, value]) => (error ? 0 : Number(value)));
  const stale = members.filter((_member, index) => flags[index] === 0);
  if (stale.length > 0) await redis.srem(key, ...stale);
  return members.filter((_member, index) => flags[index] === 1);
}

export async function acquireCompactLock(redis: Redis, projectId: string, owner: string): Promise<boolean> {
  return (await redis.set(compactLockKey(projectId), owner, 'PX', COMPACT_LOCK_TTL_MS, 'NX')) === 'OK';
}

const RELEASE_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export async function releaseCompactLock(redis: Redis, projectId: string, owner: string): Promise<boolean> {
  return (await redis.eval(RELEASE_IF_OWNER, 1, compactLockKey(projectId), owner)) === 1;
}

const RENEW_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

// Devuelve false si el bloqueo ya no es de `owner`.
export async function renewCompactLock(redis: Redis, projectId: string, owner: string): Promise<boolean> {
  return (await redis.eval(RENEW_IF_OWNER, 1, compactLockKey(projectId), owner, COMPACT_LOCK_TTL_MS)) === 1;
}

// Espera a que no haya compactación en curso. Devuelve false si el bloqueo sigue al acabar el plazo.
export async function waitForCompaction(
  redis: Redis,
  projectId: string,
  options: { pollMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const pollMs = options.pollMs ?? COMPACT_POLL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? COMPACT_WAIT_MS);
  for (;;) {
    if ((await redis.exists(compactLockKey(projectId))) === 0) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
