// Limita cuántas tareas corren a la vez; el resto espera en orden de llegada.
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error('El semáforo necesita al menos un hueco');
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.active;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.max) this.active++;
    // El hueco se cede directamente al siguiente de la cola, sin pasar por el contador.
    else await new Promise<void>((resolve) => this.queue.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
