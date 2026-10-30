import type { AnimProp, Keyframe } from '../../shared/document/schema.js';

export const ANIMATION_PRESETS = ['aparecer', 'deslizar', 'escalar', 'rebote'] as const;
export type AnimationPresetId = (typeof ANIMATION_PRESETS)[number];

// 'base': el valor que el nodo tiene en el diseño (la opacidad del nodo, por ejemplo).
export type PresetKeyframe = { t: number; v: number | 'base'; e: Keyframe['e'] };

// Un efecto de un clic: las pistas que escribe y la duración de la iteración en la que caben sus keyframes.
export type AnimationPreset = { durationMs: number; tracks: Partial<Record<AnimProp, readonly PresetKeyframe[]>> };

export const PRESETS: Readonly<Record<AnimationPresetId, AnimationPreset>> = {
  aparecer: {
    durationMs: 400,
    tracks: {
      opacity: [
        { t: 0, v: 0, e: 'easeOut' },
        { t: 1, v: 'base', e: 'linear' },
      ],
    },
  },
  deslizar: {
    durationMs: 500,
    tracks: {
      offsetY: [
        { t: 0, v: 24, e: 'easeOut' },
        { t: 1, v: 0, e: 'linear' },
      ],
      opacity: [
        { t: 0, v: 0, e: 'easeOut' },
        { t: 1, v: 'base', e: 'linear' },
      ],
    },
  },
  escalar: {
    durationMs: 400,
    tracks: {
      scale: [
        { t: 0, v: 0.8, e: 'easeOutBack' },
        { t: 1, v: 1, e: 'linear' },
      ],
      // easeOutBack se pasaría de la opacidad del diseño a mitad de camino.
      opacity: [
        { t: 0, v: 0, e: 'easeOut' },
        { t: 1, v: 'base', e: 'linear' },
      ],
    },
  },
  rebote: {
    durationMs: 600,
    tracks: {
      offsetY: [
        { t: 0, v: 0, e: 'easeOut' },
        { t: 0.4, v: -16, e: 'easeIn' },
        { t: 1, v: 0, e: 'linear' },
      ],
    },
  },
};
