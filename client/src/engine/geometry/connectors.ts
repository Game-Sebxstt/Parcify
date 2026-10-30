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
// Curva con waypoints: tramos por vano y tope de puntos del recorrido entero.
export const CURVE_SPAN_SEGMENTS = 16;
export const MAX_ROUTE_POINTS = 128;

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

// Recorrido del conector en mundo, como polilínea plana [x0, y0, x1, y1, …]. Los `waypoints` llegan en mundo; sin
// ellos el recorrido es el automático de siempre.
export function routePoints(start: Terminal, end: Terminal, route: ConnectorRoute, waypoints?: readonly Point[]): number[] {
  if (waypoints?.length) {
    if (route === 'straight') return [start.x, start.y, ...waypoints.flatMap((p) => [p.x, p.y]), end.x, end.y];
    if (route === 'curved') return splineRoute(start, end, waypoints);
    return elbowThrough(start, end, waypoints);
  }
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

// Spline Catmull-Rom centrípeta (α = 0,5) que pasa por el inicio, los waypoints y el final. En un extremo con ancla
// la tangente es la normal del lado (sale hacia fuera y llega desde fuera); en uno libre, la del primer vano.
function splineRoute(s: Terminal, e: Terminal, waypoints: readonly Point[]): number[] {
  const knots: Point[] = [];
  for (const p of [s, ...waypoints, e]) {
    const last = knots[knots.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) knots.push({ x: p.x, y: p.y });
  }
  if (knots.length < 2) return [s.x, s.y, e.x, e.y];
  const spans = knots.length - 1;
  const steps = Math.max(1, Math.min(CURVE_SPAN_SEGMENTS, Math.floor((MAX_ROUTE_POINTS - 1) / spans)));
  // Intervalo de parámetro de cada vano: la raíz de su longitud.
  const dt: number[] = [];
  for (let i = 0; i < spans; i++) dt.push(Math.sqrt(Math.hypot(knots[i + 1]!.x - knots[i]!.x, knots[i + 1]!.y - knots[i]!.y)));
  // Velocidad en cada nudo por unidad de parámetro.
  const velocity: Point[] = knots.map((p, i) => {
    if (i === 0 || i === spans) {
      const span = i === 0 ? 0 : spans - 1;
      const a = knots[span]!;
      const b = knots[span + 1]!;
      const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt[span]!;
      const dir = i === 0 ? s.dir : e.dir && { x: -e.dir.x, y: -e.dir.y };
      if (dir) return { x: dir.x * speed, y: dir.y * speed };
      return { x: (b.x - a.x) / dt[span]!, y: (b.y - a.y) / dt[span]! };
    }
    const prev = knots[i - 1]!;
    const next = knots[i + 1]!;
    const d0 = dt[i - 1]!;
    const d1 = dt[i]!;
    return {
      x: (p.x - prev.x) / d0 - (next.x - prev.x) / (d0 + d1) + (next.x - p.x) / d1,
      y: (p.y - prev.y) / d0 - (next.y - prev.y) / (d0 + d1) + (next.y - p.y) / d1,
    };
  });
  const out = [knots[0]!.x, knots[0]!.y];
  for (let i = 0; i < spans; i++) {
    const a = knots[i]!;
    const b = knots[i + 1]!;
    const ma = { x: velocity[i]!.x * dt[i]!, y: velocity[i]!.y * dt[i]! };
    const mb = { x: velocity[i + 1]!.x * dt[i]!, y: velocity[i + 1]!.y * dt[i]! };
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      out.push(h00 * a.x + h10 * ma.x + h01 * b.x + h11 * mb.x, h00 * a.y + h10 * ma.y + h01 * b.y + h11 * mb.y);
    }
  }
  return out;
}

type Axis = 'x' | 'y';

// Por debajo de esta diferencia (en mundo) dos puntos se consideran alineados: los waypoints se guardan redondeados.
const ALIGN_EPSILON = 0.01;

