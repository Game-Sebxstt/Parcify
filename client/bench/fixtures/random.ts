// Generador pseudoaleatorio con semilla: el mismo número da siempre la misma secuencia.
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BENCH_IMAGE_SEED = 20261016;
export const BENCH_IMAGES = 200;
export const BENCH_IMAGE_SIZE = { w: 1600, h: 1200 } as const;
// Lado mayor de cada variante, como las genera el servidor (full es el original, con tope de 4096 px).
export const BENCH_VARIANTS = { thumb: 256, medium: 1024, full: 1600 } as const;

export function imageFile(index: number, variant: keyof typeof BENCH_VARIANTS): string {
  return `img-${String(index).padStart(3, '0')}-${variant}.png`;
}
