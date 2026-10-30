export type RgbaColor = { color: number; alpha: number };

// DEFAULT_BACKGROUND de shared/document/init.ts, que no se importa aquí porque arrastra Yjs al motor.
// core-backend.test.ts comprueba que siguen siendo iguales.
export const DEFAULT_DOCUMENT_BACKGROUND = '#141416FF';

const cache = new Map<string, RgbaColor>();

// #RRGGBBAA (o #RRGGBB) → número RGB y alfa 0..1, como lo espera Pixi.
export function parseColor(hex: string): RgbaColor {
  const hit = cache.get(hex);
  if (hit) return hit;
  const body = hex.startsWith('#') ? hex.slice(1) : hex;
  const color = Number.parseInt(body.slice(0, 6), 16);
  const alpha = body.length >= 8 ? Number.parseInt(body.slice(6, 8), 16) / 255 : 1;
  const value = { color: Number.isFinite(color) ? color : 0, alpha: Number.isFinite(alpha) ? alpha : 1 };
  if (cache.size > 512) cache.clear();
  cache.set(hex, value);
  return value;
}

export function toHex8(color: string): string {
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return color.toUpperCase();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return `${color.toUpperCase()}FF`;
  return '#000000FF';
}
