import { apply, compose, rotation, translation, type Mat, type Point } from '../geometry/matrix.ts';
import type { HandleKind } from '../render/sink.ts';

// Caja de la selección: origen en mundo (esquina superior izquierda antes de girar), ángulo y tamaño.
export type SelectionFrame = { x: number; y: number; w: number; h: number; angle: number };

export const HANDLE_HIT_PX = 7;
export const ROTATE_ZONE_PX = 22;
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

// Posiciones de los 8 handles en pantalla a partir de las esquinas ya proyectadas.
export function handlePositions(corners: readonly [Point, Point, Point, Point]): Array<{ kind: HandleKind; x: number; y: number }> {
  const [nw, ne, se, sw] = corners;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const width = Math.hypot(ne.x - nw.x, ne.y - nw.y);
  const height = Math.hypot(sw.x - nw.x, sw.y - nw.y);
  const handles: Array<{ kind: HandleKind; x: number; y: number }> = [
    { kind: 'nw', ...nw },
    { kind: 'ne', ...ne },
    { kind: 'se', ...se },
    { kind: 'sw', ...sw },
  ];
  if (width >= MIN_EDGE_HANDLES_PX) handles.push({ kind: 'n', ...mid(nw, ne) }, { kind: 's', ...mid(sw, se) });
  if (height >= MIN_EDGE_HANDLES_PX) handles.push({ kind: 'e', ...mid(ne, se) }, { kind: 'w', ...mid(nw, sw) });
  return handles;
}

export type HandleHit = { kind: HandleKind } | { kind: 'rotate' } | null;

// Primero los handles de escala; después la zona de giro, fuera de las esquinas.
export function hitHandle(corners: readonly [Point, Point, Point, Point], x: number, y: number): HandleHit {
  for (const handle of handlePositions(corners)) {
    if (Math.abs(handle.x - x) <= HANDLE_HIT_PX && Math.abs(handle.y - y) <= HANDLE_HIT_PX) return { kind: handle.kind };
  }
  if (insideQuad(corners, x, y)) return null;
  for (const corner of corners) {
    if (Math.hypot(corner.x - x, corner.y - y) <= ROTATE_ZONE_PX) return { kind: 'rotate' };
  }
  return null;
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
