import type { KeyRef } from '../../../engine/index.ts';
import type { AnimProp } from '../../../shared/document/schema.js';

// Los ids de nodo y de keyframe no llevan «:», así que `nodeId:prop:key` identifica un keyframe sin ambigüedad.
export const refId = (ref: KeyRef) => `${ref.nodeId}:${ref.prop}:${ref.key}`;

export function parseRefId(id: string): KeyRef {
  const [nodeId = '', prop = '', key = ''] = id.split(':');
  return { nodeId, prop: prop as AnimProp, key };
}

// Rectángulo de la marquesina en coordenadas de la rejilla (px desde el inicio de las pistas y desde la primera fila).
export type Marquee = { x0: number; y0: number; x1: number; y1: number };

const unique = (ids: Iterable<string>): readonly string[] => [...new Set(ids)];

// Keyframes seleccionados en la línea de tiempo, como `nodeId:prop:key` sin repetir. Es estado de la interfaz: no va
// al documento ni se comparte. Se sustituye entero en cada cambio.
export class KeyframeSelection {
  ids = $state.raw<readonly string[]>([]);
  marquee = $state.raw<Marquee | null>(null);

  get size() {
    return this.ids.length;
  }

  has(ref: KeyRef) {
    return this.ids.includes(refId(ref));
  }

  refs(): KeyRef[] {
    return this.ids.map(parseRefId);
  }

  set(refs: Iterable<KeyRef>) {
    this.ids = unique([...refs].map(refId));
  }

  add(refs: Iterable<KeyRef>) {
    this.ids = unique([...this.ids, ...[...refs].map(refId)]);
  }

  // Suma el keyframe o lo quita si ya estaba. Devuelve si queda seleccionado.
  toggle(ref: KeyRef): boolean {
    const id = refId(ref);
    const added = !this.ids.includes(id);
    this.ids = added ? [...this.ids, id] : this.ids.filter((other) => other !== id);
    return added;
  }

  clear() {
    if (this.ids.length) this.ids = [];
  }
}