const otherAxis = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');
const axisNameOf = (vector: Point): Axis => (Math.abs(vector.x) >= Math.abs(vector.y) ? 'x' : 'y');

// Dirección (unidad ortogonal) del primer y del último movimiento de `orthLink(from, to, axis)`; null si no se mueve.
function linkMoves(from: Point, to: Point, axis: Axis): { first: Point; last: Point } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const alignedX = Math.abs(dx) < ALIGN_EPSILON;
  const alignedY = Math.abs(dy) < ALIGN_EPSILON;
  if (alignedX && alignedY) return null;
  const alongX = { x: Math.sign(dx), y: 0 };
  const alongY = { x: 0, y: Math.sign(dy) };
  if (alignedX) return { first: alongY, last: alongY };
  if (alignedY) return { first: alongX, last: alongX };
  return axis === 'x' ? { first: alongX, last: alongY } : { first: alongY, last: alongX };
}

// Enlaza `from` con `to` en ortogonal: si no están alineados añade un codo, moviéndose primero por `axis`.
// Devuelve el eje por el que se llega a `to` (null si no hubo movimiento).
function orthLink(out: number[], from: Point, to: Point, axis: Axis): Axis | null {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx < ALIGN_EPSILON && dy < ALIGN_EPSILON) return null;
  if (dx < ALIGN_EPSILON) {
    out.push(to.x, to.y);
    return 'y';
  }
  if (dy < ALIGN_EPSILON) {
    out.push(to.x, to.y);
    return 'x';
  }
  if (axis === 'x') out.push(to.x, from.y, to.x, to.y);
  else out.push(from.x, to.y, to.x, to.y);
  return otherAxis(axis);
}

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

// Direcciones (unidad por eje) de los tramos con longitud de una polilínea plana.
function moveDirections(points: readonly number[]): Point[] {
  const out: Point[] = [];
  for (let i = 2; i + 1 < points.length; i += 2) {
    const dx = points[i]! - points[i - 2]!;
    const dy = points[i + 1]! - points[i - 1]!;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
    out.push({ x: Math.sign(dx), y: Math.sign(dy) });
  }
  return out;
}

// Sin medias vueltas: ningún tramo va en sentido contrario al anterior (ni al `incoming`, si llega). `first` y
// `last` son el sentido que tienen que llevar el primer y el último movimiento, si se pide.
function clean(points: readonly number[], options: { incoming?: Point | null; first?: Point | null; last?: Point | null }): boolean {
  const moves = moveDirections(points);
  if (options.first && !(moves.length > 0 && dot(moves[0]!, options.first) > 0)) return false;
  if (options.last && !(moves.length > 0 && dot(moves[moves.length - 1]!, options.last) > 0)) return false;
  let previous = options.incoming ?? null;
  for (const move of moves) {
    if (previous && dot(previous, move) < 0) return false;
    previous = move;
  }
  return true;
}

const withCoord = (p: Point, axis: Axis, value: number): Point => (axis === 'x' ? { x: value, y: p.y } : { x: p.x, y: value });

function linked(from: Point, to: Point, axis: Axis): Point[] {
  const flat: number[] = [];
  orthLink(flat, from, to, axis);
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! });
  return out;
}

