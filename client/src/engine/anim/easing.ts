import type { Keyframe } from '../../shared/document/schema.js';

export type Easing = Keyframe['e'];
export type EaseFn = (x: number) => number;

const SAMPLES = 64;
const SAMPLE_STEP = 1 / (SAMPLES - 1);
const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const BISECTION_PRECISION = 1e-7;
const BISECTION_ITERATIONS = 12;

const coefA = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
const coefB = (a1: number, a2: number) => 3 * a2 - 6 * a1;
const coefC = (a1: number) => 3 * a1;
// Coordenada de la curva para el parámetro t (con P0 = 0 y P3 = 1).
const bezier = (t: number, a1: number, a2: number) => ((coefA(a1, a2) * t + coefB(a1, a2)) * t + coefC(a1)) * t;
const slope = (t: number, a1: number, a2: number) => 3 * coefA(a1, a2) * t * t + 2 * coefB(a1, a2) * t + coefC(a1);

const linear: EaseFn = (x) => x;

// cubic-bezier(x1, y1, x2, y2) como en CSS. x(t) se invierte con una tabla de 64 muestras que da el punto de partida,
// Newton-Raphson donde la pendiente lo permite y bisección donde la curva es casi plana.
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  if (x1 === y1 && x2 === y2) return linear;
  const table = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) table[i] = bezier(i * SAMPLE_STEP, x1, x2);

  const parameterFor = (x: number): number => {
    let start = 0;
    let sample = 1;
    for (; sample !== SAMPLES - 1 && table[sample]! <= x; sample++) start += SAMPLE_STEP;
    sample--;
    const span = table[sample + 1]! - table[sample]!;
    let guess = start + (span > 0 ? (x - table[sample]!) / span : 0) * SAMPLE_STEP;
    const initialSlope = slope(guess, x1, x2);
    if (initialSlope >= NEWTON_MIN_SLOPE) {
      for (let i = 0; i < NEWTON_ITERATIONS; i++) {
        const s = slope(guess, x1, x2);
        if (s === 0) break;
        guess -= (bezier(guess, x1, x2) - x) / s;
      }
      return guess;
    }
    if (initialSlope === 0) return guess;
    let low = start;
    let high = start + SAMPLE_STEP;
    for (let i = 0; i < BISECTION_ITERATIONS; i++) {
      guess = low + (high - low) / 2;
      const error = bezier(guess, x1, x2) - x;
      if (Math.abs(error) <= BISECTION_PRECISION) break;
      if (error > 0) high = guess;
      else low = guess;
    }
    return guess;
  };

  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : bezier(parameterFor(x), y1, y2));
}

// Mantiene el valor del keyframe hasta el siguiente.
const step: EaseFn = (x) => (x >= 1 ? 1 : 0);

export const EASING_CURVES = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  easeOutBack: [0.34, 1.56, 0.64, 1],
} as const;

const PRESETS: Record<Exclude<Easing, readonly number[]>, EaseFn> = {
  linear,
  step,
  easeIn: cubicBezier(...EASING_CURVES.easeIn),
  easeOut: cubicBezier(...EASING_CURVES.easeOut),
  easeInOut: cubicBezier(...EASING_CURVES.easeInOut),
  easeOutBack: cubicBezier(...EASING_CURVES.easeOutBack),
};

const CUSTOM_CACHE_LIMIT = 256;
const custom = new Map<string, EaseFn>();

export function easingFn(easing: Easing): EaseFn {
  if (typeof easing === 'string') return PRESETS[easing] ?? linear;
  const key = easing.join(',');
  let fn = custom.get(key);
  if (!fn) {
    if (custom.size >= CUSTOM_CACHE_LIMIT) custom.clear();
    fn = cubicBezier(easing[0], easing[1], easing[2], easing[3]);
    custom.set(key, fn);
  }
  return fn;
}
