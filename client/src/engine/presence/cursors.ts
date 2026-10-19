export const CURSOR_SMOOTHING_MS = 120;

type Track = { fromX: number; fromY: number; toX: number; toY: number; start: number };

// Suaviza los cursores remotos: cada posición nueva se alcanza en 120 ms desde donde estaba el cursor.
export class CursorInterpolator {
  private readonly tracks = new Map<string, Track>();

  set(key: string, x: number, y: number, now: number): void {
    const track = this.tracks.get(key);
    if (!track) {
      this.tracks.set(key, { fromX: x, fromY: y, toX: x, toY: y, start: now - CURSOR_SMOOTHING_MS });
      return;
    }
    if (track.toX === x && track.toY === y) return;
    const current = this.position(track, now);
    this.tracks.set(key, { fromX: current.x, fromY: current.y, toX: x, toY: y, start: now });
  }

  delete(key: string): void {
    this.tracks.delete(key);
  }

  keys(): IterableIterator<string> {
    return this.tracks.keys();
  }

  sample(key: string, now: number): { x: number; y: number } | null {
    const track = this.tracks.get(key);
    return track ? this.position(track, now) : null;
  }

  animating(now: number): boolean {
    for (const track of this.tracks.values()) if (now - track.start < CURSOR_SMOOTHING_MS) return true;
    return false;
  }

  private position(track: Track, now: number): { x: number; y: number } {
    const t = Math.max(0, Math.min(1, (now - track.start) / CURSOR_SMOOTHING_MS));
    const eased = 1 - (1 - t) * (1 - t);
    return { x: track.fromX + (track.toX - track.fromX) * eased, y: track.fromY + (track.toY - track.fromY) * eased };
  }
}