// Recorridos ortogonales de `from` a `to` (sin incluir `from`) que entran en `to` en contra de `outward`, de menos a
// más vueltas: enlace directo, por el punto a ELBOW_MARGIN, en Z, en U por fuera de la caja del nodo y saliendo
// antes por la normal. Quien los usa se queda con el primero que no da media vuelta.
function approaches(from: Point, to: Point, outward: Point, bounds?: Bounds): Point[][] {
  const normal = axisNameOf(outward);
  const side = otherAxis(normal);
  const t1 = { x: to.x + outward.x * ELBOW_MARGIN, y: to.y + outward.y * ELBOW_MARGIN };
  const list: Point[][] = [];
  for (const axis of ['x', 'y'] as const) {
    list.push(linked(from, to, axis));
    list.push([...linked(from, t1, axis), to]);
  }
  const mid = withCoord(from, side, (from[side] + t1[side]) / 2);
  list.push([mid, ...linked(mid, t1, normal), to]);
  const low = bounds ? (side === 'x' ? bounds.minX : bounds.minY) : to[side];
  const high = bounds ? (side === 'x' ? bounds.maxX : bounds.maxY) : to[side];
  for (const sign of [1, -1]) {
    const c = sign > 0 ? Math.max(from[side], high) + ELBOW_MARGIN : Math.min(from[side], low) - ELBOW_MARGIN;
    list.push([withCoord(from, side, c), withCoord(t1, side, c), t1, to]);
  }
  const n0 = outward[normal] > 0 ? Math.max(from[normal] + ELBOW_MARGIN, t1[normal]) : Math.min(from[normal] - ELBOW_MARGIN, t1[normal]);
  list.push([withCoord(from, normal, n0), withCoord(to, normal, n0), to]);
  return list;
}

const flatLength = (points: readonly number[]) => {
  let total = 0;
  for (let i = 2; i + 1 < points.length; i += 2) total += Math.abs(points[i]! - points[i - 2]!) + Math.abs(points[i + 1]! - points[i - 1]!);
  return total;
};

// De los recorridos, el de menos puntos (y después el más corto) que pasa `clean`; null si ninguno.
function bestClean(candidates: number[][], options: Parameters<typeof clean>[1]): number[] | null {
  let best: number[] | null = null;
  for (const candidate of candidates) {
    const route = simplify(candidate, true);
    if (!clean(route, options)) continue;
    if (!best || route.length < best.length || (route.length === best.length && flatLength(route) < flatLength(best))) best = route;
  }
  return best;
}

// Codo que pasa por cada waypoint. Cada waypoint es un vértice: se sale de él por el eje contrario al de llegada.
// Un extremo con ancla sale hacia fuera de su lado y llega desde fuera. Si el enlace directo no lo cumple, pasa por
// un punto a ELBOW_MARGIN del extremo en su normal y, si así diera media vuelta, rodea el nodo en U.
function elbowThrough(s: Terminal, e: Terminal, waypoints: readonly Point[]): number[] {
  const first = waypoints[0]!;
  const outward = s.dir ? axisOf(s.dir) : null;
  const departures: Point[][] = [];
  let axis: Axis = s.dir ? axisNameOf(s.dir) : axisNameOf({ x: first.x - s.x, y: first.y - s.y });
  {
    let cursor: Point = { x: s.x, y: s.y };
    const path: Point[] = [];
    const moves = linkMoves(cursor, first, axis);
    if (outward && (!moves || dot(moves.first, outward) <= 0)) {
      cursor = { x: s.x + outward.x * ELBOW_MARGIN, y: s.y + outward.y * ELBOW_MARGIN };
      path.push(cursor);
      axis = otherAxis(axisNameOf(outward));
    }
    departures.push([...path, ...linked(cursor, first, axis)]);
  }
  if (outward) {
    // La salida es la inversa de una llegada desde el primer waypoint hasta el inicio.
    for (const reverse of approaches(first, s, outward, s.bounds)) departures.push([...reverse.slice(0, -1).reverse(), first]);
  } else departures.push(linked(s, first, otherAxis(axis)));
  const inward = e.dir ? { x: -axisOf(e.dir).x, y: -axisOf(e.dir).y } : null;
  let fallback: number[] | null = null;
  for (const departure of departures) {
    const out = [s.x, s.y, ...departure.flatMap((p) => [p.x, p.y])];
    const route = simplify(continueThrough(out, waypoints, e, axis), true);
    if (clean(route, { first: outward, last: inward })) return route;
    fallback ??= route;
  }
  return fallback!;
}

// Dirección del último tramo con longitud; null si no hay ninguno.
const lastMove = (points: readonly number[]): Point | null => moveDirections(points).at(-1) ?? null;

