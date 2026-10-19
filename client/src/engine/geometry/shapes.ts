import type { RenderableRecord, ShapeRecord } from '../types.ts';

const TAU = Math.PI * 2;

// Segmentos para aproximar curvas: suficientes para que el contorno no se note a tamaño real.
export function curveSegments(rx: number, ry: number): number {
  const perimeter = Math.PI * (Math.abs(rx) + Math.abs(ry));
  return Math.max(16, Math.min(128, Math.ceil(perimeter / 6)));
}

export function regularPolygon(w: number, h: number, sides: number): number[] {
  const points: number[] = [];
  const rx = w / 2;
  const ry = h / 2;
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (i * TAU) / sides;
    points.push(rx + rx * Math.cos(angle), ry + ry * Math.sin(angle));
  }
  return points;
}

export function starPolygon(w: number, h: number, count: number, innerRatio: number): number[] {
  const points: number[] = [];
  const rx = w / 2;
  const ry = h / 2;
  for (let i = 0; i < count * 2; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / count;
    const ratio = i % 2 === 0 ? 1 : innerRatio;
    points.push(rx + rx * ratio * Math.cos(angle), ry + ry * ratio * Math.sin(angle));
  }
  return points;
}

export function ellipsePolygon(w: number, h: number, segments = curveSegments(w / 2, h / 2)): number[] {
  const points: number[] = [];
  const rx = w / 2;
  const ry = h / 2;
  for (let i = 0; i < segments; i++) {
    const angle = (i * TAU) / segments;
    points.push(rx + rx * Math.cos(angle), ry + ry * Math.sin(angle));
  }
  return points;
}

export function roundRectPolygon(w: number, h: number, radius: number): number[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return [0, 0, w, 0, w, h, 0, h];
  const steps = Math.max(4, Math.min(16, Math.ceil(r / 3)));
  const points: number[] = [];
  const corners: Array<[number, number, number]> = [
    [w - r, r, -Math.PI / 2],
    [w - r, h - r, 0],
    [r, h - r, Math.PI / 2],
    [r, r, Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= steps; i++) {
      const angle = start + (i * Math.PI) / 2 / steps;
      points.push(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    }
  }
  return points;
}

export function arcSweep(startAngle: number, endAngle: number): number {
  const sweep = endAngle - startAngle;
  if (Math.abs(sweep) >= TAU) return TAU;
  return ((sweep % TAU) + TAU) % TAU || TAU;
}

// Contorno cerrado de un sector o una corona parcial; con la vuelta completa devuelve solo el exterior.
export function arcPolygon(w: number, h: number, startAngle: number, endAngle: number, innerRatio: number): number[] {
  const rx = w / 2;
  const ry = h / 2;
  const sweep = arcSweep(startAngle, endAngle);
  const segments = Math.max(8, Math.ceil((curveSegments(rx, ry) * sweep) / TAU));
  const points: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (sweep * i) / segments;
    points.push(rx + rx * Math.cos(angle), ry + ry * Math.sin(angle));
  }
  if (sweep >= TAU) return points.slice(0, -2);
  if (innerRatio <= 0) {
    points.push(rx, ry);
    return points;
  }
  for (let i = segments; i >= 0; i--) {
    const angle = startAngle + (sweep * i) / segments;
    points.push(rx + rx * innerRatio * Math.cos(angle), ry + ry * innerRatio * Math.sin(angle));
  }
  return points;
}

// Contorno de la forma en coordenadas locales (0..w, 0..h). Las líneas devuelven su polilínea abierta.
export function outline(record: RenderableRecord): { points: number[]; closed: boolean } {
  const { w, h } = record;
  switch (record.type) {
    case 'rect':
      return { points: roundRectPolygon(w, h, record.cornerRadius), closed: true };
    case 'ellipse':
      return { points: ellipsePolygon(w, h), closed: true };
    case 'triangle':
      return { points: [w / 2, 0, w, h, 0, h], closed: true };
    case 'diamond':
      return { points: [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2], closed: true };
    case 'star':
      return { points: starPolygon(w, h, record.points, record.innerRatio), closed: true };
    case 'polygon':
      return { points: polygonPoints(record), closed: true };
    case 'arc':
      return { points: arcPolygon(w, h, record.startAngle, record.endAngle, record.innerRatio), closed: true };
    case 'line':
      return { points: record.points.flat(), closed: false };
    case 'connector':
      return { points: [...(record.path ?? [])], closed: false };
    case 'image':
      return { points: roundRectPolygon(w, h, record.cornerRadius), closed: true };
    case 'text':
      return { points: [0, 0, w, 0, w, h, 0, h], closed: true };
  }
}

export function polygonPoints(record: Extract<ShapeRecord, { type: 'polygon' }>): number[] {
  if (record.vertices) return record.vertices.flatMap(([u, v]) => [u * record.w, v * record.h]);
  return regularPolygon(record.w, record.h, record.sides ?? 6);
}

export function pointInPolygon(points: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const count = points.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = points[i * 2]!;
    const yi = points[i * 2 + 1]!;
    const xj = points[j * 2]!;
    const yj = points[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToPolyline(points: readonly number[], closed: boolean, x: number, y: number): number {
  let best = Infinity;
  const count = points.length / 2;
  const last = closed ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % count;
    best = Math.min(best, distanceToSegment(x, y, points[i * 2]!, points[i * 2 + 1]!, points[j * 2]!, points[j * 2 + 1]!));
  }
  return best;
}

// Trozos de una polilínea para trazos discontinuos o punteados.
export function dashSegments(points: readonly number[], closed: boolean, dash: number, gap: number): number[][] {
  const segments: number[][] = [];
  const count = points.length / 2;
  if (count < 2 || dash <= 0) return segments;
  const edges = closed ? count : count - 1;
  let drawing = true;
  let remaining = dash;
  let current: number[] = [points[0]!, points[1]!];
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % count;
    let ax = points[i * 2]!;
    let ay = points[i * 2 + 1]!;
    const bx = points[j * 2]!;
    const by = points[j * 2 + 1]!;
    let length = Math.hypot(bx - ax, by - ay);
    while (length > 0) {
      const step = Math.min(remaining, length);
      const t = step / length;
      const nx = ax + (bx - ax) * t;
      const ny = ay + (by - ay) * t;
      if (drawing) current.push(nx, ny);
      ax = nx;
      ay = ny;
      length -= step;
      remaining -= step;
      if (remaining <= 1e-9) {
        if (drawing && current.length >= 4) segments.push(current);
        drawing = !drawing;
        remaining = drawing ? dash : gap;
        current = [ax, ay];
      }
    }
  }
  if (drawing && current.length >= 4) segments.push(current);
  return segments;
}

export function dashPattern(style: 'solid' | 'dashed' | 'dotted', strokeWidth: number): [number, number] | null {
  const width = Math.max(1, strokeWidth);
  if (style === 'dashed') return [width * 4, width * 2.5];
  if (style === 'dotted') return [width * 0.01, width * 2];
  return null;
}
