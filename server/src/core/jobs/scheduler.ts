import { randomUUID } from 'node:crypto';
import type { LogSink } from '../logger.js';
import type { Redis } from '../redis.js';

export type JobSchedule = { everyMs: number } | { dailyAtUtc: { hour: number; minute?: number } };

export interface JobDefinition {
  name: string;
  schedule: JobSchedule;
  // Vida del bloqueo; se renueva mientras el trabajo sigue y, al acabar, se deja caducar
  // para que otra instancia con el reloj algo atrasado no repita la misma ejecución.
  lockTtlMs: number;
  run: (signal: AbortSignal) => Promise<unknown>;
}

export type RunResult = 'ran' | 'failed' | 'locked' | 'busy' | 'stopped';

export function cronLockKey(name: string): string {
  return `parcify:cron:${name}`;
}

const DAY_MS = 86_400_000;

// Próximo instante del calendario estrictamente posterior a `now`; los intervalos se alinean con la época Unix.
export function nextRunAt(schedule: JobSchedule, now: number): number {
  if ('everyMs' in schedule) return (Math.floor(now / schedule.everyMs) + 1) * schedule.everyMs;
  const { hour, minute = 0 } = schedule.dailyAtUtc;
  const day = Math.floor(now / DAY_MS) * DAY_MS;
  const today = day + (hour * 60 + minute) * 60_000;
  return today > now ? today : today + DAY_MS;
}

const RENEW_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

export interface SchedulerDeps {
  redis: Redis;
  logger: LogSink;
  // Identifica la instancia en el valor del bloqueo.
  owner: string;
}

// Ejecuta cada trabajo en su hora; el bloqueo `parcify:cron:{nombre}` evita que dos instancias lo hagan a la vez.
export class Scheduler {
  private readonly jobs = new Map<string, JobDefinition>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, Promise<RunResult>>();
  private readonly controller = new AbortController();

  constructor(
    private readonly deps: SchedulerDeps,
    jobs: readonly JobDefinition[],
  ) {
    for (const job of jobs) this.jobs.set(job.name, job);
  }

  get names(): string[] {
    return [...this.jobs.keys()];
  }

  start(): void {
    for (const job of this.jobs.values()) this.schedule(job);
  }

  private schedule(job: JobDefinition) {
    if (this.controller.signal.aborted) return;
    const delay = Math.max(0, nextRunAt(job.schedule, Date.now()) - Date.now());
    const timer = setTimeout(() => {
      void this.runNow(job.name).finally(() => this.schedule(job));
    }, delay);
    timer.unref();
    this.timers.set(job.name, timer);
  }

  runNow(name: string): Promise<RunResult> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Trabajo desconocido: ${name}`);
    if (this.controller.signal.aborted) return Promise.resolve('stopped');
    if (this.running.has(name)) return Promise.resolve('busy');
    const run = this.execute(job).finally(() => this.running.delete(name));
    this.running.set(name, run);
    return run;
  }

  private async execute(job: JobDefinition): Promise<RunResult> {
    const { redis, logger } = this.deps;
    const key = cronLockKey(job.name);
    const token = `${this.deps.owner}:${randomUUID()}`;
    try {
      if ((await redis.set(key, token, 'PX', job.lockTtlMs, 'NX')) !== 'OK') return 'locked';
    } catch (error) {
      logger.error({ err: { message: (error as Error).message }, job: job.name }, 'No se pudo tomar el bloqueo del trabajo');
      return 'failed';
    }
    const renew = setInterval(() => {
      redis
        .eval(RENEW_IF_OWNER, 1, key, token, job.lockTtlMs)
        .catch((error: unknown) =>
          logger.warn({ err: { message: (error as Error).message }, job: job.name }, 'No se pudo renovar el bloqueo del trabajo'),
        );
    }, Math.max(1_000, Math.floor(job.lockTtlMs / 3)));
    renew.unref();
    const started = Date.now();
    try {
      const result = await job.run(this.controller.signal);
      logger.info({ job: job.name, durationMs: Date.now() - started, result }, 'Trabajo periódico terminado');
      return 'ran';
    } catch (error) {
      logger.error({ err: error, job: job.name, durationMs: Date.now() - started }, 'Falló el trabajo periódico');
      return 'failed';
    } finally {
      clearInterval(renew);
    }
  }

  // Cancela los temporizadores y espera a que terminen los trabajos en curso.
  async stop(): Promise<void> {
    this.controller.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.running.values()]);
  }
}
