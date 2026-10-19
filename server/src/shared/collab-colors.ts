// 12 tonos con la misma luminosidad (OKLCH L 0,72, C 0,13, cada 30°) y contraste ≥ 3:1 sobre el fondo oscuro.
export const COLLAB_COLORS = [
  '#EA808A',
  '#E7885D',
  '#D49838',
  '#B1A93A',
  '#80B761',
  '#3FBE90',
  '#00BDBE',
  '#22B5E1',
  '#6AA7F4',
  '#9D98F2',
  '#C38ADC',
  '#DE82B7',
] as const;

export type CollabColor = (typeof COLLAB_COLORS)[number];

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// Primer tono libre del proyecto; con los 12 ocupados, uno fijo por usuario.
export function pickCollabColor(userId: string, used: Iterable<string>): CollabColor {
  const taken = new Set([...used].map((color) => color.toUpperCase()));
  const free = COLLAB_COLORS.find((color) => !taken.has(color));
  return free ?? COLLAB_COLORS[hashString(userId) % COLLAB_COLORS.length]!;
}
