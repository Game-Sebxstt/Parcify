import type { Mat } from './matrix.ts';
import type { ImageRecord } from '../types.ts';

export type Rect = { x: number; y: number; w: number; h: number };
export type Crop = { x: number; y: number; w: number; h: number };

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

// Dónde se dibuja la imagen dentro de la caja (0..w, 0..h): `area` es lo que se rellena (con las esquinas
// redondeadas) e `image` es dónde cae la parte recortada entera, que con `cover` se sale de la caja.
export function imagePlacement(record: Pick<ImageRecord, 'w' | 'h' | 'fit' | 'crop'>, textureWidth: number, textureHeight: number): { area: Rect; image: Rect } {
  const box = { x: 0, y: 0, w: record.w, h: record.h };
  const crop = record.crop ?? FULL_CROP;
  if (record.fit === 'fill' || textureWidth <= 0 || textureHeight <= 0 || crop.w <= 0 || crop.h <= 0 || box.w <= 0 || box.h <= 0) {
    return { area: box, image: box };
  }
  const aspect = (textureWidth * crop.w) / (textureHeight * crop.h);
  const wider = aspect > box.w / box.h;
  if (record.fit === 'contain') {
    const image = wider ? { x: 0, y: (box.h - box.w / aspect) / 2, w: box.w, h: box.w / aspect } : { x: (box.w - box.h * aspect) / 2, y: 0, w: box.h * aspect, h: box.h };
    return { area: image, image };
  }
  const image = wider ? { x: (box.w - box.h * aspect) / 2, y: 0, w: box.h * aspect, h: box.h } : { x: 0, y: (box.h - box.w / aspect) / 2, w: box.w, h: box.w / aspect };
  return { area: box, image };
}

// Coordenadas de textura (0..1 de la textura entera) de cada punto del área, como afín sobre el punto normalizado
// a la caja del área (q en 0..1). Es lo que Pixi calcula en un relleno en espacio local con la inversa de la
// matriz del relleno.
export function textureAffine(area: Rect, image: Rect, crop: Crop = FULL_CROP): Mat {
  const kx = (area.w / image.w) * crop.w;
  const ky = (area.h / image.h) * crop.h;
  const tx = crop.x + ((area.x - image.x) / image.w) * crop.w;
  const ty = crop.y + ((area.y - image.y) / image.h) * crop.h;
  return [kx, 0, 0, ky, tx, ty];
}
