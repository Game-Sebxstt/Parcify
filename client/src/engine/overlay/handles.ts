import { apply, compose, rotation, translation, type Mat, type Point } from '../geometry/matrix.ts';
import type { InputProfile } from '../interaction/input/profile.ts';
import type { HandleKind, LineHandles } from '../render/sink.ts';

// Caja de la selección: origen en mundo (esquina superior izquierda antes de girar), ángulo y tamaño.
export type SelectionFrame = { x: number; y: number; w: number; h: number; angle: number };

const MIN_EDGE_HANDLES_PX = 28;

export const HANDLE_SIDES: Record<HandleKind, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

export function frameMatrix(frame: SelectionFrame): Mat {
  return compose(translation(frame.x, frame.y), rotation(frame.angle));
}

export function frameCorners(frame: SelectionFrame, matrix?: Readonly<Mat>): [Point, Point, Point, Point] {
  const base = frameMatrix(frame);
  const m = matrix ? compose(matrix, base) : base;
  return [apply(m, 0, 0), apply(m, frame.w, 0), apply(m, frame.w, frame.h), apply(m, 0, frame.h)];
}

// Con el dedo, por debajo de este lado en pantalla (en los dos ejes) no hay tiradores de esquina: taparían la forma.
const MIN_TOUCH_CORNERS_PX = 24;
// Los tiradores de radio se ven en formas de al menos este lado en pantalla y, con hover, cerca de una esquina.
export const RADIUS_MIN_SIDE_PX = 48;
export const RADIUS_HOVER_PX = 24;
// Distancia mínima en pantalla del tirador de radio a su esquina, para que no tape el de escala.
const RADIUS_MIN_INSET_PX = 12;

export type CornerName = 'nw' | 'ne' | 'se' | 'sw';
// Orden de las esquinas que devuelven frameCorners y screenCorners.
export const CORNER_NAMES: readonly CornerName[] = ['nw', 'ne', 'se', 'sw'];

export type HandleProfile = Pick<InputProfile, 'kind' | 'handleHit' | 'handleDraw' | 'rotateZone' | 'rotateHandle'>;

function sides(corners: readonly [Point, Point, Point, Point]): { width: number; height: number } {
  const [nw, ne, , sw] = corners;
  return { width: Math.hypot(ne.x - nw.x, ne.y - nw.y), height: Math.hypot(sw.x - nw.x, sw.y - nw.y) };
}

// Con `sideEdges` (un texto solo), E y O se ven con cualquier alto: el texto de una línea mide menos de 28 px y E/O son
// los que lo pasan a auto-alto.
export type HandleOptions = { sideEdges?: boolean };

// Posiciones de los 8 handles en pantalla a partir de las esquinas ya proyectadas.
export function handlePositions(
  corners: readonly [Point, Point, Point, Point],
  profile?: Pick<InputProfile, 'kind'>,
  options: HandleOptions = {},
): Array<{ kind: HandleKind; x: number; y: number }> {
  const [nw, ne, se, sw] = corners;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const { width, height } = sides(corners);
  const handles: Array<{ kind: HandleKind; x: number; y: number }> = [];
  if (!(profile?.kind === 'touch' && width < MIN_TOUCH_CORNERS_PX && height < MIN_TOUCH_CORNERS_PX)) {
    handles.push({ kind: 'nw', ...nw }, { kind: 'ne', ...ne }, { kind: 'se', ...se }, { kind: 'sw', ...sw });
  }
  if (width >= MIN_EDGE_HANDLES_PX) handles.push({ kind: 'n', ...mid(nw, ne) }, { kind: 's', ...mid(sw, se) });
  if (height >= MIN_EDGE_HANDLES_PX || (options.sideEdges && height > 0)) handles.push({ kind: 'e', ...mid(ne, se) }, { kind: 'w', ...mid(nw, sw) });
  return handles;
}

// Tirador de giro del dedo: `offset` px por encima del centro del lado superior, hacia fuera de la caja.
export function rotateHandlePosition(corners: readonly [Point, Point, Point, Point], offset: number): Point {
  const [nw, ne, , sw] = corners;
  const top = { x: (nw.x + ne.x) / 2, y: (nw.y + ne.y) / 2 };
  // Sin alto (una caja plana) se sale en perpendicular al lado superior.
  const along = unit(ne.x - nw.x, ne.y - nw.y);
  const out = unit(nw.x - sw.x, nw.y - sw.y) ?? (along ? { x: along.y, y: -along.x } : { x: 0, y: -1 });
  return { x: top.x + out.x * offset, y: top.y + out.y * offset };
}

