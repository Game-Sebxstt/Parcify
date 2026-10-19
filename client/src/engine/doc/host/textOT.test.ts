import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../../bench/fixtures/random.ts';
import { applyPrims, del, ins, transformCaret, xform, type Prim } from './textOT.ts';

// A después de B': lo que haría el principal. B después de A': lo que haría el host.
function converge(value: string, a: Prim[], b: Prim[]) {
  const [a2, b2] = xform(a, b);
  return { left: applyPrims(applyPrims(value, a), b2), right: applyPrims(applyPrims(value, b), a2), a2, b2 };
}

describe('transformación de texto', () => {
  it('ins contra ins: con la misma posición va primero la del host', () => {
    expect(xform([ins(2, 'a')], [ins(1, 'xy')])[0]).toEqual([ins(4, 'a')]);
    expect(xform([ins(2, 'a')], [ins(2, 'xy')])[0]).toEqual([ins(4, 'a')]);
    expect(xform([ins(2, 'a')], [ins(3, 'xy')])[0]).toEqual([ins(2, 'a')]);
    expect(converge('hola', [ins(2, 'A')], [ins(2, 'B')]).left).toBe('hoBAla');
  });

  it('ins contra del: antes, después y dentro del borrado', () => {
    expect(xform([ins(1, 's')], [del(2, 2)])[0]).toEqual([ins(1, 's')]);
    expect(xform([ins(5, 's')], [del(2, 2)])[0]).toEqual([ins(3, 's')]);
    expect(xform([ins(3, 's')], [del(2, 2)])[0]).toEqual([ins(2, 's')]);
  });

  it('del contra ins: lo insertado dentro del tramo se conserva', () => {
    expect(xform([del(1, 2)], [ins(4, 'u')])[0]).toEqual([del(1, 2)]);
    expect(xform([del(2, 2)], [ins(1, 'uu')])[0]).toEqual([del(4, 2)]);
    expect(xform([del(1, 4)], [ins(3, 'uu')])[0]).toEqual([del(1, 2), del(3, 2)]);
    expect(converge('abcdef', [del(1, 4)], [ins(3, 'XY')]).left).toBe('aXYf');
  });

  it('del contra del: sin solapar y solapados', () => {
    expect(xform([del(1, 2)], [del(4, 1)])[0]).toEqual([del(1, 2)]);
    expect(xform([del(4, 2)], [del(0, 2)])[0]).toEqual([del(2, 2)]);
    expect(xform([del(1, 4)], [del(2, 4)])[0]).toEqual([del(1, 1)]);
    expect(xform([del(2, 2)], [del(1, 4)])[0]).toEqual([]);
  });

  it('el caret sigue a las inserciones y cae al inicio de un borrado que lo contiene', () => {
    expect(transformCaret(3, [ins(3, 'ab')])).toBe(5);
    expect(transformCaret(3, [ins(4, 'ab')])).toBe(3);
    expect(transformCaret(2, [del(2, 2)])).toBe(2);
    expect(transformCaret(5, [del(2, 2)])).toBe(3);
    expect(transformCaret(3, [del(2, 2)])).toBe(2);
  });

  it('convergen con listas aleatorias y ningún índice sale de rango', () => {
    const random = mulberry32(42);
    const int = (max: number) => Math.floor(random() * (max + 1));
    const letters = 'abcdefghij';
    const randomOps = (value: string): Prim[] => {
      const ops: Prim[] = [];
      let current = value;
      for (let n = 1 + int(2); n > 0; n--) {
        if (current.length && random() < 0.5) {
          const p = int(current.length - 1);
          const prim = del(p, 1 + int(current.length - p - 1));
          ops.push(prim);
          current = applyPrims(current, [prim]);
        } else {
          const prim = ins(int(current.length), letters.slice(0, 1 + int(2)));
          ops.push(prim);
          current = applyPrims(current, [prim]);
        }
      }
      return ops;
    };
    const inRange = (value: string, ops: Prim[]) => {
      let current = value;
      for (const prim of ops) {
        if (prim.p < 0 || prim.p > current.length || (prim.t === 'del' && prim.p + prim.n > current.length)) return false;
        current = applyPrims(current, [prim]);
      }
      return true;
    };
    for (let i = 0; i < 20_000; i++) {
      const value = letters.slice(0, int(10));
      const a = randomOps(value);
      const b = randomOps(value);
      const { left, right, a2, b2 } = converge(value, a, b);
      expect(left).toBe(right);
      expect(inRange(applyPrims(value, b), a2)).toBe(true);
      expect(inRange(applyPrims(value, a), b2)).toBe(true);
    }
  });
});
