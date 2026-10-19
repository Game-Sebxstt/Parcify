import type { FontFamily } from '../../shared/document/schema.js';
import type { RenderableRecord } from '../types.ts';
import { DEFAULT_FONT } from './fonts.ts';

export const TEXT_MAX_TEXTURE_PX = 4096;
// Por encima, el texto solo se vuelve a rasterizar al entrar en pantalla.
export const LONG_TEXT_CHARS = 2_000;
export const TEXT_REFRESH_PER_FRAME = 20;
export const TEXT_ZOOM_SETTLE_MS = 200;
export const LABEL_PADDING = 8;
export const LABEL_DEFAULTS = { fontSize: 16, color: '#0B1220FF', align: 'center', vAlign: 'middle' } as const;
export const CONNECTOR_LABEL_WIDTH = 200;
// La etiqueta de un conector va sobre el fondo del lienzo, no sobre un relleno.
export const CONNECTOR_LABEL_COLOR = '#EEF2F6FF';

// Punto a mitad de longitud de una polilínea [x0, y0, x1, y1, …].
export function routeMidpoint(points: readonly number[]): { x: number; y: number } {
  if (points.length < 2) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 2; i < points.length; i += 2) total += Math.hypot(points[i]! - points[i - 2]!, points[i + 1]! - points[i - 1]!);
  let left = total / 2;
  for (let i = 2; i < points.length; i += 2) {
    const ax = points[i - 2]!;
    const ay = points[i - 1]!;
    const length = Math.hypot(points[i]! - ax, points[i + 1]! - ay);
    if (length >= left && length > 0) {
      const t = left / length;
      return { x: ax + (points[i]! - ax) * t, y: ay + (points[i + 1]! - ay) * t };
    }
    left -= length;
  }
  return { x: points[0]!, y: points[1]! };
}

export type TextLayout = {
  content: string;
  family: FontFamily;
  size: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  // Ancho para partir líneas; null = sin partir (ancho automático).
  wrapWidth: number | null;
  // Caja del nodo y margen interior en coordenadas locales.
  box: { x: number; y: number; w: number; h: number };
};

export function textResolution(zoom: number, dpr: number): number {
  return Math.min(4, Math.max(1, zoom * dpr));
}

// Resolución con el tope de textura por lado.
export function cappedResolution(resolution: number, width: number, height: number): number {
  const side = Math.max(width, height, 1);
  return Math.max(0.05, Math.min(resolution, TEXT_MAX_TEXTURE_PX / side));
}

// Cómo se pinta el texto de un nodo; null si no tiene.
export function layoutOf(record: RenderableRecord, content: string): TextLayout | null {
  if (record.type === 'text') {
    return {
      content,
      family: record.fontFamily,
      size: record.fontSize,
      weight: record.fontWeight,
      italic: record.italic,
      underline: record.underline,
      strike: record.strike,
      color: record.color,
      align: record.align,
      vAlign: 'top',
      lineHeight: record.lineHeight,
      wrapWidth: record.autoWidth ? null : Math.max(1, record.w),
      box: { x: 0, y: 0, w: record.w, h: record.h },
    };
  }
  if (record.type === 'line' || record.type === 'image' || content.length === 0) return null;
  if (record.type === 'connector') {
    // La etiqueta se centra en la mitad del recorrido, que ya está en coordenadas de mundo.
    const mid = routeMidpoint(record.path ?? []);
    const size = record.labelFontSize ?? LABEL_DEFAULTS.fontSize;
    const w = CONNECTOR_LABEL_WIDTH;
    return {
      content,
      family: DEFAULT_FONT,
      size,
      weight: 500,
      italic: false,
      underline: false,
      strike: false,
      color: record.labelColor ?? CONNECTOR_LABEL_COLOR,
      align: record.labelAlign ?? 'center',
      vAlign: 'middle',
      lineHeight: 1.25,
      wrapWidth: w,
      box: { x: mid.x - w / 2, y: mid.y - size, w, h: size * 2 },
    };
  }
  const pad = Math.min(LABEL_PADDING, record.w / 4);
  return {
    content,
    family: DEFAULT_FONT,
    size: record.labelFontSize ?? LABEL_DEFAULTS.fontSize,
    weight: 500,
    italic: false,
    underline: false,
    strike: false,
    color: record.labelColor ?? LABEL_DEFAULTS.color,
    align: record.labelAlign ?? LABEL_DEFAULTS.align,
    vAlign: record.labelVAlign ?? LABEL_DEFAULTS.vAlign,
    lineHeight: 1.25,
    wrapWidth: Math.max(1, record.w - pad * 2),
    box: { x: pad, y: 0, w: Math.max(1, record.w - pad * 2), h: record.h },
  };
}

export function layoutKey(layout: TextLayout): string {
  const b = layout.box;
  return `${layout.family}|${layout.size}|${layout.weight}|${layout.italic}|${layout.underline}|${layout.strike}|${layout.color}|${layout.align}|${layout.vAlign}|${layout.lineHeight}|${layout.wrapWidth}|${b.x},${b.y},${b.w},${b.h}|${layout.content}`;
}

export const ALIGN_FACTOR = { left: 0, center: 0.5, right: 1, top: 0, middle: 0.5, bottom: 1 } as const;
