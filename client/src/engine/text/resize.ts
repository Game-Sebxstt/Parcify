import { localMatrix } from '../geometry/bounds.ts';
import type { Mat } from '../geometry/matrix.ts';
import type { NodeRecord, TextRecord } from '../types.ts';

export const TEXT_FONT_MIN = 4;
export const TEXT_FONT_MAX = 800;

// Auto-ancho: la caja sigue al contenido. Auto-alto: ancho fijo y alto según el contenido. Fijo: no se mide nada.
export type TextSizeMode = 'auto-width' | 'auto-height' | 'fixed';

export function textSizeMode(record: Pick<TextRecord, 'autoWidth' | 'fixedHeight'>): TextSizeMode {
  if (record.autoWidth) return 'auto-width';
  return record.fixedHeight ? 'fixed' : 'auto-height';
}

// Banderas del esquema de cada modo (fixedHeight undefined se borra del registro).
export function textModeFlags(mode: TextSizeMode): { autoWidth: boolean; fixedHeight: true | undefined } {
  return { autoWidth: mode === 'auto-width', fixedHeight: mode === 'fixed' ? true : undefined };
}

// Tamaño de fuente escalado por `s`, en medios puntos y dentro de los límites del esquema.
export function scaledFontSize(fontSize: number, s: number): number {
  return Math.max(TEXT_FONT_MIN, Math.min(TEXT_FONT_MAX, Math.round(fontSize * s * 2) / 2));
}

// Escala uniforme que equivale a una matriz: √|sx·sy|, la raíz del determinante de su parte lineal.
export function uniformScale(matrix: Readonly<Mat>): number {
  return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
}

// x e y de la caja con otro ancho y alto y la misma esquina de origen (0, 0) en el padre. El texto se pinta desde ahí,
// así que no se mueve aunque la caja esté girada (el giro es alrededor del centro).
export function keepOrigin(record: Pick<NodeRecord, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'flipX' | 'flipY'>, w: number, h: number): { x: number; y: number } {
  const m = localMatrix(record);
  const cx = m[4] + (m[0] * w + m[2] * h) / 2;
  const cy = m[5] + (m[1] * w + m[3] * h) / 2;
  return { x: cx - w / 2, y: cy - h / 2 };
}
