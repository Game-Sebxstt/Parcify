import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import { bboxOfPoints, localMatrix } from './bounds.ts';
import { apply, compose, invert, isTranslation, multiply, normalizeAngle, scaling, type Mat } from './matrix.ts';
import type { NodeRecord } from '../types.ts';

export const MIN_SIZE = 1;

export type TransformPatch = Partial<{
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  points: Array<[number, number]>;
  cornerRadius: number;
}>;

const clampCoord = (v: number) => Math.max(-DOCUMENT_LIMITS.maxCoordinate, Math.min(DOCUMENT_LIMITS.maxCoordinate, v));
const clampSize = (v: number, min = MIN_SIZE) => Math.max(min, Math.min(DOCUMENT_LIMITS.maxSize, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

// Matriz de mundo M expresada en el sistema del padre: P⁻¹ · M · P.
function inParentSpace(matrix: Readonly<Mat>, parentWorld: Readonly<Mat> | null): Mat {
  if (!parentWorld) return [...matrix] as Mat;
  return compose(invert(parentWorld), matrix, parentWorld);
}

// Traduce la matriz de un gesto (en mundo) a las propiedades persistidas del nodo.
export function transformPatch(record: NodeRecord, matrix: Readonly<Mat>, parentWorld: Readonly<Mat> | null = null): TransformPatch {
  const m = inParentSpace(matrix, parentWorld);

  if (record.type === 'line') return linePatch(record, m);

  if (isTranslation(m)) {
    return { x: round(clampCoord(record.x + m[4])), y: round(clampCoord(record.y + m[5])) };
  }

  // Caja unidad → padre, tras el gesto.
  const unit = multiply(multiply(m, localMatrix(record)), scaling(record.w || 1, record.h || 1));
  const fx = record.flipX ? -1 : 1;
  const colA = { x: unit[0], y: unit[1] };
  const colB = { x: unit[2], y: unit[3] };
  const width = Math.hypot(colA.x, colA.y) * (record.w === 0 ? 0 : 1);
  const angle = Math.atan2(colA.y * fx, colA.x * fx);
  const perp = { x: -Math.sin(angle), y: Math.cos(angle) };
  const signedHeight = (colB.x * perp.x + colB.y * perp.y) * (record.h === 0 ? 0 : 1);
  // La columna B de la caja unidad vale flipY·h·(−sen, cos): su signo es el volteo vertical resultante.
  const flipY = signedHeight < 0;
  const w = clampSize(width);
  const h = clampSize(Math.abs(signedHeight));
  const center = apply(unit, 0.5, 0.5);

  const patch: TransformPatch = {
    x: round(clampCoord(center.x - w / 2)),
    y: round(clampCoord(center.y - h / 2)),
    w: round(w),
    h: round(h),
    rotation: normalizeAngle(angle),
  };
  if (flipY !== Boolean(record.flipY)) patch.flipY = flipY;
  if ((record.type === 'rect' || record.type === 'image') && record.cornerRadius > Math.min(patch.w!, patch.h!) / 2) {
    patch.cornerRadius = Math.floor((Math.min(patch.w!, patch.h!) / 2) * 1000) / 1000;
  }
  return patch;
}

function linePatch(record: Extract<NodeRecord, { type: 'line' }>, m: Readonly<Mat>): TransformPatch {
  const local = localMatrix(record);
  const full = multiply(m, local);
  const absolute = record.points.map(([px, py]) => {
    const p = apply(full, px, py);
    return [p.x, p.y] as [number, number];
  });
  const box = bboxOfPoints(absolute);
  return {
    x: round(clampCoord(box.minX)),
    y: round(clampCoord(box.minY)),
    w: round(clampSize(box.maxX - box.minX, 0)),
    h: round(clampSize(box.maxY - box.minY, 0)),
    rotation: 0,
    flipX: false,
    flipY: false,
    points: absolute.map(([px, py]) => [round(px - box.minX), round(py - box.minY)] as [number, number]),
  };
}

export function applyPatch<T extends NodeRecord>(record: T, patch: TransformPatch): T {
  const next = { ...record, ...patch } as T;
  if (patch.flipX === false && !record.flipX) delete (next as { flipX?: boolean }).flipX;
  if (patch.flipY === false && !record.flipY) delete (next as { flipY?: boolean }).flipY;
  return next;
}
