import { AISDKError, APICallError } from 'ai';
import { incrementDaily } from '../activity.js';
import type { AiFeature } from '../config.js';
import type { Db } from '../db.js';
import type { AppError } from '../errors.js';
import type { LogSink } from '../logger.js';
import type { Redis } from '../redis.js';
import { captureError } from '../sentry.js';
import { AI_IMAGE_TIMEOUT_MS, AI_TEXT_TIMEOUT_MS, translateAiError } from './errors.js';
import {
  QuotaExceededError,
  refundUnits,
  reserveUnits,
  type AiUsageFeature,
  type QuotaDefaults,
  type Reservation,
} from './quota.js';
import type { AiModels } from './registry.js';

export type AiUsageStatus = 'ok' | 'error' | 'rejected';

export interface AiDeps {
  db: Db;
  redis: Redis;
  logger: LogSink;
  models: AiModels;
  defaults: QuotaDefaults;
  // Cada AiUsage que se intenta registrar, aunque falle la escritura (métricas).
  onUsage?: (feature: AiUsageFeature, status: AiUsageStatus) => void;
}

export interface AiCallResult<T> {
  value: T;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  images?: number;
  // Unidades reales si son menos que las reservadas (imágenes que no se guardaron).
  units?: number;
}

export interface AiRunInput<T> {
  feature: AiUsageFeature;
  // Modelo que se registra en AiUsage; por defecto el de `feature`.
  modelFeature?: AiFeature;
  organizationId: string;
  projectId: string | null;
  userId: string;
  units: number;
  promptLength: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  call: (signal: AbortSignal) => Promise<AiCallResult<T>>;
}

interface UsageRow {
  organizationId: string;
  projectId: string | null;
  userId: string;
  feature: AiUsageFeature;
  model: string;
  units: number;
  status: AiUsageStatus;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  images?: number | undefined;
}

function statusOf(error: AppError): AiUsageStatus {
  return error.code === 'AI_QUOTA_EXCEEDED' || error.code === 'AI_REFUSED' ? 'rejected' : 'error';
}

// Causa sin cuerpos de petición ni de respuesta (llevan el prompt y la salida del modelo).
function causeOf(error: AppError): Record<string, unknown> | undefined {
  const cause = error.cause;
  if (!(cause instanceof Error)) return cause === undefined ? undefined : { message: String(cause) };
  const out: Record<string, unknown> = { name: cause.name, message: cause.message, stack: cause.stack };
  if (APICallError.isInstance(cause)) out.statusCode = cause.statusCode;
  return out;
}

function logFailure(deps: AiDeps, input: AiActionInput, model: string, translated: AppError): void {
  deps.logger.warn(
    { feature: input.feature, model, promptLength: input.promptLength, code: translated.code, err: causeOf(translated) },
    'La llamada de IA falló',
  );
  // AI_PROVIDER_ERROR es el comodín: si la causa no viene del SDK de IA, es un fallo nuestro.
  if (translated.code === 'AI_PROVIDER_ERROR' && !AISDKError.isInstance(translated.cause)) {
    captureError(translated.cause ?? translated, { feature: input.feature });
  }
}

async function recordUsage(deps: AiDeps, row: UsageRow): Promise<void> {
  deps.onUsage?.(row.feature, row.status);
  const data = {
    organizationId: row.organizationId,
    projectId: row.projectId,
    userId: row.userId,
    feature: row.feature,
    model: row.model.slice(0, 120),
    units: row.units,
    status: row.status,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    images: row.images ?? 0,
  };
  try {
    if (row.status === 'ok' && row.projectId) {
      const projectId = row.projectId;
      await deps.db.$transaction(async (tx) => {
        await tx.aiUsage.create({ data });
        await incrementDaily(tx, { projectId, userId: row.userId, counter: 'aiActions' });
      });
    } else {
      await deps.db.aiUsage.create({ data });
    }
  } catch (error) {
    deps.logger.error(
      { err: { message: (error as Error).message }, feature: row.feature, status: row.status },
      'No se pudo registrar el uso de IA',
    );
  }
}

async function refundSafely(deps: AiDeps, reservation: Reservation, units: number) {
  try {
    await refundUnits(deps, reservation, units);
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message } }, 'No se pudieron devolver unidades de IA');
  }
}

