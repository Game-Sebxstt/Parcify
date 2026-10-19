export type Timers = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const realTimers: Timers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type Throttle = { schedule(): void; flush(): void; cancel(): void };

// Como mucho una llamada por intervalo; las peticiones intermedias se funden en una llamada final.
export function createThrottle(run: () => void, intervalMs: number, timers: Timers = realTimers): Throttle {
  let last = -Infinity;
  let timer: unknown = null;
  let pending = false;

  const fire = () => {
    timer = null;
    pending = false;
    last = timers.now();
    run();
  };

  return {
    schedule() {
      pending = true;
      if (timer !== null) return;
      const wait = last + intervalMs - timers.now();
      if (wait <= 0) fire();
      else timer = timers.setTimeout(fire, wait);
    },
    flush() {
      if (!pending) return;
      if (timer !== null) timers.clearTimeout(timer);
      fire();
    },
    cancel() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
