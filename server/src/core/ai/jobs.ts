import { z } from 'zod';
import { AiJobSchema, type AiJob, type AiJobStatus } from '../../shared/api/ai.js';
import { AppError } from '../errors.js';
import { publishProjectEvent } from '../events.js';
import { Semaphore } from '../images/semaphore.js';
import type { LogSink } from '../logger.js';
import type { Redis } from '../redis.js';
import { refundUnits } from './quota.js';

export const AI_JOB_TTL_SECONDS = 3_600;
export const AI_IMAGE_CONCURRENCY = 2;
export const AI_IMAGE_QUEUE_MAX = 20;
// Mientras el proceso tiene el trabajo, renueva su latido; si el proceso cae, el trabajo pasa a failed.
const HEARTBEAT_MS = 30_000;
const ALIVE_SECONDS = 90;

const jobKey = (jobId: string) => `parcify:ai:job:${jobId}`;
const aliveKey = (jobId: string) => `parcify:ai:job:${jobId}:alive`;
const refundedKey = (jobId: string) => `parcify:ai:job:${jobId}:refunded`;

const StoredReservationSchema = z.object({
  keys: z.tuple([z.string().min(1), z.string().min(1)]),
  units: z.number().int().nonnegative(),
});
export type AiJobReservation = z.infer<typeof StoredReservationSchema>;

// Lo que se guarda en Redis: el trabajo, quién lo pidió y la cuota reservada, para devolverla si el proceso cae.
const StoredJobSchema = AiJobSchema.extend({ userId: z.string().min(1), reservation: StoredReservationSchema.optional() });
type StoredJob = z.infer<typeof StoredJobSchema>;

const TERMINAL: ReadonlySet<AiJobStatus> = new Set(['done', 'failed']);

export function toAiJob(job: StoredJob): AiJob {
  const { userId: _userId, reservation: _reservation, ...rest } = job;
  return rest;
}

function lostError(): StoredJob['error'] {
  const lost = new AppError('AI_JOB_LOST');
  return { code: lost.code, message: lost.message };
}

// Un trabajo que nadie atiende se cierra una sola vez: lo marca el primero que lo detecta, devuelve la reserva y
// deja escrito el fallo.
async function settleLostJob(redis: Redis, job: StoredJob): Promise<void> {
  const claimed = await redis.set(refundedKey(job.id), '1', 'EX', AI_JOB_TTL_SECONDS, 'NX');
  if (claimed !== 'OK') return;
  if (job.reservation) await refundUnits({ redis }, job.reservation);
  await redis.set(jobKey(job.id), JSON.stringify(job), 'KEEPTTL');
}

// Estado del trabajo para quien lo creó; null si no existe, caducó o es de otra persona.
export async function readAiJob(redis: Redis, jobId: string, userId: string): Promise<AiJob | null> {
  const [raw, alive] = await Promise.all([redis.get(jobKey(jobId)), redis.exists(aliveKey(jobId))]);
  if (!raw) return null;
  let parsed: StoredJob;
  try {
    const result = StoredJobSchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;
    parsed = result.data;
  } catch {
    return null;
  }
  if (parsed.userId !== userId) return null;
  if (!TERMINAL.has(parsed.status) && !alive) {
    const failed: StoredJob = { ...parsed, status: 'failed', error: lostError(), updatedAt: new Date().toISOString() };
    await settleLostJob(redis, failed);
    return toAiJob(failed);
  }
  return toAiJob(parsed);
}

export interface AiJobDeps {
  redis: Redis;
  logger: LogSink;
}

export type AiJobWork = () => Promise<string[]>;

