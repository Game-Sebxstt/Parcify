import type { Point } from './matrix.ts';

export type CapKind = 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond' | 'bar';

// `polyline` y `segment` se trazan con el grosor de la línea; `polygon` y `circle` se rellenan con su color.
export type HeadShape = { type: 'polyline' | 'polygon' | 'circle' | 'segment'; points: Point[]; radius?: number };

// `trim`: cuánto se acorta el trazo desde la punta para que no asome por ella ni la deje despegada.
export type Arrowhead = { trim: number; shape: HeadShape | null };

// Semiapertura de 28°: la punta mide L a lo largo del trazo y L·tan 28° a cada lado.
const SPREAD = Math.tan((28 * Math.PI) / 180);

// Longitud de la punta en unidades del mundo: crece con el tramo, entre un mínimo y un máximo proporcionales al grosor.
export function arrowheadLength(segmentLength: number, strokeWidth: number): number {
  return Math.min(Math.max(segmentLength / 4, 6 + 2 * strokeWidth), 10 + 3 * strokeWidth);
}

// Lo más que una punta sobresale de su recorrido en cualquier dirección, para la caja pintada.
export function arrowheadPadding(strokeWidth: number): number {
  return (10 + 3 * strokeWidth) * SPREAD + strokeWidth / 2;
}

// Punta en `tip`, orientada de `from` hacia `tip`. `segmentLength` es el tramo que da el tamaño (por defecto, el de
// `from` a `tip`).
export function arrowhead(kind: CapKind, tip: Point, from: Point, strokeWidth: number, segmentLength = Math.hypot(tip.x - from.x, tip.y - from.y)): Arrowhead {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy);
  if (kind === 'none' || length < 1e-9) return { trim: 0, shape: null };
  const ux = dx / length;
  const uy = dy / length;
  const L = arrowheadLength(segmentLength, strokeWidth);
  // Punto a `back` por detrás de la punta y desplazado `side` en perpendicular.
  const at = (back: number, side: number): Point => ({ x: tip.x - ux * back - uy * side, y: tip.y - uy * back + ux * side });
  const end = { x: tip.x, y: tip.y };
  switch (kind) {
    case 'arrow':
      return { trim: strokeWidth / 2, shape: { type: 'polyline', points: [at(L, L * SPREAD), end, at(L, -L * SPREAD)] } };
    case 'triangle':
      return { trim: 0.9 * L, shape: { type: 'polygon', points: [end, at(L, L * SPREAD), at(L, -L * SPREAD)] } };
    case 'circle': {
      // El círculo toca la punta por delante; el trazo acaba dentro de él.
      const radius = L / 2.4;
      return { trim: radius * 1.8, shape: { type: 'circle', points: [at(radius, 0)], radius } };
    }
    case 'diamond':
      return { trim: 0.9 * L, shape: { type: 'polygon', points: [end, at(L / 2, 0.3 * L), at(L, 0), at(L / 2, -0.3 * L)] } };
    case 'bar':
      return { trim: 0, shape: { type: 'segment', points: [at(0, 0.45 * L), at(0, -0.45 * L)] } };
  }
}

export type DecoratedLine = {
  startCap: CapKind;
  endCap: CapKind;
  strokeWidth: number;
  route?: 'straight' | 'elbow' | 'curved';
  waypoints?: readonly unknown[] | undefined;
};

// Trazo recortado por las puntas y las puntas de una polilínea plana [x0, y0, x1, y1, …]. Lo comparten el lienzo y
// la exportación para que se vean igual. `path` puede quedar vacío si las puntas se comen un trazo muy corto.
export function decorateLine(line: DecoratedLine, points: readonly number[]): { path: number[]; heads: HeadShape[] } {
  if (points.length < 4) return { path: [...points], heads: [] };
  // Un conector curvo es una curva muestreada: el tamaño sale de la longitud de cada vano y la dirección, de la
  // cuerda hasta donde vuelve el trazo, no del último tramito de la muestra.
  const spans = line.route === 'curved' ? (line.waypoints?.length ?? 0) + 1 : 0;
  const total = spans ? polylineLength(points) : 0;
  const heads: HeadShape[] = [];
  const trims: [number, number] = [0, 0];
  for (const atEnd of [false, true]) {
    const kind = atEnd ? line.endCap : line.startCap;
    if (kind === 'none') continue;
    const tip = vertex(points, atEnd ? points.length / 2 - 1 : 0);
    let head: Arrowhead;
    if (spans) {
      const segment = total / spans;
      const from = pointAlong(points, Math.min(arrowheadLength(segment, line.strokeWidth), total), atEnd);
      head = arrowhead(kind, tip, from, line.strokeWidth, segment);
    } else {
      const from = previousVertex(points, atEnd);
      head = from ? arrowhead(kind, tip, from, line.strokeWidth) : { trim: 0, shape: null };
    }
    if (head.shape) heads.push(head.shape);
    trims[atEnd ? 1 : 0] = head.trim;
  }
  return { path: trimPolyline(points, trims[0], trims[1]), heads };
}

function vertex(points: readonly number[], index: number): Point {
  return { x: points[index * 2]!, y: points[index * 2 + 1]! };
}

// El primer vértice distinto de la punta, recorriendo desde ese extremo.
function previousVertex(points: readonly number[], atEnd: boolean): Point | null {
  const count = points.length / 2;
  const tip = vertex(points, atEnd ? count - 1 : 0);
  for (let k = 1; k < count; k++) {
    const p = vertex(points, atEnd ? count - 1 - k : k);
    if (Math.hypot(p.x - tip.x, p.y - tip.y) > 1e-9) return p;
  }
  return null;
}

export function polylineLength(points: readonly number[]): number {
  let length = 0;
  for (let i = 2; i < points.length; i += 2) length += Math.hypot(points[i]! - points[i - 2]!, points[i + 1]! - points[i - 1]!);
  return length;
}

// Punto a `distance` del extremo, medido a lo largo de la polilínea.
export function pointAlong(points: readonly number[], distance: number, fromEnd: boolean): Point {
  const count = points.length / 2;
  let prev = vertex(points, fromEnd ? count - 1 : 0);
  let left = distance;
  for (let k = 1; k < count; k++) {
    const next = vertex(points, fromEnd ? count - 1 - k : k);
    const length = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (length >= left && length > 0) {
      const t = left / length;
      return { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t };
    }
    left -= length;
    prev = next;
  }
  return prev;
}

// Polilínea sin los primeros `start` ni los últimos `end` de longitud. Vacía si no queda nada.
export function trimPolyline(points: readonly number[], start: number, end: number): number[] {
  if (start <= 0 && end <= 0) return [...points];
  if (start + end >= polylineLength(points) - 1e-9) return [];
  const head = cutStart(points, start);
  return reverse(cutStart(reverse(head), end));
}

function cutStart(points: readonly number[], distance: number): number[] {
  if (distance <= 0) return [...points];
  let left = distance;
  for (let i = 2; i < points.length; i += 2) {
    const ax = points[i - 2]!;
    const ay = points[i - 1]!;
    const bx = points[i]!;
    const by = points[i + 1]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (length > left) {
      const t = left / length;
      return [ax + (bx - ax) * t, ay + (by - ay) * t, ...points.slice(i)];
    }
    left -= length;
  }
  return [];
}

function reverse(points: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = points.length - 2; i >= 0; i -= 2) out.push(points[i]!, points[i + 1]!);
  return out;
}
