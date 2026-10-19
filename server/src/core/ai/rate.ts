import { AppError } from '../errors.js';
import type { Redis } from '../redis.js';

// Común a todas las rutas de IA, además de la cuota.
export const AI_RATE_LIMIT = 10;
export const AI_RATE_WINDOW_MS = 60_000;

const TAKE = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { current, redis.call('PTTL', KEYS[1]) }
`;

export function aiRateKey(userId: string): string {
  return `parcify:rl:ai:u:${userId}`;
}

export async function takeAiSlot(redis: Redis, userId: string): Promise<void> {
  const [current, ttl] = (await redis.eval(TAKE, 1, aiRateKey(userId), AI_RATE_WINDOW_MS)) as [number, number];
  if (current <= AI_RATE_LIMIT) return;
  const retryAfterSeconds = Math.max(1, Math.ceil((ttl > 0 ? ttl : AI_RATE_WINDOW_MS) / 1000));
  throw new AppError('RATE_LIMITED', {
    details: { retryAfterSeconds },
    headers: { 'retry-after': String(retryAfterSeconds) },
  });
}
