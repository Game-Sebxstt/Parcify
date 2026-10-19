import { describe, expect, it } from 'vitest';
import { Selection } from './selection.svelte.ts';

const ORDER = ['a', 'b', 'c', 'd', 'e'];

describe('Selection', () => {
  it('un clic alterna un elemento y conserva el orden de la lista', () => {
    const selection = new Selection();
    selection.toggle('c', ORDER);
    selection.toggle('a', ORDER);
    expect(selection.ids).toEqual(['a', 'c']);
    selection.toggle('c', ORDER);
    expect(selection.ids).toEqual(['a']);
    expect(selection.size).toBe(1);
  });

  it('Shift+clic añade el tramo desde el último elemento pulsado, en los dos sentidos', () => {
    const selection = new Selection();
    selection.toggle('b', ORDER);
    selection.toggle('d', ORDER, { range: true });
    expect(selection.ids).toEqual(['b', 'c', 'd']);
    selection.clear();
    selection.toggle('e', ORDER);
    selection.toggle('c', ORDER, { range: true });
    expect(selection.ids).toEqual(['c', 'd', 'e']);
  });

  it('Shift+clic sin ancla se comporta como un clic', () => {
    const selection = new Selection();
    selection.toggle('d', ORDER, { range: true });
    expect(selection.ids).toEqual(['d']);
  });

  it('seleccionar todos y vaciar', () => {
    const selection = new Selection();
    selection.selectAll(ORDER);
    expect(selection.ids).toEqual(ORDER);
    selection.clear();
    expect(selection.size).toBe(0);
    expect(selection.has('a')).toBe(false);
  });

  it('al cambiar la lista olvida los ids que ya no están y el ancla perdida', () => {
    const selection = new Selection();
    selection.toggle('a', ORDER);
    selection.toggle('d', ORDER);
    selection.retain(['a', 'b', 'c']);
    expect(selection.ids).toEqual(['a']);
    selection.toggle('c', ['a', 'b', 'c'], { range: true });
    expect(selection.ids).toEqual(['a', 'c']);
  });
});
