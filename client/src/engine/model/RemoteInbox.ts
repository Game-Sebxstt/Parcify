import { realTimers, type Timers } from '../presence/throttle.ts';

// Si el frame no llega (pestaña en segundo plano, motor parado), lo pendiente se aplica igualmente tras este tope.
export const INBOX_MAX_DELAY_MS = 100;

// Mensajes del servidor pendientes de aplicar al documento. Con un motor enganchado, se aplican al principio de su
// frame, en la misma tarea que el trabajo que los pinta; sin motor, en el momento. El orden se conserva.
export class RemoteInbox {
  private queue: Array<() => void> = [];
  private consumer: (() => void) | null = null;
  private timer: ReturnType<Timers['setTimeout']> | null = null;

  constructor(
    private readonly timers: Timers = realTimers,
    private readonly maxDelayMs = INBOX_MAX_DELAY_MS,
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  enqueue(task: () => void): void {
    if (!this.consumer) {
      task();
      return;
    }
    this.queue.push(task);
    if (this.queue.length > 1) return;
    this.consumer();
    this.timer ??= this.timers.setTimeout(() => {
      this.timer = null;
      this.drain();
    }, this.maxDelayMs);
  }

  // Aplica todo lo pendiente; devuelve cuántos mensajes había. Un mensaje que falla no impide aplicar los demás.
  drain(): number {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return 0;
    const tasks = this.queue;
    this.queue = [];
    for (const task of tasks) {
      try {
        task();
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
    return tasks.length;
  }

  // El consumidor pide un frame cuando llega el primer mensaje; al soltarlo, se aplica lo pendiente.
  attach(requestFrame: () => void): () => void {
    this.consumer = requestFrame;
    return () => {
      if (this.consumer !== requestFrame) return;
      this.consumer = null;
      this.drain();
    };
  }

  // Descarta lo pendiente sin aplicarlo (el proveedor que lo recibió ya no existe).
  clear(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
  }
}