export type AiActionInput = Omit<AiRunInput<unknown>, 'call'>;

// Acción en curso para las llamadas que no caben en runAiAction (streaming): la cuota ya está reservada y cada
// salida (éxito, fallo o corte del usuario sin nada generado) se registra una sola vez.
export interface AiActionHandle {
  readonly signal: AbortSignal;
  readonly reservation: Reservation;
  // units: lo que se cobra si es menos que lo reservado (imágenes que no se guardaron); el resto se devuelve.
  succeed(result: { inputTokens?: number | undefined; outputTokens?: number | undefined; units?: number; images?: number }): Promise<void>;
  fail(error: unknown, timedOut?: boolean): Promise<AppError>;
  cancel(): Promise<void>;
}

export async function beginAiAction(deps: AiDeps, input: AiActionInput): Promise<AiActionHandle> {
  const model = deps.models.modelId(input.modelFeature ?? input.feature) ?? 'none';
  const base = {
    organizationId: input.organizationId,
    projectId: input.projectId,
    userId: input.userId,
    feature: input.feature,
    model,
  };
  let reservation: Reservation;
  try {
    reservation = await reserveUnits(deps, { organizationId: input.organizationId, userId: input.userId, units: input.units });
  } catch (error) {
    if (error instanceof QuotaExceededError) await recordUsage(deps, { ...base, units: 0, status: 'rejected' });
    throw error;
  }
  const timeout = AbortSignal.timeout(input.timeoutMs ?? AI_TEXT_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
  let settled = false;
  const once = () => {
    if (settled) return false;
    settled = true;
    return true;
  };
  return {
    signal,
    reservation,
    async succeed(result) {
      if (!once()) return;
      const charged = Math.max(0, Math.min(result.units ?? reservation.units, reservation.units));
      if (charged < reservation.units) await refundSafely(deps, reservation, reservation.units - charged);
      await recordUsage(deps, {
        ...base,
        units: charged,
        status: 'ok',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        images: result.images,
      });
    },
    async fail(error, timedOut) {
      const translated = translateAiError(error, timedOut ?? timeout.aborted);
      if (!once()) return translated;
      await refundSafely(deps, reservation, reservation.units);
      logFailure(deps, input, model, translated);
      await recordUsage(deps, { ...base, units: 0, status: statusOf(translated) });
      return translated;
    },
    async cancel() {
      if (!once()) return;
      await refundSafely(deps, reservation, reservation.units);
      await recordUsage(deps, { ...base, units: 0, status: 'error' });
    },
  };
}

// Reserva la cuota, llama al modelo con tope de tiempo, devuelve las unidades si falla y deja siempre un AiUsage.
export async function runAiAction<T>(deps: AiDeps, input: AiRunInput<T>): Promise<T> {
  const model = deps.models.modelId(input.modelFeature ?? input.feature) ?? 'none';
  const base = {
    organizationId: input.organizationId,
    projectId: input.projectId,
    userId: input.userId,
    feature: input.feature,
    model,
  };

  let reservation: Reservation;
  try {
    reservation = await reserveUnits(deps, {
      organizationId: input.organizationId,
      userId: input.userId,
      units: input.units,
    });
  } catch (error) {
    if (error instanceof QuotaExceededError) await recordUsage(deps, { ...base, units: 0, status: 'rejected' });
    throw error;
  }

  const timeout = AbortSignal.timeout(
    input.timeoutMs ?? (input.feature === 'image' ? AI_IMAGE_TIMEOUT_MS : AI_TEXT_TIMEOUT_MS),
  );
  const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;

  let result: AiCallResult<T>;
  try {
    result = await input.call(signal);
  } catch (error) {
    await refundSafely(deps, reservation, reservation.units);
    const translated = translateAiError(error, timeout.aborted);
    logFailure(deps, input, model, translated);
    await recordUsage(deps, { ...base, units: 0, status: statusOf(translated) });
    throw translated;
  }

  const charged = Math.max(0, Math.min(result.units ?? reservation.units, reservation.units));
  if (charged < reservation.units) await refundSafely(deps, reservation, reservation.units - charged);
  await recordUsage(deps, {
    ...base,
    units: charged,
    status: 'ok',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    images: result.images,
  });
  return result.value;
}