export type HandleHit = { kind: HandleKind; x: number; y: number } | { kind: 'rotate'; corner: CornerName | null } | null;

// Orden: tirador de giro del dedo, tiradores de escala (zona cuadrada de lado handleHit) y, fuera de la caja, la zona de
// giro entre rotateZone[0] y rotateZone[1] px de cada esquina. Si la caja mide en pantalla menos de dos zonas de impacto,
// cada tirador solo cuenta fuera de la caja o a menos de handleDraw de su punto: dentro manda el cuerpo, para poder
// arrastrar las formas pequeñas.
export function hitHandle(
  corners: readonly [Point, Point, Point, Point],
  x: number,
  y: number,
  profile: HandleProfile,
  options: HandleOptions = {},
): HandleHit {
  const half = profile.handleHit / 2;
  const handles = handlePositions(corners, profile, options);
  const inside = insideQuad(corners, x, y);
  if (profile.rotateHandle !== null) {
    const at = rotateHandlePosition(corners, profile.rotateHandle);
    const distance = Math.hypot(at.x - x, at.y - y);
    const top = handles.find((handle) => handle.kind === 'n');
    if (!inside && distance <= half && (!top || distance < Math.hypot(top.x - x, top.y - y))) return { kind: 'rotate', corner: null };
  }
  const { width, height } = sides(corners);
  const clipped = Math.min(width, height) < 2 * profile.handleHit;
  let best: { kind: HandleKind; x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (const handle of handles) {
    if (Math.abs(handle.x - x) > half || Math.abs(handle.y - y) > half) continue;
    const distance = Math.hypot(handle.x - x, handle.y - y);
    if (clipped && inside && distance > profile.handleDraw) continue;
    if (distance < bestDistance) {
      best = handle;
      bestDistance = distance;
    }
  }
  if (best) return best;
  if (inside) return null;
  const [min, max] = profile.rotateZone;
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i]!;
    const distance = Math.hypot(corner.x - x, corner.y - y);
    if (distance >= min && distance <= max) return { kind: 'rotate', corner: CORNER_NAMES[i]! };
  }
  return null;
}

// Tiradores de radio en coordenadas locales de la caja (0..w, 0..h), por la bisectriz de cada esquina y en el orden
// nw, ne, se, sw. Van a la distancia del radio, con un mínimo de 12 px de pantalla y sin pasar del centro.
export function radiusHandlesLocal(w: number, h: number, radius: number, zoom: number): Point[] {
  const d = Math.min(Math.max(radius, RADIUS_MIN_INSET_PX / zoom), Math.min(w, h) / 2);
  return [
    { x: d, y: d },
    { x: w - d, y: d },
    { x: w - d, y: h - d },
    { x: d, y: h - d },
  ];
}

// Hay radio si la caja es lo bastante grande en pantalla y, con un puntero con hover, si está cerca de una esquina
// (`near`, ver nearCorner). Con el dedo hace falta además el lado de dos zonas de impacto, como en hitHandle: en una
// forma menor el dedo en el centro caería en un tirador de radio en vez de en el cuerpo.
export function radiusVisible(
  corners: readonly [Point, Point, Point, Point],
  profile: Pick<InputProfile, 'kind' | 'handleHit' | 'showHoverOnly'>,
  near: boolean,
): boolean {
  const { width, height } = sides(corners);
  const min = profile.kind === 'touch' ? Math.max(RADIUS_MIN_SIDE_PX, 2 * profile.handleHit) : RADIUS_MIN_SIDE_PX;
  if (width < min || height < min) return false;
  return !profile.showHoverOnly || near;
}

export function nearCorner(corners: readonly Point[], x: number, y: number): boolean {
  return corners.some((corner) => Math.hypot(corner.x - x, corner.y - y) < RADIUS_HOVER_PX);
}

// La zona de cada tirador no llega al centro de la caja: con un radio grande (una pastilla) los tiradores se juntan en el
// centro y pulsar ahí debe mover la forma.
export function hitRadius(
  handles: readonly Point[],
  corners: readonly [Point, Point, Point, Point],
  x: number,
  y: number,
  profile: Pick<InputProfile, 'handleHit' | 'handleDraw'>,
): { index: number; distance: number } | null {
  const center = {
    x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
    y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4,
  };
  let best: { index: number; distance: number } | null = null;
  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i]!;
    const reach = Math.min(profile.handleHit / 2, Math.hypot(handle.x - center.x, handle.y - center.y) - profile.handleDraw / 2);
    const distance = Math.hypot(handle.x - x, handle.y - y);
    if (reach > 0 && distance <= reach && (!best || distance < best.distance)) best = { index: i, distance };
  }
  return best;
}

