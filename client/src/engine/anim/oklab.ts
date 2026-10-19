// L, a, b y alfa (0..1).
export type Oklab = [number, number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// #RRGGBBAA (o #RRGGBB) → OKLab.
export function hexToOklab(hex: string): Oklab {
  const body = hex.startsWith('#') ? hex.slice(1) : hex;
  const channel = (at: number) => {
    const value = Number.parseInt(body.slice(at, at + 2), 16);
    return Number.isFinite(value) ? value / 255 : 0;
  };
  const r = toLinear(channel(0));
  const g = toLinear(channel(2));
  const b = toLinear(channel(4));
  const alpha = body.length >= 8 ? channel(6) : 1;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha,
  ];
}

const byte = (value: number) => {
  const clamped = Math.round(Math.min(1, Math.max(0, value)) * 255);
  return clamped.toString(16).padStart(2, '0').toUpperCase();
};

// OKLab → #RRGGBBAA, recortando lo que queda fuera de sRGB.
export function oklabToHex([L, A, B, alpha]: Readonly<Oklab>): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return `#${byte(toGamma(r))}${byte(toGamma(g))}${byte(toGamma(b))}${byte(alpha)}`;
}

export function mixOklab(from: Readonly<Oklab>, to: Readonly<Oklab>, t: number): Oklab {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t, from[3] + (to[3] - from[3]) * t];
}
