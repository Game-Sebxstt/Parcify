import { AppError } from './errors.js';
import type { Redis } from './redis.js';

export const RATE_KEY_PREFIX = 'parcify:rl:';

export interface RateRule {
  key: string;
  max: number;
  windowMs: number;
}

// Ventana fija por clave; todas las reglas cuentan la petición aunque otra ya la rechace.
const TAKE_ALL = `
local over = 0
local retry = 0
for i, key in ipairs(KEYS) do
  local current = redis.call('INCR', key)
  local window = tonumber(ARGV[i * 2 - 1])
  if current == 1 then redis.call('PEXPIRE', key, window) end
  if current > tonumber(ARGV[i * 2]) then
    over = 1
    local ttl = redis.call('PTTL', key)
    if ttl < 0 then ttl = window end
    if ttl > retry then retry = ttl end
  end
end
return { over, retry }
`;

export async function takeRateSlots(redis: Redis, rules: RateRule[]): Promise<void> {
  if (rules.length === 0) return;
  const keys = rules.map((rule) => RATE_KEY_PREFIX + rule.key);
  const args = rules.flatMap((rule) => [rule.windowMs, rule.max]);
  const [over, retryMs] = (await redis.eval(TAKE_ALL, keys.length, ...keys, ...args)) as [number, number];
  if (over !== 1) return;
  const retryAfterSeconds = Math.max(1, Math.ceil(retryMs / 1000));
  throw new AppError('RATE_LIMITED', {
    details: { retryAfterSeconds },
    headers: { 'retry-after': String(retryAfterSeconds) },
  });
}
