import type { LandingDemo } from './live.ts';

// Estado compartido entre la isla del lienzo y la de sus controles (islas distintas, mismo módulo).
export const landing = $state<{ ready: boolean; many: boolean; paused: boolean; frameMs: number | null }>({
  ready: false,
  many: false,
  paused: false,
  frameMs: null,
});

let demo: LandingDemo | null = null;
let onPausedChange: (() => void) | null = null;

export function attachDemo(next: LandingDemo | null, pausedChange: (() => void) | null = null) {
  demo = next;
  onPausedChange = pausedChange;
  landing.ready = next !== null;
}

export function toggleMany() {
  if (demo) landing.many = demo.toggleMany();
}

export function togglePaused() {
  landing.paused = !landing.paused;
  onPausedChange?.();
}
