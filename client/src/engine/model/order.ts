import { generateNKeysBetween } from 'fractional-indexing';
import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';

export type Ordered = { readonly id: string; readonly index: string };

// Orden lexicográfico por código de carácter de (index, id); el id desempata índices iguales.
export function compareOrder(a: Ordered, b: Ordered): number {
  if (a.index !== b.index) return a.index < b.index ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function needsReindex(keys: Iterable<string>): boolean {
  for (const key of keys) if (key.length > DOCUMENT_LIMITS.maxIndexLength) return true;
  return false;
}

// Claves nuevas para todos los hermanos, conservando el orden actual.
export function reindex(sorted: readonly Ordered[]): Map<string, string> {
  const keys = generateNKeysBetween(null, null, sorted.length);
  return new Map(sorted.map((item, i) => [item.id, keys[i]!]));
}

// Clave entre dos vecinos. Si comparten índice (colisión concurrente) no hay hueco y se devuelve null.
export function keyBetween(before: string | null, after: string | null): string | null {
  return keysBetween(before, after, 1)?.[0] ?? null;
}

// Una clave remota mal formada hace fallar a fractional-indexing: en ese caso también se reindexa.
export function keysBetween(before: string | null, after: string | null, count: number): string[] | null {
  if (count === 0) return [];
  if (before !== null && after !== null && before >= after) return null;
  try {
    return generateNKeysBetween(before, after, count);
  } catch {
    return null;
  }
}

export type ZMove = 'front' | 'back' | 'forward' | 'backward';

// Nuevos índices para mover `ids` dentro de `siblings` (ordenados). Si no hay hueco, reindexa a todos.
export function zOrderIndexes(siblings: readonly Ordered[], ids: ReadonlySet<string>, move: ZMove): Map<string, string> {
  const moving = siblings.filter((item) => ids.has(item.id));
  if (moving.length === 0) return new Map();
  const rest = siblings.filter((item) => !ids.has(item.id));

  let insertAt: number;
  if (move === 'front') insertAt = rest.length;
  else if (move === 'back') insertAt = 0;
  else if (move === 'forward') {
    const lastPos = siblings.findIndex((item) => item.id === moving.at(-1)!.id);
    const nextOther = siblings.slice(lastPos + 1).find((item) => !ids.has(item.id));
    insertAt = nextOther ? rest.indexOf(nextOther) + 1 : rest.length;
  } else {
    const firstPos = siblings.findIndex((item) => item.id === moving[0]!.id);
    const prevOther = [...siblings.slice(0, firstPos)].reverse().find((item) => !ids.has(item.id));
    insertAt = prevOther ? rest.indexOf(prevOther) : 0;
  }

  const before = rest[insertAt - 1]?.index ?? null;
  const after = rest[insertAt]?.index ?? null;
  const keys = keysBetween(before, after, moving.length);
  // Una clave de más de 64 caracteres entre los hermanos también obliga a reindexar a todo el padre.
  if (keys && !needsReindex(keys) && !needsReindex(siblings.map((item) => item.index))) return new Map(moving.map((item, i) => [item.id, keys[i]!]));

  const target = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  return reindex(target);
}

// Claves para añadir `count` nodos encima de todo. Si no caben sin reindexar, devuelve también los índices nuevos de los hermanos.
export function keysOnTop(sorted: readonly Ordered[], count: number): { keys: string[]; reindexed: Map<string, string> | null } {
  const keys = keysBetween(sorted.at(-1)?.index ?? null, null, count);
  if (keys && !needsReindex(keys) && !needsReindex(sorted.map((item) => item.index))) return { keys, reindexed: null };
  const all = generateNKeysBetween(null, null, sorted.length + count);
  return {
    keys: all.slice(sorted.length),
    reindexed: new Map(sorted.map((item, i) => [item.id, all[i]!])),
  };
}
