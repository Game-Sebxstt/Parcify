import { ANIM_PROPS, type Animation, type AnimProp } from '../../shared/document/schema.js';
import { easingFn, type EaseFn } from './easing.ts';
import { hexToOklab, mixOklab, oklabToHex, type Oklab } from './oklab.ts';

export const COLOR_PROPS: ReadonlySet<AnimProp> = new Set(['fill', 'stroke']);

type NumberTrack = { color: false; times: Float64Array; values: Float64Array; eases: EaseFn[] };
type ColorTrack = { color: true; times: Float64Array; values: Oklab[]; eases: EaseFn[] };
export type CompiledTrack = NumberTrack | ColorTrack;

export type CompiledAnimation = {
  duration: number;
  delay: number;
  loop: number;
  direction: Animation['direction'];
  // delay más todas las repeticiones; Infinity con loop 0.
  total: number;
  tracks: ReadonlyArray<readonly [AnimProp, CompiledTrack]>;
};

// Lo que la animación cambia sobre el nodo en un instante. offset y rotation se suman; scale, sx y sy multiplican
// (la escala de cada eje es scale·sx y scale·sy); opacity, fill y stroke son absolutos (undefined: la pista no
// existe). En un texto, fill es el color de la letra.
export type Pose = { dx: number; dy: number; rotation: number; scale: number; sx: number; sy: number; opacity?: number; fill?: string; stroke?: string };

export function effectiveDuration(animation: Pick<Animation, 'duration' | 'delay' | 'loop'>): number {
  return animation.loop === 0 ? Infinity : animation.delay + animation.duration * animation.loop;
}

// Keyframes ordenados por t (y por id para que todos los clientes elijan igual con t repetidos). El easing de un
// keyframe se aplica al tramo que empieza en él.
export function compileAnimation(animation: Animation): CompiledAnimation {
  const tracks: Array<[AnimProp, CompiledTrack]> = [];
  for (const prop of ANIM_PROPS) {
    const source = animation.tracks[prop];
    if (!source) continue;
    const entries = Object.entries(source).sort(([ka, a], [kb, b]) => a.t - b.t || (ka < kb ? -1 : ka > kb ? 1 : 0));
    if (!entries.length) continue;
    const times = Float64Array.from(entries, ([, keyframe]) => keyframe.t);
    const eases = entries.map(([, keyframe]) => easingFn(keyframe.e));
    if (COLOR_PROPS.has(prop)) {
      tracks.push([prop, { color: true, times, eases, values: entries.map(([, keyframe]) => hexToOklab(String(keyframe.v))) }]);
    } else {
      tracks.push([prop, { color: false, times, eases, values: Float64Array.from(entries, ([, keyframe]) => Number(keyframe.v)) }]);
    }
  }
  return { duration: animation.duration, delay: animation.delay, loop: animation.loop, direction: animation.direction, total: effectiveDuration(animation), tracks };
}

// Avance dentro de la iteración en curso (0..1) para un tiempo en ms desde el inicio de la reproducción. Al
// terminar se queda en el final de la última iteración (que con alternate y un número par de vueltas es 0).
export function progressAt(animation: Pick<CompiledAnimation, 'duration' | 'delay' | 'loop' | 'direction'>, time: number): number {
  if (time <= animation.delay) return 0;
  const cycles = (time - animation.delay) / animation.duration;
  const iterations = animation.loop === 0 ? Infinity : animation.loop;
  let iteration: number;
  let fraction: number;
  if (cycles >= iterations) {
    iteration = iterations - 1;
    fraction = 1;
  } else {
    iteration = Math.floor(cycles);
    fraction = cycles - iteration;
  }
  return animation.direction === 'alternate' && iteration % 2 === 1 ? 1 - fraction : fraction;
}

// Último keyframe con t ≤ p (-1 si p queda antes del primero).
function segmentAt(times: Float64Array, p: number): number {
  let low = 0;
  let high = times.length - 1;
  if (p < times[0]!) return -1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (times[mid]! <= p) low = mid;
    else high = mid - 1;
  }
  return low;
}

// Posición eased dentro del tramo k → k+1, o null si p está fuera de los tramos (valor fijo del extremo).
function easedAt(track: CompiledTrack, k: number, p: number): number | null {
  if (k < 0 || k >= track.times.length - 1) return null;
  const start = track.times[k]!;
  const span = track.times[k + 1]! - start;
  if (span <= 0) return 1;
  return track.eases[k]!((p - start) / span);
}

export function sampleNumber(track: NumberTrack, p: number): number {
  const k = segmentAt(track.times, p);
  const eased = easedAt(track, k, p);
  if (eased === null) return track.values[k < 0 ? 0 : k]!;
  const from = track.values[k]!;
  return from + (track.values[k + 1]! - from) * eased;
}

export function sampleColor(track: ColorTrack, p: number): string {
  const k = segmentAt(track.times, p);
  const eased = easedAt(track, k, p);
  if (eased === null) return oklabToHex(track.values[k < 0 ? 0 : k]!);
  return oklabToHex(mixOklab(track.values[k]!, track.values[k + 1]!, eased));
}

export function poseAt(animation: CompiledAnimation, time: number): Pose {
  return poseAtProgress(animation, progressAt(animation, time));
}

// Pose para un avance p (0..1) dentro de una iteración.
export function poseAtProgress(animation: CompiledAnimation, p: number): Pose {
  const pose: Pose = { dx: 0, dy: 0, rotation: 0, scale: 1, sx: 1, sy: 1 };
  for (const [prop, track] of animation.tracks) {
    if (track.color) {
      pose[prop as 'fill' | 'stroke'] = sampleColor(track, p);
      continue;
    }
    const value = sampleNumber(track, p);
    switch (prop) {
      case 'offsetX':
        pose.dx = value;
        break;
      case 'offsetY':
        pose.dy = value;
        break;
      case 'rotation':
        pose.rotation = value;
        break;
      case 'scale':
        pose.scale = value;
        break;
      case 'scaleX':
        pose.sx = value;
        break;
      case 'scaleY':
        pose.sy = value;
        break;
      case 'opacity':
        pose.opacity = Math.min(1, Math.max(0, value));
        break;
    }
  }
  return pose;
}
