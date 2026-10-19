import { Matrix, type Container, type Graphics, type Texture } from 'pixi.js';
import { FULL_CROP, imagePlacement, textureAffine, type Rect } from '../../geometry/image.ts';
import type { ImageRecord } from '../../types.ts';

export type ImageSlot = { kind: 'ready'; texture: Texture } | { kind: 'loading' } | { kind: 'broken' };

const LOADING_COLOR = 0x1a2433;
const BROKEN_COLOR = 0x3a4556;
const BROKEN_ICON_COLOR = 0x8a96a8;

// Pixi calcula las coordenadas de textura de un relleno local como inversa(matriz)·q: la matriz es la inversa
// de la afín que se quiere.
function textureFillMatrix(area: Rect, image: Rect, crop: Rect): Matrix {
  const [a, b, c, d, tx, ty] = textureAffine(area, image, crop);
  return new Matrix(a, b, c, d, tx, ty).invert();
}

// Dibujo de un nodo imagen en el Graphics de su vista: la textura como relleno del rectángulo (redondeado si hace
// falta), un fondo mientras carga y un marcador gris con el icono de imagen rota si no se puede cargar.
export class ImageView {
  drawnKey = '';

  constructor(
    private readonly graphics: Graphics,
    private readonly root: Container,
  ) {}

  static keyOf(slot: ImageSlot): string {
    return slot.kind === 'ready' ? `ready:${slot.texture.uid}` : slot.kind;
  }

  draw(record: ImageRecord, slot: ImageSlot): void {
    const g = this.graphics;
    this.drawnKey = ImageView.keyOf(slot);
    // El texto alternativo acompaña a la vista; lo leen la accesibilidad y las herramientas de depuración.
    this.root.label = record.alt ?? '';
    if (slot.kind === 'ready') {
      const texture = slot.texture;
      const { area, image } = imagePlacement(record, texture.width, texture.height);
      const crop = record.crop ?? FULL_CROP;
      rounded(g, area, record.cornerRadius);
      g.fill({ texture, matrix: textureFillMatrix(area, image, crop), textureSpace: 'local', color: 0xffffff });
      return;
    }
    const box = { x: 0, y: 0, w: record.w, h: record.h };
    rounded(g, box, record.cornerRadius);
    g.fill({ color: slot.kind === 'broken' ? BROKEN_COLOR : LOADING_COLOR, alpha: 1 });
    if (slot.kind === 'broken') brokenIcon(g, box);
  }
}

function rounded(g: Graphics, area: Rect, radius: number): void {
  const r = Math.min(radius, area.w / 2, area.h / 2);
  if (r > 0) g.roundRect(area.x, area.y, area.w, area.h, r);
  else g.rect(area.x, area.y, area.w, area.h);
}

// Un marco con una montaña y un sol, partido por una diagonal.
function brokenIcon(g: Graphics, box: Rect): void {
  const size = Math.min(48, Math.min(box.w, box.h) * 0.4);
  if (size < 6) return;
  const x = box.x + (box.w - size) / 2;
  const y = box.y + (box.h - size * 0.8) / 2;
  const h = size * 0.8;
  const width = Math.max(1, size / 16);
  const style = { width, color: BROKEN_ICON_COLOR, alpha: 1, join: 'round' as const, cap: 'round' as const };
  g.rect(x, y, size, h).stroke(style);
  g.moveTo(x + size * 0.1, y + h * 0.85)
    .lineTo(x + size * 0.38, y + h * 0.45)
    .lineTo(x + size * 0.58, y + h * 0.7)
    .lineTo(x + size * 0.72, y + h * 0.55)
    .lineTo(x + size * 0.9, y + h * 0.85)
    .stroke(style);
  g.circle(x + size * 0.72, y + h * 0.28, size * 0.08).stroke(style);
  g.moveTo(x - size * 0.05, y + h * 1.05)
    .lineTo(x + size * 1.05, y - h * 0.05)
    .stroke({ ...style, width: width * 1.5 });
}
