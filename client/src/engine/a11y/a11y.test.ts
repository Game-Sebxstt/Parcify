import { describe, expect, it } from 'vitest';
import { group, makeCore, newDoc, PAGE_ID, putNode, rect } from '../test-utils.ts';
import { describeSelection, displayName, type DescribeLabels } from './describe.ts';
import { ancestorsOf, LAYER_ROW_HEIGHT, layerRows, rowWindow } from './layers.ts';

const LABELS: DescribeLabels = {
  kind: (type) => ({ label: { rect: 'Rectángulo', ellipse: 'Elipse', image: 'Imagen', group: 'Grupo', arrow: 'Flecha' }[type as string] ?? type, feminine: ['ellipse', 'image', 'arrow'].includes(type) }),
  one: ({ what, w, h, page, feminine }) => `${what} ${feminine ? 'seleccionada' : 'seleccionado'}, ${w} por ${h}, en ${page}`,
  many: ({ count, page }) => `${count} elementos seleccionados en ${page}`,
  none: ({ page }) => `Nada seleccionado en ${page}`,
};

describe('árbol de capas', () => {
  it('con 1.000 nodos da una fila por nodo, lo de arriba primero, y solo se pinta el tramo visible', () => {
    const doc = newDoc();
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) ids.push(putNode(doc, rect({ x: i, index: `a${String(i).padStart(4, '0')}` })));
    const { core } = makeCore(doc);
    const rows = layerRows(core.tree, (id) => core.store.get(id), PAGE_ID, new Set());
    expect(rows).toHaveLength(1000);
    expect(rows[0]).toMatchObject({ id: ids[999], depth: 1, posInSet: 1, setSize: 1000 });
    expect(rows[999]).toMatchObject({ id: ids[0], posInSet: 1000 });
    const window = rowWindow(rows.length, 500 * LAYER_ROW_HEIGHT, 400);
    expect(window.start).toBeGreaterThan(480);
    expect(window.end - window.start).toBeLessThan(40);
    expect(rowWindow(rows.length, 0, 400).start).toBe(0);
    expect(rowWindow(rows.length, 1e9, 400).end).toBe(1000);
  });

  it('los contenedores se despliegan con sus hijos debajo y un nivel más', () => {
    const doc = newDoc();
    const g = putNode(doc, group({ index: 'a1' }));
    const a = putNode(doc, rect({ parentId: g, index: 'a0' }));
    const b = putNode(doc, rect({ parentId: g, index: 'a1' }));
    const root = putNode(doc, rect({ index: 'a0' }));
    const { core } = makeCore(doc);
    const get = (id: string) => core.store.get(id);
    expect(layerRows(core.tree, get, PAGE_ID, new Set()).map((row) => row.id)).toEqual([g, root]);
    const open = layerRows(core.tree, get, PAGE_ID, new Set([g]));
    expect(open.map((row) => [row.id, row.depth, row.posInSet, row.setSize])).toEqual([
      [g, 1, 1, 2],
      [b, 2, 1, 2],
      [a, 2, 2, 2],
      [root, 1, 2, 2],
    ]);
    expect(open[0]).toMatchObject({ container: true, expanded: true });
    expect(ancestorsOf(core.tree, a)).toEqual([g]);
  });
});

describe('anuncios de la selección', () => {
  it('nombra el tipo, el tamaño y la página, con el género del tipo', () => {
    const doc = newDoc();
    const r = putNode(doc, rect({ w: 120, h: 80 }));
    const { core } = makeCore(doc);
    const record = core.store.get(r)!;
    expect(describeSelection([record], 'Página 1', LABELS)).toBe('Rectángulo seleccionado, 120 por 80, en Página 1');
    expect(describeSelection([{ ...record, type: 'ellipse' } as never], 'Página 1', LABELS)).toBe('Elipse seleccionada, 120 por 80, en Página 1');
    expect(describeSelection([{ ...record, name: 'Logo' }], 'Portada', LABELS)).toBe('Rectángulo «Logo» seleccionado, 120 por 80, en Portada');
    expect(describeSelection([record, record], 'Página 1', LABELS)).toBe('2 elementos seleccionados en Página 1');
    expect(describeSelection([], 'Página 1', LABELS)).toBe('Nada seleccionado en Página 1');
  });

  it('una imagen lleva su texto alternativo y un grupo usa su caja derivada', () => {
    const image = { ...rect({ w: 300, h: 200 }), type: 'image', assetId: '00000000-0000-4000-8000-000000000000', fit: 'fill', alt: 'Un faro al atardecer' } as never;
    expect(describeSelection([image], 'Página 1', LABELS)).toBe('Imagen seleccionada, 300 por 200, en Página 1. Un faro al atardecer');
    const g = group() as never;
    expect(describeSelection([g], 'Página 1', LABELS, { sizeOf: () => ({ w: 250.4, h: 99.6 }) })).toBe('Grupo seleccionado, 250 por 100, en Página 1');
  });

  it('el nombre por defecto de un texto es el comienzo de su contenido', () => {
    const record = rect() as never;
    expect(displayName(record, 'Texto', '  Hola\n mundo ')).toBe('Hola mundo');
    expect(displayName(record, 'Texto', 'x'.repeat(80))).toHaveLength(40);
    expect(displayName(record, 'Texto')).toBe('Texto');
  });
});
