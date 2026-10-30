import type { KeyframeClip } from '../../../engine/index.ts';

// Portapapeles de keyframes en memoria, compartido por las líneas de tiempo de la pestaña. No usa el del sistema:
// ese sigue siendo el de los nodos del lienzo.
let clip: KeyframeClip | null = null;
const listeners = new Set<(clip: KeyframeClip | null) => void>();

export function keyframeClip(): KeyframeClip | null {
  return clip;
}

export function setKeyframeClip(next: KeyframeClip | null) {
  clip = next;
  for (const run of listeners) run(clip);
}

export function onKeyframeClip(run: (clip: KeyframeClip | null) => void): () => void {
  listeners.add(run);
  run(clip);
  return () => listeners.delete(run);
}