// Sigue el recorrido `out`, que ya llega al primer waypoint, por los demás y hasta el final. `initialAxis` es el eje
// de salida del primer waypoint si no se llegó a él con ningún movimiento.
function continueThrough(out: number[], waypoints: readonly Point[], e: Terminal, initialAxis: Axis): number[] {
  const incoming = lastMove(out);
  let axis: Axis = incoming ? otherAxis(axisNameOf(incoming)) : initialAxis;
  let cursor = waypoints[0]!;
  for (const wp of waypoints.slice(1)) {
    const arrival = orthLink(out, cursor, wp, axis);
    if (arrival) axis = otherAxis(arrival);
    cursor = wp;
  }
  arrive(out, cursor, axis, e);
  return out;
}

function arrive(out: number[], cursor: Point, axis: Axis, e: Terminal): void {
  if (!e.dir) {
    orthLink(out, cursor, e, axis);
    return;
  }
  const outward = axisOf(e.dir);
  const inward = { x: -outward.x, y: -outward.y };
  const incoming = lastMove(out);
  // Primero por el eje que toca; si así se entraría por otro lado, por el contrario (el waypoint deja de ser codo),
  // siempre que no haya que volver sobre el último tramo.
  for (const candidate of [axis, otherAxis(axis)]) {
    const moves = linkMoves(cursor, e, candidate);
    if (moves && dot(moves.last, inward) > 0 && !(incoming && dot(moves.first, incoming) < 0)) {
      orthLink(out, cursor, e, candidate);
      return;
    }
  }
  const e1 = { x: e.x + outward.x * ELBOW_MARGIN, y: e.y + outward.y * ELBOW_MARGIN };
  const normalAxis = axisNameOf(outward);
  const tail = [cursor.x, cursor.y];
  if (axis === normalAxis) orthLink(tail, cursor, e1, normalAxis);
  else {
    // Hay que salir por el eje perpendicular a la normal y llegar a e1 por ese mismo eje: un codo en Z.
    const mid = axis === 'x' ? { x: (cursor.x + e1.x) / 2, y: cursor.y } : { x: cursor.x, y: (cursor.y + e1.y) / 2 };
    tail.push(mid.x, mid.y);
    orthLink(tail, mid, e1, normalAxis);
  }
  tail.push(e.x, e.y);
  const options = { incoming, last: inward };
  const chosen = clean(simplify(tail, true), options)
    ? tail
    : (bestClean(
        approaches(cursor, e, outward, e.bounds).map((path) => [cursor.x, cursor.y, ...path.flatMap((p) => [p.x, p.y])]),
        options,
      ) ?? tail);
  out.push(...chosen.slice(2));
}

// Waypoints nuevos de un codo al desplazar `delta` en perpendicular el tramo `segment` de su recorrido `route`
// (en mundo). Si el tramo toca un extremo, antes se parte a ELBOW_MARGIN de él para que la salida siga igual. Un
// tramo vecino que toca un extremo conserva su sentido y al menos min(ELBOW_MARGIN, su longitud), para que la
// salida o la llegada no se den la vuelta.
export function dragElbowSegment(route: readonly number[], segment: number, delta: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 1 < route.length; i += 2) points.push({ x: route[i]!, y: route[i + 1]! });
  const count = points.length;
  if (segment < 0 || segment >= count - 1) return points.slice(1, -1);
  const a = points[segment]!;
  const b = points[segment + 1]!;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  delta = limitElbowDrag(points, segment, horizontal, delta);
  const ux = length > 0 ? (b.x - a.x) / length : 0;
  const uy = length > 0 ? (b.y - a.y) / length : 0;
  // Un tramo único se parte en dos sitios: con un tercio de su longitud como mucho los dos codos no coinciden.
  const margin = Math.min(ELBOW_MARGIN, count === 2 ? length / 3 : length / 2);
  const mid: Point[] = [{ ...a }];
  if (segment === 0) {
    const p = { x: a.x + ux * margin, y: a.y + uy * margin };
    mid.push(p, { ...p });
  }
  const moveFirst = mid.length - 1;
  if (segment === count - 2) {
    const q = { x: b.x - ux * margin, y: b.y - uy * margin };
    mid.push({ ...q }, q, { ...b });
  } else mid.push({ ...b });
  const moveLast = moveFirst + 1;
  for (const index of [moveFirst, moveLast]) {
    if (horizontal) mid[index]!.y += delta;
    else mid[index]!.x += delta;
  }
  const all = [...points.slice(0, segment), ...mid, ...points.slice(segment + 2)];
  const simplified = simplify(all.flatMap((p) => [p.x, p.y]));
  const out: Point[] = [];
  for (let i = 2; i + 3 < simplified.length; i += 2) out.push({ x: simplified[i]!, y: simplified[i + 1]! });
  return out;
}