// Trabajos de generación en este proceso: como mucho `concurrency` a la vez y `queue` esperando; por encima,
// AI_BUSY. El estado vive en Redis con TTL de una hora y cada cambio se publica como ai.job.
export class AiJobs {
  private readonly semaphore: Semaphore;
  private load = 0;
  private readonly live = new Set<string>();
  // Trabajos que aún esperan hueco, con lo que devuelve su reserva si el proceso se cierra antes.
  private readonly waiting = new Map<string, { job: StoredJob; cancel: () => Promise<void> }>();
  private readonly running = new Set<Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly deps: AiJobDeps,
    private readonly limits: { concurrency: number; queue: number } = { concurrency: AI_IMAGE_CONCURRENCY, queue: AI_IMAGE_QUEUE_MAX },
  ) {
    this.semaphore = new Semaphore(limits.concurrency);
  }

  // Generaciones en curso y en espera (métricas).
  get slots(): { readonly running: number; readonly pending: number } {
    return this.semaphore;
  }

  // Aparta un hueco antes de reservar cuota: así un 503 nunca cobra. Devuelve con qué soltarlo.
  admit(): () => void {
    if (this.closed || this.load >= this.limits.concurrency + this.limits.queue) throw new AppError('AI_BUSY');
    this.load++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.load--;
    };
  }

  // Crea el trabajo en cola y lo lanza en segundo plano; `work` devuelve los assets guardados o lanza un AppError.
  // `cancel` devuelve la reserva si el trabajo no llega a empezar.
  async start(
    input: { jobId: string; userId: string; projectId: string; count: number; reservation: AiJobReservation },
    release: () => void,
    work: AiJobWork,
    cancel: () => Promise<void>,
  ): Promise<void> {
    const now = new Date().toISOString();
    const job: StoredJob = {
      id: input.jobId,
      userId: input.userId,
      projectId: input.projectId,
      status: 'queued',
      count: input.count,
      assetIds: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      reservation: { keys: [...input.reservation.keys], units: input.reservation.units },
    };
    try {
      await this.save(job);
      await this.deps.redis.set(aliveKey(job.id), '1', 'EX', ALIVE_SECONDS);
    } catch (error) {
      release();
      throw error;
    }
    this.live.add(job.id);
    this.waiting.set(job.id, { job, cancel });
    this.ensureHeartbeat();
    await this.publish(job);
    const task = this.semaphore
      .run(async () => {
        // Si close() ya lo cerró, no queda nada por hacer.
        if (!this.waiting.delete(job.id)) return;
        await this.update(job, { status: 'running' });
        try {
          const assetIds = await work();
          await this.update(job, { status: 'done', assetIds });
        } catch (error) {
          const failure = error instanceof AppError ? error : new AppError('INTERNAL', { cause: error });
          await this.update(job, { status: 'failed', error: { code: failure.code, message: failure.message } });
        }
      })
      .catch((error: unknown) => {
        this.deps.logger.error({ err: { message: (error as Error).message }, jobId: job.id }, 'Falló un trabajo de IA');
      })
      .finally(() => {
        release();
        this.live.delete(job.id);
        void this.deps.redis.del(aliveKey(job.id)).catch(() => undefined);
        this.running.delete(task);
        if (!this.live.size) this.stopHeartbeat();
      });
    this.running.add(task);
  }

  // Espera a que terminen los trabajos de este proceso (pruebas).
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  // Deja de aceptar trabajos y da por fallidos los que siguen en cola, devolviendo su reserva.
  async close(): Promise<void> {
    this.closed = true;
    this.stopHeartbeat();
    const pending = [...this.waiting.values()];
    this.waiting.clear();
    for (const { job, cancel } of pending) {
      try {
        const claimed = await this.deps.redis.set(refundedKey(job.id), '1', 'EX', AI_JOB_TTL_SECONDS, 'NX');
        if (claimed === 'OK') await cancel();
      } catch (error) {
        this.deps.logger.error({ err: { message: (error as Error).message }, jobId: job.id }, 'No se pudo devolver la reserva del trabajo de IA');
      }
      await this.update(job, { status: 'failed', error: lostError() });
    }
  }

  private async update(job: StoredJob, patch: Partial<Pick<StoredJob, 'status' | 'assetIds' | 'error'>>): Promise<void> {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    try {
      await this.save(job);
    } catch (error) {
      this.deps.logger.error({ err: { message: (error as Error).message }, jobId: job.id }, 'No se pudo guardar el estado del trabajo de IA');
    }
    await this.publish(job);
  }

  private async save(job: StoredJob): Promise<void> {
    await this.deps.redis.set(jobKey(job.id), JSON.stringify(job), 'EX', AI_JOB_TTL_SECONDS);
  }

  private async publish(job: StoredJob): Promise<void> {
    try {
      await publishProjectEvent(this.deps.redis, job.projectId, { type: 'ai.job', userId: job.userId, jobId: job.id, status: job.status });
    } catch (error) {
      this.deps.logger.error({ err: { message: (error as Error).message }, jobId: job.id }, 'No se pudo publicar ai.job');
    }
  }

  private ensureHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const ids = [...this.live];
      if (!ids.length) return;
      const pipeline = this.deps.redis.pipeline();
      for (const id of ids) pipeline.set(aliveKey(id), '1', 'EX', ALIVE_SECONDS);
      void pipeline.exec().catch(() => undefined);
    }, HEARTBEAT_MS);
    this.timer.unref();
  }

  private stopHeartbeat(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
