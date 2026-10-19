// Transformación de ediciones de texto plano concurrentes. Una lista de primitivas se aplica en orden: cada índice
// es relativo al texto que dejan las anteriores.
export type Prim = { t: 'ins'; p: number; s: string } | { t: 'del'; p: number; n: number };

export const ins = (p: number, s: string): Prim => ({ t: 'ins', p, s });
export const del = (p: number, n: number): Prim => ({ t: 'del', p, n });

// `a` aplicada después de `b`, siendo las dos concurrentes sobre el mismo texto. `after`: con dos inserciones en la
// misma posición, la de `a` queda detrás de la de `b`.
function transformOne(a: Prim, b: Prim, after: boolean): Prim[] {
  if (a.t === 'ins') {
    if (b.t === 'ins') return b.p < a.p || (b.p === a.p && after) ? [ins(a.p + b.s.length, a.s)] : [a];
    if (a.p <= b.p) return [a];
    if (a.p >= b.p + b.n) return [ins(a.p - b.n, a.s)];
    // Dentro del tramo borrado: va al inicio del borrado y no se borra.
    return [ins(b.p, a.s)];
  }
  if (b.t === 'ins') {
    if (b.p >= a.p + a.n) return [a];
    if (b.p <= a.p) return [del(a.p + b.s.length, a.n)];
    // Lo insertado dentro del tramo se conserva: el borrado se parte en dos.
    return [del(a.p, b.p - a.p), del(a.p + b.s.length, a.n - (b.p - a.p))];
  }
  if (b.p >= a.p + a.n) return [a];
  if (b.p + b.n <= a.p) return [del(a.p - b.n, a.n)];
  const overlap = Math.min(a.p + a.n, b.p + b.n) - Math.max(a.p, b.p);
  const left = a.n - overlap;
  return left > 0 ? [del(Math.min(a.p, b.p), left)] : [];
}

// Transforma dos listas concurrentes: devuelve [A', B'] con A·B' = B·A'. `after` como en transformOne, para A.
export function xform(a: readonly Prim[], b: readonly Prim[], after = true): [Prim[], Prim[]] {
  if (a.length === 0 || b.length === 0) return [[...a], [...b]];
  if (a.length === 1 && b.length === 1) return [transformOne(a[0]!, b[0]!, after), transformOne(b[0]!, a[0]!, !after)];
  if (a.length > 1) {
    const [head, b1] = xform([a[0]!], b, after);
    const [rest, b2] = xform(a.slice(1), b1, after);
    return [[...head, ...rest], b2];
  }
  const [a1, head] = xform(a, [b[0]!], after);
  const [a2, rest] = xform(a1, b.slice(1), after);
  return [a2, [...head, ...rest]];
}

// Una posición del caret tras aplicar `prims` al texto en el que estaba.
export function transformCaret(caret: number, prims: readonly Prim[]): number {
  let c = caret;
  for (const prim of prims) {
    if (prim.t === 'ins') {
      if (prim.p <= c) c += prim.s.length;
    } else if (c > prim.p) {
      c = c >= prim.p + prim.n ? c - prim.n : prim.p;
    }
  }
  return c;
}

export function applyPrims(value: string, prims: readonly Prim[]): string {
  let out = value;
  for (const prim of prims) {
    const p = Math.max(0, Math.min(prim.p, out.length));
    out = prim.t === 'ins' ? out.slice(0, p) + prim.s + out.slice(p) : out.slice(0, p) + out.slice(p + prim.n);
  }
  return out;
}

// Primitivas de un delta de Y.Text (retain/insert/delete).
export function deltaToPrims(delta: ReadonlyArray<{ retain?: number; insert?: unknown; delete?: number }>): Prim[] {
  const prims: Prim[] = [];
  let at = 0;
  for (const part of delta) {
    if (part.retain !== undefined) at += part.retain;
    else if (typeof part.insert === 'string') {
      prims.push(ins(at, part.insert));
      at += part.insert.length;
    } else if (part.delete !== undefined) prims.push(del(at, part.delete));
  }
  return prims;
}

// Sustitución de [start, end) por `insert` como primitivas.
export function replacePrims(start: number, end: number, insert: string): Prim[] {
  const prims: Prim[] = [];
  if (end > start) prims.push(del(start, end - start));
  if (insert) prims.push(ins(start, insert));
  return prims;
}
