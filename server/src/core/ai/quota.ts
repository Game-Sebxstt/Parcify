import type { Db } from '../db.js';
import { AppError } from '../errors.js';
import type { Redis } from '../redis.js';

export type AiUsageFeature = 'assistant' | 'image' | 'animation' | 'chat';

// Imagen: por cada imagen generada.
export const AI_UNITS: Record<AiUsageFeature, number> = { assistant: 1, animation: 1, chat: 1, image: 4 };

export const DEFAULT_WORKSPACE_MONTHLY_UNITS = 2_000;
export const DEFAULT_USER_DAILY_UNITS = 100;

const KEY_GRACE_SECONDS = 86_400;
const MAX_REBUILDS = 3;

export interface QuotaDefaults {
  workspaceMonthlyUnits: number;
  userDailyUnits: number;
}

export interface QuotaDeps {
  db: Db;
  redis: Redis;
  defaults: QuotaDefaults;
}

export interface QuotaLimits {
  workspaceMonthlyUnits: number;
  userDailyUnits: number;
}

export interface Reservation {
  organizationId: string;
  userId: string;
  units: number;
  keys: [workspace: string, user: string];
}

export type QuotaScope = 'workspace' | 'user';

export interface QuotaWindow {
  workspaceKey: string;
  userKey: string;
  monthStart: Date;
  monthEnd: Date;
  dayStart: Date;
  dayEnd: Date;
}

export function quotaWindow(organizationId: string, userId: string, at: Date = new Date()): QuotaWindow {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const day = at.getUTCDate();
  const iso = at.toISOString();
  return {
    workspaceKey: `parcify:aiq:ws:${organizationId}:${iso.slice(0, 4)}${iso.slice(5, 7)}`,
    userKey: `parcify:aiq:u:${userId}:${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`,
    monthStart: new Date(Date.UTC(year, month, 1)),
    monthEnd: new Date(Date.UTC(year, month + 1, 1)),
    dayStart: new Date(Date.UTC(year, month, day)),
    dayEnd: new Date(Date.UTC(year, month, day + 1)),
  };
}

export async function quotaLimits(deps: Pick<QuotaDeps, 'db' | 'defaults'>, organizationId: string): Promise<QuotaLimits> {
  const override = await deps.db.workspaceAiQuota.findUnique({
    where: { organizationId },
    select: { monthlyUnits: true, perUserDailyUnits: true },
  });
  return {
    workspaceMonthlyUnits: override?.monthlyUnits ?? deps.defaults.workspaceMonthlyUnits,
    userDailyUnits: override?.perUserDailyUnits ?? deps.defaults.userDailyUnits,
  };
}

// Devuelve 0 si reserva, 1 o 2 si no cabe (espacio o usuario) y -1, -2 o -3 si faltan contadores por reconstruir.
const RESERVE = `
local units = tonumber(ARGV[1])
local limits = { tonumber(ARGV[2]), tonumber(ARGV[3]) }
local seeds = { tonumber(ARGV[4]), tonumber(ARGV[5]) }
local expires = { ARGV[6], ARGV[7] }
local missing = 0
for i = 1, 2 do
  if redis.call('EXISTS', KEYS[i]) == 0 then
    if seeds[i] < 0 then
      missing = missing + i
    else
      redis.call('SET', KEYS[i], seeds[i], 'EXAT', expires[i])
    end
  end
end
if missing > 0 then return -missing end
for i = 1, 2 do
  if tonumber(redis.call('GET', KEYS[i])) + units > limits[i] then return i end
end
for i = 1, 2 do redis.call('INCRBY', KEYS[i], units) end
return 0
`;

// No recrea claves que ya no existen: si Redis se vació, la reconstrucción desde AiUsage ya es exacta.
const REFUND = `
for i = 1, 2 do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    if redis.call('DECRBY', KEYS[i], ARGV[1]) < 0 then redis.call('SET', KEYS[i], 0, 'KEEPTTL') end
  end
end
return 0
`;

async function usedUnits(db: Db, where: { organizationId?: string; userId?: string; from: Date; to: Date }) {
  const result = await db.aiUsage.aggregate({
    where: {
      ...(where.organizationId ? { organizationId: where.organizationId } : {}),
      ...(where.userId ? { userId: where.userId } : {}),
      createdAt: { gte: where.from, lt: where.to },
    },
    _sum: { units: true },
  });
  return result._sum.units ?? 0;
}

export class QuotaExceededError extends AppError {
  constructor(
    readonly scope: QuotaScope,
    readonly resetsAt: Date,
  ) {
    super('AI_QUOTA_EXCEEDED', { details: { scope, resetsAt: resetsAt.toISOString() } });
  }
}

export async function reserveUnits(
  deps: QuotaDeps,
  input: { organizationId: string; userId: string; units: number; at?: Date },
): Promise<Reservation> {
  const window = quotaWindow(input.organizationId, input.userId, input.at);
  const limits = await quotaLimits(deps, input.organizationId);
  const keys: Reservation['keys'] = [window.workspaceKey, window.userKey];
  const expires = [window.monthEnd, window.dayEnd].map((end) => String(Math.floor(end.getTime() / 1000) + KEY_GRACE_SECONDS));
  const seeds = ['-1', '-1'];

  for (let attempt = 0; attempt <= MAX_REBUILDS; attempt++) {
    const result = Number(
      await deps.redis.eval(
        RESERVE,
        2,
        ...keys,
        input.units,
        limits.workspaceMonthlyUnits,
        limits.userDailyUnits,
        ...seeds,
        ...expires,
      ),
    );
    if (result === 0) return { organizationId: input.organizationId, userId: input.userId, units: input.units, keys };
    if (result === 1) throw new QuotaExceededError('workspace', window.monthEnd);
    if (result === 2) throw new QuotaExceededError('user', window.dayEnd);
    const missing = -result;
    if (missing & 1) {
      seeds[0] = String(
        await usedUnits(deps.db, { organizationId: input.organizationId, from: window.monthStart, to: window.monthEnd }),
      );
    }
    if (missing & 2) {
      seeds[1] = String(await usedUnits(deps.db, { userId: input.userId, from: window.dayStart, to: window.dayEnd }));
    }
  }
  throw new Error('No se pudieron reconstruir los contadores de cuota de IA');
}

export async function refundUnits(
  deps: Pick<QuotaDeps, 'redis'>,
  reservation: Pick<Reservation, 'keys' | 'units'>,
  units = reservation.units,
) {
  if (units <= 0) return;
  await deps.redis.eval(REFUND, 2, ...reservation.keys, Math.min(units, reservation.units));
}
