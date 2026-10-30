import { arrowheadPadding } from './arrowheads.ts';
import { multiply, translation, type Mat } from './matrix.ts';
import { emptyAABB, type AABB, type NodeRecord } from '../types.ts';

// Lleva las coordenadas locales de la caja (0..w, 0..h) al sistema del padre. Gira alrededor del centro.
export function localMatrix(record: Pick<NodeRecord, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'flipX' | 'flipY'>): Mat {
  const hw = record.w / 2;
  const hh = record.h / 2;
  const flipX = record.flipX ? -1 : 1;
  const flipY = record.flipY ? -1 : 1;
  if (record.rotation === 0 && flipX === 1 && flipY === 1) return translation(record.x, record.y);
  // T(x + w/2, y + h/2) · R(rotation) · S(flipX, flipY) · T(-w/2, -h/2) desarrollada, sin matrices intermedias.
  const cos = Math.cos(record.rotation);
  const sin = Math.sin(record.rotation);
  const a = cos * flipX;
  const b = sin * flipX;
  const c = -sin * flipY;
  const d = cos * flipY;
  return [a, b, c, d, a * -hw + c * -hh + (record.x + hw), b * -hw + d * -hh + (record.y + hh)];
}

export function worldMatrixOf(record: NodeRecord, parentWorld: Readonly<Mat> | null): Mat {
  const local = localMatrix(record);
  return parentWorld ? multiply(parentWorld, local) : local;
}

// Margen que añaden el trazo, los extremos de línea y la sombra a la caja geométrica.
export function paintPadding(record: NodeRecord): number {
  let pad = 0;
  if ('strokeWidth' in record && record.stroke) pad = record.strokeWidth / 2;
  if ((record.type === 'line' || record.type === 'connector') && (record.startCap !== 'none' || record.endCap !== 'none')) {
    pad = Math.max(pad, arrowheadPadding(record.strokeWidth));
  }
  if ('shadow' in record && record.shadow) {
    pad += Math.max(Math.abs(record.shadow.x), Math.abs(record.shadow.y)) + record.shadow.blur;
  }
  return pad;
}

export function localPoints(record: NodeRecord): number[] {
  if (record.type === 'line') return record.points.flat();
  return [0, 0, record.w, 0, record.w, record.h, 0, record.h];
}

export function transformedAABB(points: readonly number[], matrix: Readonly<Mat>, pad = 0): AABB {
  const box = emptyAABB();
  for (let i = 0; i < points.length; i += 2) extendBy(box, matrix, points[i]!, points[i + 1]!);
  return padAABB(box, pad);
}

function extendBy(box: AABB, m: Readonly<Mat>, px: number, py: number): void {
  const x = m[0] * px + m[2] * py + m[4];
  const y = m[1] * px + m[3] * py + m[5];
  if (x < box.minX) box.minX = x;
  if (y < box.minY) box.minY = y;
  if (x > box.maxX) box.maxX = x;
  if (y > box.maxY) box.maxY = y;
}

function padAABB(box: AABB, pad: number): AABB {
  box.minX -= pad;
  box.minY -= pad;
  box.maxX += pad;
  box.maxY += pad;
  return box;
}

// AABB de mundo con trazo y sombra: es lo que entra en el índice espacial.
export function paintedAABB(record: NodeRecord, world: Readonly<Mat>): AABB {
  return padAABB(geometryAABB(record, world), paintPadding(record));
}

// La caja pintada es la geométrica con el margen de trazo y sombra.
export function paintedFromGeometry(record: NodeRecord, geometry: Readonly<AABB>): AABB {
  return padAABB({ minX: geometry.minX, minY: geometry.minY, maxX: geometry.maxX, maxY: geometry.maxY }, paintPadding(record));
}

// Caja geométrica de mundo, sin trazo: la usan la selección y el snapping.
export function geometryAABB(record: NodeRecord, world: Readonly<Mat>): AABB {
  if (record.type === 'line') return transformedAABB(localPoints(record), world);
  const box = emptyAABB();
  extendBy(box, world, 0, 0);
  extendBy(box, world, record.w, 0);
  extendBy(box, world, record.w, record.h);
  extendBy(box, world, 0, record.h);
  return box;
}

// Matriz y cajas de una hoja calculadas enteras, con la posición y el giro de entonces. pad: margen de trazo y
// sombra, que las claves rápidas no cambian.
export type Placement = { x: number; y: number; rotation: number; world: Readonly<Mat>; geometry: Readonly<AABB>; pad: number };

// Posición nueva de una hoja con el mismo giro, el mismo tamaño y el mismo padre: el desplazamiento local, llevado a
// mundo por la parte lineal del padre, mueve la matriz y las cajas sin recalcularlas.
export function translatedPlacement(base: Placement, record: Pick<NodeRecord, 'x' | 'y'>, parentWorld: Readonly<Mat> | null): { world: Mat; geometry: AABB; painted: AABB } {
  const dx = record.x - base.x;
  const dy = record.y - base.y;
  const ex = parentWorld ? parentWorld[0] * dx + parentWorld[2] * dy : dx;
  const ey = parentWorld ? parentWorld[1] * dx + parentWorld[3] * dy : dy;
  const w = base.world;
  const g = base.geometry;
  const geometry = { minX: g.minX + ex, minY: g.minY + ey, maxX: g.maxX + ex, maxY: g.maxY + ey };
  const pad = base.pad;
  return {
    world: [w[0], w[1], w[2], w[3], w[4] + ex, w[5] + ey],
    geometry,
    painted: { minX: geometry.minX - pad, minY: geometry.minY - pad, maxX: geometry.maxX + pad, maxY: geometry.maxY + pad },
  };
}

export function bboxOfPoints(points: ReadonlyArray<readonly [number, number]>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