// Desplazamiento permitido del tramo `segment` (de `points`) en perpendicular. Un vecino que toca un extremo no se
// acorta por debajo de min(ELBOW_MARGIN, su longitud) ni cambia de sentido. Un vecino interior entre dos tramos que
// van en sentidos contrarios no se queda en longitud 0, porque los dos tramos se juntarían en una media vuelta.
function limitElbowDrag(points: readonly Point[], segment: number, horizontal: boolean, delta: number): number {
  const count = points.length;
  const normal = horizontal ? { x: 0, y: 1 } : { x: 1, y: 0 };
  let low = -Infinity;
  let high = Infinity;
  const interior: Array<{ length: number; k: number }> = [];
  for (const j of [segment - 1, segment + 1]) {
    if (j < 0 || j > count - 2) continue;
    const p = points[j]!;
    const q = points[j + 1]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length === 0) continue;
    // Longitud nueva del vecino en su sentido de antes: length + k·delta.
    const k = ((j < segment ? 1 : -1) * ((q.x - p.x) * normal.x + (q.y - p.y) * normal.y)) / length;
    if (Math.abs(k) < 0.5) continue;
    if (j === 0 || j === count - 2) {
      const bound = (Math.min(ELBOW_MARGIN, length) - length) / k;
      if (k > 0) low = Math.max(low, bound);
      else high = Math.min(high, bound);
    } else {
      const before = points[j - 1]!;
      const after = points[j + 2]!;
      const opposite = (p.x - before.x) * (after.x - q.x) + (p.y - before.y) * (after.y - q.y) < 0;
      if (opposite) interior.push({ length, k });
    }
  }
  let limited = low > high ? 0 : Math.max(low, Math.min(high, delta));
  for (const { length, k } of interior) {
    const next = length + k * limited;
    if (Math.abs(next) < 1) limited = ((next >= 0 ? 1 : -1) - length) / k;
  }
  return limited >= low && limited <= high ? limited : 0;
}

// Inserta `point` en el tramo `segmentIndex` del recorrido inicio → waypoints → final (el tramo 0 sale del inicio).
export function insertWaypoint(waypoints: readonly Point[], segmentIndex: number, point: Point): Point[] {
  const out = waypoints.slice();
  out.splice(Math.max(0, Math.min(segmentIndex, out.length)), 0, { x: point.x, y: point.y });
  return out;
}

export function removeWaypoint(waypoints: readonly Point[], index: number): Point[] {
  return waypoints.filter((_, i) => i !== index);
}

export function moveWaypoint(waypoints: readonly Point[], index: number, point: Point): Point[] {
  return waypoints.map((p, i) => (i === index ? { x: point.x, y: point.y } : p));
}

// Quita puntos repetidos y los intermedios alineados con sus vecinos. Con `keepTurnbacks`, un punto alineado en el
// que el recorrido da media vuelta se queda: es un waypoint por el que tiene que pasar.
function simplify(points: number[], keepTurnbacks = false): number[] {
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
      const turnback = keepTurnbacks && (bx - ax) * (x - bx) + (by - ay) * (y - by) < 0;
      if (Math.abs(cross) < 1e-9 && !turnback) {
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
