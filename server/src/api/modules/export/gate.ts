import { AppError } from '../../../core/errors.js';

export const IMPORT_CONCURRENCY = { perInstance: 2, perUser: 1, retryAfterSeconds: 30 } as const;

// Cada importación retiene el archivo entero en memoria: aquí se limita cuántas corren a la vez.
// Si no hay hueco se rechaza antes de recibir el cuerpo, sin cola.
export class ImportGate {
  private readonly users = new Map<string, number>();
  private active = 0;

  constructor(private readonly limits: { perInstance: number; perUser: number; retryAfterSeconds: number } = IMPORT_CONCURRENCY) {}

  get running(): number {
    return this.active;
  }

  admit(userId: string): () => void {
    const current = this.users.get(userId) ?? 0;
    if (this.active >= this.limits.perInstance || current >= this.limits.perUser) {
      throw new AppError('SERVICE_UNAVAILABLE', {
        details: { reason: 'import_busy', retryAfterSeconds: this.limits.retryAfterSeconds },
        headers: { 'retry-after': String(this.limits.retryAfterSeconds) },
      });
    }
    this.active++;
    this.users.set(userId, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const left = (this.users.get(userId) ?? 1) - 1;
      if (left > 0) this.users.set(userId, left);
      else this.users.delete(userId);
    };
  }
}
