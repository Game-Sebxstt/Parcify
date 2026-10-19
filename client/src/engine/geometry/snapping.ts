import type { AABB } from '../types.ts';

export type SnapAxis = 'x' | 'y';

export type SnapGuide = { axis: SnapAxis; value: number; from: number; to: number };

export type SnapResult = { dx: number; dy: number; guides: SnapGuide[] };

type Candidate = { value: number; min: number; max: number };

// Valores ordenados (bordes y centro de cada caja) para buscar el más cercano en O(log n).
export class SnapCandidates {
  private readonly xs: Candidate[];
  private readonly ys: Candidate[];

  constructor(boxes: Iterable<AABB>) {
    const xs: Candidate[] = [];
    const ys: Candidate[] = [];
    for (const box of boxes) {
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      for (const value of [box.minX, cx, box.maxX]) xs.push({ value, min: box.minY, max: box.maxY });
      for (const value of [box.minY, cy, box.maxY]) ys.push({ value, min: box.minX, max: box.maxX });
    }
    xs.sort((a, b) => a.value - b.value);
    ys.sort((a, b) => a.value - b.value);
    this.xs = xs;
    this.ys = ys;
  }

  get size(): number {
    return this.xs.length / 3;
  }

  nearest(axis: SnapAxis, value: number): Candidate | null {
    return nearestCandidate(axis === 'x' ? this.xs : this.ys, value);
  }
}

export function nearestCandidate<T extends { value: number }>(sorted: readonly T[], value: number): T | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.value < value) lo = mid + 1;
    else hi = mid;
  }
  const after = sorted[lo]!;
  const before = lo > 0 ? sorted[lo - 1]! : null;
  if (before && Math.abs(before.value - value) <= Math.abs(after.value - value)) return before;
  return after;
}

// Busca, para los tres valores de cada eje de la caja en movimiento, el candidato más cercano dentro del umbral.
export function snapBox(box: AABB, candidates: SnapCandidates, threshold: number): SnapResult {
  const bestX = bestOnAxis(candidates, 'x', [box.minX, (box.minX + box.maxX) / 2, box.maxX], threshold);
  const bestY = bestOnAxis(candidates, 'y', [box.minY, (box.minY + box.maxY) / 2, box.maxY], threshold);
  const dx = bestX?.delta ?? 0;
  const dy = bestY?.delta ?? 0;
  const guides: SnapGuide[] = [];
  if (bestX) {
    const { candidate } = bestX;
    guides.push({ axis: 'x', value: candidate.value, from: Math.min(box.minY + dy, candidate.min), to: Math.max(box.maxY + dy, candidate.max) });
  }
  if (bestY) {
    const { candidate } = bestY;
    guides.push({ axis: 'y', value: candidate.value, from: Math.min(box.minX + dx, candidate.min), to: Math.max(box.maxX + dx, candidate.max) });
  }
  return { dx, dy, guides };
}

function bestOnAxis(candidates: SnapCandidates, axis: SnapAxis, values: number[], threshold: number) {
  let best: { delta: number; candidate: Candidate } | null = null;
  for (const value of values) {
    const candidate = candidates.nearest(axis, value);
    if (!candidate) continue;
    const delta = candidate.value - value;
    if (Math.abs(delta) > threshold) continue;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, candidate };
  }
  return best;
}
