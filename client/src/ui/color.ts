// Conversión de colores del selector. El documento guarda #RRGGBBAA en mayúsculas (ColorSchema).

export type Rgba = { r: number; g: number; b: number; a: number };
// h en grados (0–360); s, v y a de 0 a 1.
export type Hsva = { h: number; s: number; v: number; a: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Acepta 6 u 8 dígitos hexadecimales, con o sin #.
export function parseHex(text: string): Rgba | null {
  const body = text.trim().replace(/^#/, '');
  if (!/^([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(body)) return null;
  const channel = (at: number) => parseInt(body.slice(at, at + 2), 16);
  return { r: channel(0), g: channel(2), b: channel(4), a: body.length === 8 ? channel(6) / 255 : 1 };
}

const byte = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

export function rgbaToHex({ r, g, b, a }: Rgba): string {
  return `#${byte(r)}${byte(g)}${byte(b)}${byte(clamp01(a) * 255)}`;
}

export function rgbToHsv({ r, g, b, a }: Rgba, fallbackHue = 0): Hsva {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const delta = max - Math.min(rn, gn, bn);
  let h = fallbackHue;
  if (delta > 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max, a };
}

export function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
  const hue = (((h % 360) + 360) % 360) / 60;
  const chroma = clamp01(v) * clamp01(s);
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = clamp01(v) - chroma;
  const [r, g, b] =
    hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}

// Sin saturación o sin brillo el tono no se puede leer del color: se conserva el que había.
export function hexToHsva(hex: string, fallbackHue = 0): Hsva | null {
  const rgba = parseHex(hex);
  return rgba ? rgbToHsv(rgba, fallbackHue) : null;
}

export function hsvaToHex(color: Hsva): string {
  return rgbaToHex(hsvToRgb(color));
}

// «RRGGBB» para el campo hexadecimal (la opacidad va en su propio campo).
export function hexDigits(hex: string): string {
  return hex.replace(/^#/, '').slice(0, 6).toUpperCase();
}

// Los colores que más se repiten, sin contar los totalmente transparentes.
export function topColors(colors: Iterable<string>, limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const color of colors) {
    const rgba = parseHex(color);
    if (!rgba || rgba.a === 0) continue;
    const key = rgbaToHex(rgba);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([color]) => color);
}

// Fondo de ajedrez para los colores con transparencia, con los tonos de la paleta.
export const CHECKER = 'repeating-conic-gradient(var(--color-edge) 0 25%, var(--color-ink-muted) 0 50%) 0 0 / 8px 8px';

export function swatchBackground(hex: string): string {
  return `linear-gradient(${hex}, ${hex}), ${CHECKER}`;
}
