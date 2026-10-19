type Raf = (callback: (time: number) => void) => number;
type Caf = (handle: number) => void;

export type FrameTiming = { work: number; render: number; time: number };

// Un único requestAnimationFrame pendiente. Sin nada que hacer no hay frame ni render.
export class FrameScheduler {
  private handle: number | null = null;
  private readonly keepers = new Set<string>();
  private destroyed = false;
  frames = 0;

  constructor(
    private readonly run: (time: number) => void,
    private readonly raf: Raf = (cb) => requestAnimationFrame(cb),
    private readonly caf: Caf = (h) => cancelAnimationFrame(h),
  ) {}

  requestFrame(): void {
    if (this.handle !== null || this.destroyed) return;
    this.handle = this.raf(this.tick);
  }

  // Mantiene frames continuos mientras algo esté animando (interpolación de cursores, gestos).
  keepAlive(key: string, active: boolean): void {
    if (active) {
      this.keepers.add(key);
      this.requestFrame();
    } else {
      this.keepers.delete(key);
    }
  }

  get pending(): boolean {
    return this.handle !== null;
  }

  private readonly tick = (time: number) => {
    this.handle = null;
    this.frames++;
    this.run(time);
    if (this.keepers.size > 0) this.requestFrame();
  };

  destroy(): void {
    this.destroyed = true;
    if (this.handle !== null) this.caf(this.handle);
    this.handle = null;
  }
}