// Puntos medios de una polilínea en pantalla: uno por vano entre dos vértices editables consecutivos (`knots`, índices
// de `points`), a mitad de su longitud por el propio recorrido (en una curva cae sobre ella). Los vanos de menos de
// `minLength` px no llevan, para no tapar los vértices.
export function pathMids(points: readonly Point[], knots: readonly number[], minLength: number): Array<Point & { segment: number }> {
  const mids: Array<Point & { segment: number }> = [];
  for (let k = 0; k + 1 < knots.length; k++) {
    const from = knots[k]!;
    const to = knots[k + 1]!;
    let length = 0;
    for (let i = from; i < to; i++) length += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    if (length < minLength) continue;
    let left = length / 2;
    for (let i = from; i < to; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const step = Math.hypot(b.x - a.x, b.y - a.y);
      if (step >= left || i === to - 1) {
        const t = step > 0 ? Math.min(1, left / step) : 0;
        mids.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, segment: k });
        break;
      }
      left -= step;
    }
  }
  return mids;
}

// Tiradores de los tramos de un codo en pantalla. `axis` es el eje en el que se arrastra: un tramo horizontal se mueve
// en y. Los tramos de menos de `minLength` px no llevan, porque su tirador caería encima de un vértice.
export function elbowSegments(points: readonly Point[], minLength: number): Array<{ a: Point; b: Point; axis: 'x' | 'y'; index: number }> {
  const segments: Array<{ a: Point; b: Point; axis: 'x' | 'y'; index: number }> = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) < minLength) continue;
    segments.push({ a, b, axis: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'y' : 'x', index: i });
  }
  return segments;
}

export type LineHandleHit = { kind: 'vertex' | 'mid' | 'segment'; index: number } | null;

// Por prioridad: vértices, puntos medios y tramos de codo. Cada uno con su zona cuadrada de lado handleHit.
export function hitLineHandle(handles: LineHandles, x: number, y: number, profile: Pick<InputProfile, 'handleHit'>): LineHandleHit {
  const half = profile.handleHit / 2;
  const near = (p: Point) => Math.abs(p.x - x) <= half && Math.abs(p.y - y) <= half;
  const nearest = (points: readonly Point[]): number => {
    let index = -1;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      if (!near(points[i]!)) continue;
      const distance = Math.hypot(points[i]!.x - x, points[i]!.y - y);
      if (distance < best) {
        best = distance;
        index = i;
      }
    }
    return index;
  };
  const vertex = nearest(handles.vertices);
  if (vertex >= 0) return { kind: 'vertex', index: vertex };
  const mid = nearest(handles.mids);
  if (mid >= 0) return { kind: 'mid', index: mid };
  const segment = nearest(handles.segments.map(({ a, b }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })));
  if (segment >= 0) return { kind: 'segment', index: segment };
  return null;
}

// Cuadrilátero de la caja ampliado `margin` px hacia fuera por cada lado, siguiendo los ejes de la caja (también girada).
export function expandQuad(corners: readonly [Point, Point, Point, Point], margin: number): [Point, Point, Point, Point] {
  const [nw, ne, , sw] = corners;
  let u = unit(ne.x - nw.x, ne.y - nw.y);
  let v = unit(sw.x - nw.x, sw.y - nw.y);
  // Una caja de lado 0 (una línea recta) no tiene uno de los ejes: se toma la perpendicular del otro.
  if (!u && v) u = { x: -v.y, y: v.x };
  if (!v && u) v = { x: -u.y, y: u.x };
  const a = u ?? { x: 1, y: 0 };
  const b = v ?? { x: 0, y: 1 };
  const move = (p: Point, su: number, sv: number): Point => ({ x: p.x + (a.x * su + b.x * sv) * margin, y: p.y + (a.y * su + b.y * sv) * margin });
  return [move(corners[0], -1, -1), move(corners[1], 1, -1), move(corners[2], 1, 1), move(corners[3], -1, 1)];
}

function unit(x: number, y: number): Point | null {
  const length = Math.hypot(x, y);
  return length > 1e-9 ? { x: x / length, y: y / length } : null;
}

export function insideQuad(corners: readonly Point[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

const CURSORS: Record<HandleKind, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const CURSOR_NAMES = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

// Cursor de redimensión según el ángulo real del handle en pantalla.
export function resizeCursor(kind: HandleKind, angle: number): string {
  const degrees = (CURSORS[kind] + (angle * 180) / Math.PI + 360 * 4) % 180;
  return CURSOR_NAMES[Math.round(degrees / 45) % 4]!;
}
