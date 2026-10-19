import { describe, expect, it } from 'vitest';
import { Semaphore } from './semaphore.js';

describe('Semaphore', () => {
  it('nunca deja correr más tareas que huecos y respeta el orden', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const tasks = Array.from({ length: 6 }, (_, i) =>
      semaphore.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(i);
        running--;
        return i;
      }),
    );
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect(order.slice(0, 2).sort()).toEqual([0, 1]);
    expect(semaphore.running).toBe(0);
    expect(semaphore.pending).toBe(0);
  });

  it('libera el hueco aunque la tarea falle', async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(async () => Promise.reject(new Error('fallo')))).rejects.toThrow('fallo');
    expect(await semaphore.run(async () => 'ok')).toBe('ok');
  });
});
