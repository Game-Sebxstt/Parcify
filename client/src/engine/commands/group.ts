import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import { localMatrix } from '../geometry/bounds.ts';
import { compose, invert, multiply, normalizeAngle, type Mat } from '../geometry/matrix.ts';
import { transformPatch } from '../geometry/transform.ts';
import type { GroupRecord, NodeRecord } from '../types.ts';

const round = (value: number) => Math.round(Math.max(-DOCUMENT_LIMITS.maxCoordinate, Math.min(DOCUMENT_LIMITS.maxCoordinate, value)) * 1000) / 1000;

// Un grupo no tiene caja: `x`, `y` y `rotation` son el origen y el giro del sistema de sus hijos. `matrix` está en
// el sistema del padre del grupo y debe ser rígida (girar y trasladar).
export function groupPatch(record: GroupRecord, matrix: Readonly<Mat>): { x: number; y: number; rotation: number } {
  const next = multiply(matrix, localMatrix(record));
  return { x: round(next[4]), y: round(next[5]), rotation: normalizeAngle(Math.atan2(next[1], next[0])) };
}

// Vuelve a expresar un nodo cuando cambia el sistema en el que se miden sus coordenadas: `change` lleva el sistema
// viejo al nuevo (nuevo⁻¹ · viejo). Los extremos y la caja de los conectores se calculan aparte.
export function reexpressPatch(record: NodeRecord, change: Readonly<Mat>): Record<string, unknown> {
  if (record.type === 'group') return groupPatch(record, change);
  if (record.type === 'connector') return {};
  return transformPatch(record, change, null);
}

// Matriz que lleva el sistema `from` al sistema `to` (cualquiera de los dos puede ser la página, null).
export function changeOfBasis(from: Readonly<Mat> | null, to: Readonly<Mat> | null): Mat {
  if (!to) return from ? ([...from] as Mat) : [1, 0, 0, 1, 0, 0];
  return from ? compose(invert(to), from) : invert(to);
}
