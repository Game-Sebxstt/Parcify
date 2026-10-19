import type { NodeOf } from '../../shared/document/schema.js';
import { apply, invert, type Mat, type Point } from './matrix.ts';

export type ConnectorEnd = NodeOf<'connector'>['from'];
export type Anchor = Extract<ConnectorEnd, { nodeId: string }>['anchor'];
export type ConnectorRoute = NodeOf<'connector'>['route'];

// Extremo ya resuelto en coordenadas de mundo. `dir` es la normal hacia fuera del lado del ancla (null en el
// centro o en un punto libre).
export type Terminal = { x: number; y: number; dir: Point | null; bounds?: Bounds };
// Caja en mundo del nodo del ancla, para que el codo pueda rodearlo.
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export const NAMED_ANCHORS = ['top', 'right', 'bottom', 'left', 'center'] as const;
export type NamedAnchor = (typeof NAMED_ANCHORS)[number];

// Distancia mínima entre la salida de un codo y el nodo cuando los dos extremos miran al mismo lado.
export const ELBOW_MARGIN = 24;
export const CURVE_SEGMENTS = 32;

const NORMALS: Record<NamedAnchor, Point | null> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  center: null,
};

const UNIT: Record<NamedAnchor, Point> = {
  top: { x: 0.5, y: 0 },
  right: { x: 1, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
};

// Punto del ancla en la caja unidad (0..1) y normal del lado más cercano.
export function anchorUnit(anchor: Anchor): { u: number; v: number; normal: Point | null } {
  if (typeof anchor === 'string') return { u: UNIT[anchor].x, v: UNIT[anchor].y, normal: NORMALS[anchor] };
  const { u, v } = anchor;
  const sides: Array<[number, Point]> = [
    [v, NORMALS.top!],
    [1 - u, NORMALS.right!],
    [1 - v, NORMALS.bottom!],
    [u, NORMALS.left!],
  ];
  sides.sort((a, b) => a[0] - b[0]);
  return { u, v, normal: sides[0]![1] };
}

// Extremo anclado a un nodo: su matriz de mundo lleva la caja (0..w, 0..h) a mundo, con giro y volteo.
export function anchorTerminal(world: Readonly<Mat>, w: number, h: number, anchor: Anchor): Terminal {
  const { u, v, normal } = anchorUnit(anchor);
  const p = apply(world, u * w, v * h);
  if (!normal) return { x: p.x, y: p.y, dir: null };
  const dx = world[0] * normal.x + world[2] * normal.y;
  const dy = world[1] * normal.x + world[3] * normal.y;
  const length = Math.hypot(dx, dy);
  // «+ 0» convierte un -0 en 0.
  return { x: p.x, y: p.y, dir: length > 0 ? { x: dx / length + 0, y: dy / length + 0 } : null, bounds: worldBounds(world, w, h) };
}

function worldBounds(world: Readonly<Mat>, w: number, h: number): Bounds {
  // Las esquinas son el origen más las combinaciones de las dos columnas: cada eje suma su parte negativa al mínimo.
  const ax = world[0] * w;
  const bx = world[2] * h;
  const ay = world[1] * w;
  const by = world[3] * h;
  return {
    minX: world[4] + Math.min(0, ax) + Math.min(0, bx),
    minY: world[5] + Math.min(0, ay) + Math.min(0, by),
    maxX: world[4] + Math.max(0, ax) + Math.max(0, bx),
    maxY: world[5] + Math.max(0, ay) + Math.max(0, by),
  };
}

// Coordenada del tramo que cruza entre dos extremos que se dan la espalda: por el hueco entre los dos nodos si lo
// hay; si se solapan en ese eje, por fuera de los dos.
function detour(a: number, b: number, spanA: [number, number] | null, spanB: [number, number] | null): number {
  const [lowA, highA] = spanA ?? [a, a];
  const [lowB, highB] = spanB ?? [b, b];
  if (highA + 2 * ELBOW_MARGIN <= lowB || highB + 2 * ELBOW_MARGIN <= lowA) return highA <= lowB ? (highA + lowB) / 2 : (highB + lowA) / 2;
  return Math.min(lowA, lowB) - ELBOW_MARGIN;
}

const spanY = (t: Terminal): [number, number] | null => (t.bounds ? [t.bounds.minY, t.bounds.maxY] : null);
const spanX = (t: Terminal): [number, number] | null => (t.bounds ? [t.bounds.minX, t.bounds.maxX] : null);

// Ancla de un punto de mundo sobre la caja de un nodo: el ancla con nombre si está a menos de `snap` (en
// unidades de mundo), si no la posición relativa {u, v} dentro de la caja.
export function anchorAt(world: Readonly<Mat>, w: number, h: number, point: Point, snap: number): Anchor {
  const local = apply(invert(world), point.x, point.y);
  let best: NamedAnchor | null = null;
  let bestDistance = Infinity;
  for (const name of NAMED_ANCHORS) {
    const unit = UNIT[name];
    const distance = Math.hypot(local.x - unit.x * w, local.y - unit.y * h);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  if (best && bestDistance <= snap) return best;
  const round = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
  return { u: round(w > 0 ? local.x / w : 0.5), v: round(h > 0 ? local.y / h : 0.5) };
}

// Eje dominante de un vector como vector unidad ortogonal.
export function axisOf(vector: Point): Point {
  if (Math.abs(vector.x) >= Math.abs(vector.y)) return { x: vector.x < 0 ? -1 : 1, y: 0 };
  return { x: 0, y: vector.y < 0 ? -1 : 1 };
}

// Direcciones de salida y de llegada; si un extremo no tiene normal, sale hacia el otro por el eje dominante.
function directions(start: Terminal, end: Terminal): [Point, Point] {
  const toEnd = { x: end.x - start.x, y: end.y - start.y };
  const ds = start.dir ?? axisOf(toEnd);
  const de = end.dir ?? axisOf({ x: -toEnd.x, y: -toEnd.y });
  return [ds, de];
}

// Recorrido del conector en mundo, como polilínea plana [x0, y0, x1, y1, …].
export function routePoints(start: Terminal, end: Terminal, route: ConnectorRoute): number[] {
  if (route === 'straight') return [start.x, start.y, end.x, end.y];
  const [ds, de] = directions(start, end);
  if (route === 'curved') return curvedRoute(start, end, ds, de);
  return elbowRoute(start, end, axisOf(ds), axisOf(de));
}

// Codo ortogonal con salida perpendicular al lado de cada ancla: como mucho tres segmentos cuando cada extremo
// tiene el otro delante. Si un ancla da la espalda al otro extremo, primero se sale ELBOW_MARGIN hacia fuera de su
// lado y se gira después, para no cruzar el propio nodo.
function elbowRoute(s: Terminal, e: Terminal, ds: Point, de: Point): number[] {
  const startHorizontal = ds.y === 0;
  const endHorizontal = de.y === 0;
  // Cuánto avanza cada extremo hacia el otro en su dirección de salida.
  const startAhead = (e.x - s.x) * ds.x + (e.y - s.y) * ds.y;
  const endAhead = (s.x - e.x) * de.x + (s.y - e.y) * de.y;
  let points: number[];
  if (startHorizontal && endHorizontal) {
    if (ds.x === de.x) {
      const mid = ds.x > 0 ? Math.max(s.x, e.x) + ELBOW_MARGIN : Math.min(s.x, e.x) - ELBOW_MARGIN;
      points = [s.x, s.y, mid, s.y, mid, e.y, e.x, e.y];
    } else if (startAhead > 0) {
      const mid = (s.x + e.x) / 2;
      points = [s.x, s.y, mid, s.y, mid, e.y, e.x, e.y];
    } else {
      const sx = s.x + ds.x * ELBOW_MARGIN;
      const ex = e.x + de.x * ELBOW_MARGIN;
      const mid = detour(s.y, e.y, spanY(s), spanY(e));
      points = [s.x, s.y, sx, s.y, sx, mid, ex, mid, ex, e.y, e.x, e.y];
    }
  } else if (!startHorizontal && !endHorizontal) {
    if (ds.y === de.y) {
      const mid = ds.y > 0 ? Math.max(s.y, e.y) + ELBOW_MARGIN : Math.min(s.y, e.y) - ELBOW_MARGIN;
      points = [s.x, s.y, s.x, mid, e.x, mid, e.x, e.y];
    } else if (startAhead > 0) {
      const mid = (s.y + e.y) / 2;
      points = [s.x, s.y, s.x, mid, e.x, mid, e.x, e.y];
    } else {
      const sy = s.y + ds.y * ELBOW_MARGIN;
      const ey = e.y + de.y * ELBOW_MARGIN;
      const mid = detour(s.x, e.x, spanX(s), spanX(e));
      points = [s.x, s.y, s.x, sy, mid, sy, mid, ey, e.x, ey, e.x, e.y];
    }
  } else if (startAhead > 0 && endAhead > 0) {
    points = startHorizontal ? [s.x, s.y, e.x, s.y, e.x, e.y] : [s.x, s.y, s.x, e.y, e.x, e.y];
  } else {
    const s1 = { x: s.x + ds.x * ELBOW_MARGIN, y: s.y + ds.y * ELBOW_MARGIN };
    const e1 = { x: e.x + de.x * ELBOW_MARGIN, y: e.y + de.y * ELBOW_MARGIN };
    const corner = startHorizontal ? { x: s1.x, y: e1.y } : { x: e1.x, y: s1.y };
    points = [s.x, s.y, s1.x, s1.y, corner.x, corner.y, e1.x, e1.y, e.x, e.y];
  }
  return simplify(points);
}

function curvedRoute(s: Terminal, e: Terminal, ds: Point, de: Point): number[] {
  const k = Math.max(30, Math.hypot(e.x - s.x, e.y - s.y) * 0.4);
  const c1x = s.x + ds.x * k;
  const c1y = s.y + ds.y * k;
  const c2x = e.x + de.x * k;
  const c2y = e.y + de.y * k;
  const points: number[] = [];
  for (let i = 0; i <= CURVE_SEGMENTS; i++) {
    const t = i / CURVE_SEGMENTS;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    points.push(a * s.x + b * c1x + c * c2x + d * e.x, a * s.y + b * c1y + c * c2y + d * e.y);
  }
  return points;
}

// Quita puntos repetidos y los intermedios alineados con sus vecinos.
function simplify(points: number[]): number[] {
  const out: number[] = [points[0]!, points[1]!];
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    const n = out.length;
    if (Math.abs(out[n - 2]! - x) < 1e-9 && Math.abs(out[n - 1]! - y) < 1e-9) continue;
    if (n >= 4) {
      const ax = out[n - 4]!;
      const ay = out[n - 3]!;
      const bx = out[n - 2]!;
      const by = out[n - 1]!;
      const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (Math.abs(cross) < 1e-9) {
        out[n - 2] = x;
        out[n - 1] = y;
        continue;
      }
    }
    out.push(x, y);
  }
  if (out.length === 2) out.push(out[0]!, out[1]!);
  return out;
}

export function routeStart(route: readonly number[]): Point {
  return { x: route[0] ?? 0, y: route[1] ?? 0 };
}

export function routeEnd(route: readonly number[]): Point {
  return { x: route[route.length - 2] ?? 0, y: route[route.length - 1] ?? 0 };
}

// Caja de los extremos y sentido del recorrido: lo que se guarda en x, y, w, h, flipX y flipY del conector para
// que quien no conoce el nodo de un extremo (el servidor, al normalizar un extremo colgante) pueda reconstruir
// los dos puntos.
export function endpointBox(from: Point, to: Point): { x: number; y: number; w: number; h: number; flipX: boolean; flipY: boolean } {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
    flipX: from.x > to.x,
    flipY: from.y > to.y,
  };
}

// Inversa de endpointBox.
export function endpointsFromBox(record: { x: number; y: number; w: number; h: number; flipX?: boolean | undefined; flipY?: boolean | undefined }): {
  from: Point;
  to: Point;
} {
  const left = record.x;
  const right = record.x + record.w;
  const top = record.y;
  const bottom = record.y + record.h;
  return {
    from: { x: record.flipX ? right : left, y: record.flipY ? bottom : top },
    to: { x: record.flipX ? left : right, y: record.flipY ? top : bottom },
  };
}
