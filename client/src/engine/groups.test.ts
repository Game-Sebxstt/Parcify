import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { ROOT_KEYS } from '../shared/document/keys.js';
import { DOCUMENT_LIMITS } from '../shared/document/limits.js';
import { NodeSchema } from '../shared/document/schema.js';
import { apply } from './geometry/matrix.ts';
import { routeEnd } from './geometry/connectors.ts';
import { LOCAL_ORIGIN } from './origins.ts';
import { connectorNode, frame, group, makeCore, newDoc, nodeMap, PAGE_ID, pointer, putNode, rect } from './test-utils.ts';
import type { ConnectorRecord } from './types.ts';

function countLocalTransactions(doc: Y.Doc) {
  let count = 0;
  doc.on('afterTransaction', (tr: Y.Transaction) => {
    if (tr.origin === LOCAL_ORIGIN && tr.changed.size > 0) count++;
  });
  return () => count;
}

const worldOrigin = (core: ReturnType<typeof makeCore>['core'], id: string) => apply(core.worldMatrix(core.record(id)!), 0, 0);

function click(core: ReturnType<typeof makeCore>['core'], x: number, y: number) {
  core.controller.pointerDown(pointer(x, y));
  core.controller.pointerUp(pointer(x, y));
}

function drag(ctx: ReturnType<typeof makeCore>, from: { x: number; y: number }, to: { x: number; y: number }) {
  const c = ctx.core.controller;
  c.pointerDown(pointer(from.x, from.y));
  c.pointerMove(pointer((from.x + to.x) / 2, (from.y + to.y) / 2, { ctrl: true }));
  ctx.tick();
  c.pointerMove(pointer(to.x, to.y, { ctrl: true }));
  ctx.tick();
  c.pointerUp(pointer(to.x, to.y, { ctrl: true }));
  ctx.tick();
}

describe('agrupar y desagrupar', () => {
  it('Ctrl+G crea el grupo en una transacción, conserva la posición de los hijos y se deshace de una vez', () => {
    const doc = newDoc();
    const a = putNode(doc, rect({ x: 100, y: 100 }));
    const b = putNode(doc, rect({ x: 300, y: 200, index: 'a1' }));
    const ctx = makeCore(doc);
    const { core } = ctx;
    const writes = countLocalTransactions(doc);
    core.setSelection([a, b]);
    const g = core.commands.groupSelection()!;
    ctx.tick();
    expect(writes()).toBe(1);
    expect(core.selection.get()).toEqual([g]);
    const record = core.store.get(g)!;
    expect(record).toMatchObject({ type: 'group', parentId: null, x: 100, y: 100, w: 0, h: 0, index: 'a1' });
    expect(nodeMap(doc, a).toJSON()).toMatchObject({ parentId: g, x: 0, y: 0 });
    expect(nodeMap(doc, b).toJSON()).toMatchObject({ parentId: g, x: 200, y: 100 });
    expect(worldOrigin(core, a)).toEqual({ x: 100, y: 100 });
    expect(worldOrigin(core, b)).toEqual({ x: 300, y: 200 });
    // La caja del grupo es la de sus hijos y no se escribe.
    expect(core.geometryOf(g)).toEqual({ minX: 100, minY: 100, maxX: 400, maxY: 250 });
    core.commands.undo();
    ctx.tick();
    expect(doc.getMap(ROOT_KEYS.nodes).has(g)).toBe(false);
    expect(nodeMap(doc, a).toJSON()).toMatchObject({ parentId: null, x: 100, y: 100 });
  });

  it('Ctrl+Shift+G devuelve los hijos al padre en el sitio del grupo y lo borra', () => {
    const doc = newDoc();
    const below = putNode(doc, rect({ x: 0, y: 0, index: 'a0' }));
    const g = putNode(doc, group({ x: 50, y: 60, rotation: Math.PI / 2, index: 'a1' }));
    const a = putNode(doc, rect({ parentId: g, x: 0, y: 0, w: 100, h: 50, index: 'a0' }));
    const above = putNode(doc, rect({ x: 500, y: 0, index: 'a2' }));
    const ctx = makeCore(doc);
    const { core } = ctx;
    const before = core.worldMatrix(core.record(a)!);
    core.setSelection([g]);
    expect(core.commands.ungroupSelection()).toEqual([a]);
    ctx.tick();
    expect(doc.getMap(ROOT_KEYS.nodes).has(g)).toBe(false);
    const after = core.worldMatrix(core.record(a)!);
    for (let i = 0; i < 6; i++) expect(after[i]).toBeCloseTo(before[i]!, 2);
    expect(core.tree.paintOrder(PAGE_ID)).toEqual([below, a, above]);
    expect(core.selection.get()).toEqual([a]);
  });

  it('un clic selecciona el grupo, el doble clic entra en él y Escape vuelve al grupo', () => {
    const doc = newDoc();
    const g = putNode(doc, group({ x: 100, y: 100 }));
    const a = putNode(doc, rect({ parentId: g, x: 0, y: 0 }));
    const b = putNode(doc, rect({ parentId: g, x: 200, y: 0, index: 'a1' }));
    const ctx = makeCore(doc);
    const { core } = ctx;
    click(core, 150, 120);
    expect(core.selection.get()).toEqual([g]);
    click(core, 150, 120);
    expect(core.selection.get()).toEqual([a]);
    expect(core.scope).toBe(g);
    // Dentro del grupo, un clic en otro hijo lo selecciona directamente.
    click(core, 350, 120);
    expect(core.selection.get()).toEqual([b]);
    core.controller.keyDown({ key: 'Escape', code: 'Escape', ctrl: false, shift: false, alt: false, repeat: false });
    expect(core.selection.get()).toEqual([g]);
    expect(core.scope).toBeNull();
    // Seleccionar el grupo y un hijo a la vez se queda en el grupo.
    core.setSelection([g, a]);
    expect(core.selection.get()).toEqual([g]);
  });

  it('el rectángulo de selección sube a los grupos y solo toma un frame si cabe entero', () => {
    const doc = newDoc();
    const g = putNode(doc, group({ x: 0, y: 0 }));
    putNode(doc, rect({ parentId: g, x: 10, y: 10, w: 20, h: 20 }));
    const f = putNode(doc, frame({ x: 200, y: 0, w: 300, h: 300, index: 'a1' }));
    const inner = putNode(doc, rect({ parentId: f, x: 20, y: 20, w: 20, h: 20 }));
    const { core } = makeCore(doc);
    expect(core.targetsIn({ minX: 0, minY: 0, maxX: 260, maxY: 60 }).sort()).toEqual([g, inner].sort());
    core.setSelection(core.targetsIn({ minX: -10, minY: -10, maxX: 600, maxY: 400 }));
    expect([...core.selection.get()].sort()).toEqual([g, f].sort());
  });

  it('mover un hijo no toca el grupo; mover el grupo cambia solo su origen y pone al día los conectores de sus hijos', () => {
    const doc = newDoc();
    const other = putNode(doc, rect({ x: 0, y: 400, w: 100, h: 50 }));
    const g = putNode(doc, group({ x: 100, y: 100, index: 'a1' }));
    const a = putNode(doc, rect({ parentId: g, x: 0, y: 0, w: 100, h: 50 }));
    const c = putNode(doc, connectorNode({ nodeId: other, anchor: 'right' }, { nodeId: a, anchor: 'left' }, { index: 'a2' }));
    const ctx = makeCore(doc);
    const { core, sink } = ctx;
    const path = () => (sink.records.get(c) as ConnectorRecord).path!;
    expect(routeEnd(path())).toEqual({ x: 100, y: 125 });

    core.setSelection([g]);
    const writes = countLocalTransactions(doc);
    const ctl = core.controller;
    ctl.pointerDown(pointer(150, 120));
    ctl.pointerMove(pointer(170, 120, { ctrl: true }));
    ctx.tick();
    ctl.pointerMove(pointer(200, 170, { ctrl: true }));
    ctx.tick();
    // Durante el gesto el conector se recalcula con el hijo movido, sin escribir.
    const preview = sink.overrides.get(c)!;
    expect(routeEnd((preview.record as ConnectorRecord).path!)).toEqual({ x: 150, y: 175 });
    expect(writes()).toBe(0);
    ctl.pointerUp(pointer(200, 170, { ctrl: true }));
    ctx.tick();
    expect(writes()).toBe(1);
    expect(nodeMap(doc, g).toJSON()).toMatchObject({ x: 150, y: 150, w: 0, h: 0 });
    expect(nodeMap(doc, a).toJSON()).toMatchObject({ x: 0, y: 0 });
    // La caja de los extremos del conector se escribe en la misma transacción.
    expect(nodeMap(doc, c).toJSON()).toMatchObject({ x: 100, y: 175, w: 50, h: 250 });
    expect(routeEnd(path())).toEqual({ x: 150, y: 175 });

    // Mover el hijo dentro del grupo no escribe en el grupo.
    core.setSelection([a]);
    core.commands.nudge(10, 0);
    ctx.tick();
    expect(nodeMap(doc, g).toJSON()).toMatchObject({ x: 150, y: 150 });
    expect(nodeMap(doc, a).get('x')).toBe(10);
  });

  it('un grupo movido por otra persona recalcula los conectores anclados a sus hijos', () => {
    const doc = newDoc();
    const other = putNode(doc, rect({ x: 0, y: 400 }));
    const g = putNode(doc, group({ x: 100, y: 100, index: 'a1' }));
    const a = putNode(doc, rect({ parentId: g, x: 0, y: 0, w: 100, h: 50 }));
    const c = putNode(doc, connectorNode({ nodeId: other, anchor: 'right' }, { nodeId: a, anchor: 'left' }, { index: 'a2' }));
    const ctx = makeCore(doc);
    doc.transact(() => {
      nodeMap(doc, g).set('x', 300);
      nodeMap(doc, g).set('y', 0);
    }, 'remote');
    ctx.tick();
    expect(routeEnd((ctx.sink.records.get(c) as ConnectorRecord).path!)).toEqual({ x: 300, y: 25 });
  });

  it('redimensionar un grupo escala sus hijos y deja el grupo donde estaba', () => {
    const doc = newDoc();
    const g = putNode(doc, group({ x: 100, y: 100 }));
    const a = putNode(doc, rect({ parentId: g, x: 0, y: 0, w: 100, h: 50 }));
    const b = putNode(doc, rect({ parentId: g, x: 100, y: 50, w: 100, h: 50, index: 'a1' }));
    const { core } = makeCore(doc);
    // Escala ×2 desde la esquina del grupo (100, 100).
    core.commands.commitTransform([g], [2, 0, 0, 2, -100, -100]);
    expect(nodeMap(doc, g).toJSON()).toMatchObject({ x: 100, y: 100 });
    expect(nodeMap(doc, a).toJSON()).toMatchObject({ x: 0, y: 0, w: 200, h: 100 });
    expect(nodeMap(doc, b).toJSON()).toMatchObject({ x: 200, y: 100, w: 200, h: 100 });
  });

  it('borrar un grupo borra lo que cuelga de él y suelta los conectores', () => {
    const doc = newDoc();
    const other = putNode(doc, rect({ x: 0, y: 400 }));
    const g = putNode(doc, group({ x: 100, y: 100, index: 'a1' }));
    const a = putNode(doc, rect({ parentId: g }));
    const c = putNode(doc, connectorNode({ nodeId: other, anchor: 'right' }, { nodeId: a, anchor: 'left' }, { index: 'a2' }));
    const { core } = makeCore(doc);
    core.setSelection([g]);
    core.commands.deleteSelection();
    const nodes = doc.getMap(ROOT_KEYS.nodes);
    expect(nodes.has(g) || nodes.has(a)).toBe(false);
    expect(nodeMap(doc, c).get('to')).toEqual({ x: 100, y: 125 });
  });

  it('duplicar un grupo copia también sus hijos', () => {
    const doc = newDoc();
    const g = putNode(doc, group({ x: 100, y: 100 }));
    putNode(doc, rect({ parentId: g }));
    const ctx = makeCore(doc);
    ctx.core.setSelection([g]);
    ctx.core.commands.duplicateSelection();
    ctx.tick();
    const [copy] = ctx.core.selection.get();
    expect(copy).not.toBe(g);
    expect(ctx.core.tree.childrenOf(PAGE_ID, copy!)).toHaveLength(1);
    expect(nodeMap(doc, copy!).toJSON()).toMatchObject({ type: 'group', x: 116, y: 116 });
  });
});

describe('frames', () => {
  it('la herramienta F crea un frame arrastrando y con un clic usa el preset elegido', () => {
    const ctx = makeCore();
    const { core } = ctx;
    core.controller.keyDown({ key: 'f', code: 'KeyF', ctrl: false, shift: false, alt: false, repeat: false });
    expect(core.tool.get()).toBe('frame');
    drag(ctx, { x: 10, y: 20 }, { x: 210, y: 170 });
    const id = core.selection.get()[0]!;
    expect(core.store.get(id)).toMatchObject({ type: 'frame', x: 10, y: 20, w: 200, h: 150, clip: true });
    core.commands.setTool('frame');
    core.framePreset.set('A4');
    click(core, 600, 500);
    const a4 = core.selection.get()[0]!;
    expect(core.store.get(a4)).toMatchObject({ type: 'frame', w: 794, h: 1123, presetName: 'A4' });
  });

  it('lo que se crea dentro de un frame entra en él con coordenadas del frame', () => {
    const doc = newDoc();
    const f = putNode(doc, frame({ x: 100, y: 100, w: 400, h: 300 }));
    const { core } = makeCore(doc);
    const id = core.commands.createShape('rect', { x: 150, y: 150, w: 50, h: 50 })!;
    expect(core.store.get(id)).toMatchObject({ parentId: f, x: 50, y: 50 });
    const outside = core.commands.createShape('rect', { x: 600, y: 600, w: 50, h: 50 })!;
    expect(core.store.get(outside)).toMatchObject({ parentId: null, x: 600, y: 600 });
  });

  it('soltar un nodo sobre un frame lo mete dentro y sacarlo lo devuelve a la página', () => {
    const doc = newDoc();
    const f = putNode(doc, frame({ x: 300, y: 0, w: 400, h: 300 }));
    const a = putNode(doc, rect({ x: 0, y: 0, w: 100, h: 50, index: 'a1' }));
    const ctx = makeCore(doc);
    const { core } = ctx;
    drag(ctx, { x: 50, y: 25 }, { x: 450, y: 125 });
    expect(nodeMap(doc, a).toJSON()).toMatchObject({ parentId: f, x: 100, y: 100 });
    expect(worldOrigin(core, a)).toEqual({ x: 400, y: 100 });
    drag(ctx, { x: 450, y: 125 }, { x: 50, y: 425 });
    expect(nodeMap(doc, a).toJSON()).toMatchObject({ parentId: null, x: 0, y: 400 });
  });

  it('copiar o cortar un hijo de un frame girado y pegarlo lo deja en la página donde se veía', () => {
    const doc = newDoc();
    const f = putNode(doc, frame({ x: 400, y: 300, w: 400, h: 300, rotation: Math.PI / 6 }));
    const r = putNode(doc, rect({ parentId: f, x: 20, y: 20, w: 100, h: 50 }));
    const c = putNode(doc, connectorNode({ x: 10, y: 200 }, { x: 150, y: 250 }, { parentId: f, index: 'a2' }));
    const ctx = makeCore(doc);
    const { core } = ctx;
    const shifted = (m: number[]) => m.map((v, i) => (i >= 4 ? v + 16 : v));
    const expectWorld = (id: string, expected: number[]) => core.worldMatrix(core.record(id)!).forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 2));
    const rectWorld = [...core.worldMatrix(core.record(r)!)];
    const ends = core.connectorEndpoints(c)!;
    const frameWorld = core.tree.parentWorld(f)!;
    const worldEnds = [apply(frameWorld, ends.from.x, ends.from.y), apply(frameWorld, ends.to.x, ends.to.y)];

    core.setSelection([r, c]);
    const html = core.commands.copySelection()!;
    expect(core.commands.paste(html)).toBe(true);
    ctx.tick();
    const [copyR, copyC] = core.selection.get().map((id) => core.record(id)!);
    const pastedRect = copyR!.type === 'rect' ? copyR! : copyC!;
    const pastedLine = copyR!.type === 'rect' ? copyC! : copyR!;
    expect(pastedRect.parentId).toBeNull();
    expectWorld(pastedRect.id, shifted(rectWorld));
    const pastedEnds = core.connectorEndpoints(pastedLine.id)!;
    expect(pastedEnds.from.x).toBeCloseTo(worldEnds[0]!.x + 16, 0);
    expect(pastedEnds.from.y).toBeCloseTo(worldEnds[0]!.y + 16, 0);
    expect(pastedEnds.to.x).toBeCloseTo(worldEnds[1]!.x + 16, 0);
    expect(pastedEnds.to.y).toBeCloseTo(worldEnds[1]!.y + 16, 0);

    core.setSelection([r]);
    const cut = core.commands.cutSelection()!;
    ctx.tick();
    expect(core.record(r)).toBeUndefined();
    expect(core.commands.paste(cut)).toBe(true);
    ctx.tick();
    const [moved] = core.selection.get();
    expect(core.record(moved!)!.parentId).toBeNull();
    expectWorld(moved!, rectWorld);
  });

  it('redimensionar un frame deja a sus hijos donde estaban y quita el preset', () => {
    const doc = newDoc();
    const f = putNode(doc, frame({ x: 100, y: 100, w: 400, h: 300, presetName: '4:3' }));
    const a = putNode(doc, rect({ parentId: f, x: 50, y: 50 }));
    const { core } = makeCore(doc);
    // Arrastrar el borde izquierdo 100 hacia la izquierda: escala x desde el borde derecho (500).
    core.commands.commitTransform([f], [1.25, 0, 0, 1, -125, 0]);
    expect(nodeMap(doc, f).toJSON()).toMatchObject({ x: 0, w: 500 });
    expect(nodeMap(doc, f).has('presetName')).toBe(false);
    expect(worldOrigin(core, a)).toEqual({ x: 150, y: 150 });
    // Mover el frame sí lleva a sus hijos.
    core.commands.commitTransform([f], [1, 0, 0, 1, 10, 0]);
    expect(worldOrigin(core, a)).toEqual({ x: 160, y: 150 });
  });

  it('un preset cambia el tamaño de los frames seleccionados', () => {
    const doc = newDoc();
    const f = putNode(doc, frame({ x: 0, y: 0 }));
    const { core } = makeCore(doc);
    core.setSelection([f]);
    core.commands.applyFramePreset('16:9');
    expect(nodeMap(doc, f).toJSON()).toMatchObject({ w: 1920, h: 1080, presetName: '16:9' });
  });

  it('con recorte, lo que sobresale del frame no se puede tocar ni se pinta fuera', () => {
    const doc = newDoc();
    const f = putNode(doc, frame({ x: 0, y: 0, w: 200, h: 200 }));
    const big = putNode(doc, rect({ parentId: f, x: 100, y: 100, w: 300, h: 300 }));
    const ctx = makeCore(doc);
    expect(ctx.core.hitTest(150, 150)).toBe(big);
    expect(ctx.core.hitTest(350, 350)).toBeNull();
    ctx.core.setSelection([f]);
    ctx.core.commands.setStyle({ clip: false });
    ctx.tick();
    expect(ctx.core.hitTest(350, 350)).toBe(big);
    // La capa de dibujo recibe el contenedor de cada vista.
    expect(ctx.sink.parents.get(big)).toBe(f);
  });

  it('un contenedor oculto oculta y deja sin tocar a sus hijos', () => {
    const doc = newDoc();
    const g = putNode(doc, group({ x: 0, y: 0, visible: false }));
    const a = putNode(doc, rect({ parentId: g, x: 0, y: 0 }));
    const ctx = makeCore(doc);
    expect(ctx.core.hitTest(20, 20)).toBeNull();
    nodeMap(doc, g).set('visible', true);
    ctx.tick();
    expect(ctx.core.hitTest(20, 20)).toBe(a);
  });
});

describe('páginas', () => {
  it('crear, renombrar, reordenar con índice fraccional y borrar con su contenido', () => {
    const doc = newDoc();
    const first = putNode(doc, rect());
    const ctx = makeCore(doc);
    const { core } = ctx;
    const second = core.commands.createPage('Página 2')!;
    ctx.tick();
    expect(core.activePage).toBe(second);
    // Solo se pinta la página activa.
    expect(ctx.sink.records.has(first)).toBe(false);
    const onSecond = core.commands.createShape('rect', { x: 0, y: 0, w: 10, h: 10 })!;
    core.commands.renamePage(second, '  Portada  ');
    core.commands.movePage(second, -1);
    ctx.tick();
    const pages = core.pages.get();
    expect(pages.map((page) => page.id)).toEqual([second, PAGE_ID]);
    expect(pages[0]!.name).toBe('Portada');
    expect(pages[0]!.index < pages[1]!.index).toBe(true);
    expect(core.commands.deletePage(second)).toBe(true);
    ctx.tick();
    expect(doc.getMap(ROOT_KEYS.nodes).has(onSecond)).toBe(false);
    expect(core.activePage).toBe(PAGE_ID);
    expect(ctx.sink.records.has(first)).toBe(true);
    // La última página no se borra.
    expect(core.commands.deletePage(PAGE_ID)).toBe(false);
  });

  it('no deja crear más de 100 páginas', () => {
    const ctx = makeCore();
    for (let i = 1; i < DOCUMENT_LIMITS.maxPages; i++) expect(ctx.core.commands.createPage(`P${i}`)).not.toBeNull();
    expect(ctx.core.commands.canAddPage).toBe(false);
    expect(ctx.core.commands.createPage('Otra')).toBeNull();
    expect(ctx.core.pages.get()).toHaveLength(DOCUMENT_LIMITS.maxPages);
  });
});

describe('teclado en el lienzo', () => {
  it('Tab y Shift+Tab recorren los hermanos en orden z y sueltan el foco al pasar del último', () => {
    const doc = newDoc();
    const a = putNode(doc, rect({ x: 0, index: 'a0' }));
    const b = putNode(doc, rect({ x: 200, index: 'a1' }));
    putNode(doc, rect({ x: 400, index: 'a2', visible: false }));
    const { core } = makeCore(doc);
    expect(core.commands.focusNext(1)).toBe(true);
    expect(core.selection.get()).toEqual([a]);
    expect(core.commands.focusNext(1)).toBe(true);
    expect(core.selection.get()).toEqual([b]);
    expect(core.commands.focusNext(1)).toBe(false);
    expect(core.commands.focusNext(-1)).toBe(true);
    expect(core.selection.get()).toEqual([a]);
  });

  it('Enter en un grupo selecciona sus hijos y Shift+Enter vuelve al grupo', () => {
    const doc = newDoc();
    const g = putNode(doc, group());
    const a = putNode(doc, rect({ parentId: g }));
    const b = putNode(doc, rect({ parentId: g, index: 'a1', x: 200 }));
    const { core } = makeCore(doc);
    core.setSelection([g]);
    expect(core.commands.enterSelection()).toBe(true);
    expect(core.selection.get()).toEqual([a, b]);
    core.setSelection([a]);
    expect(core.commands.selectParent()).toBe(true);
    expect(core.selection.get()).toEqual([g]);
  });

  it('el panel de capas solo se avisa cuando cambia algo que muestra', () => {
    const doc = newDoc();
    const a = putNode(doc, rect());
    const ctx = makeCore(doc);
    const version = () => ctx.core.layersVersion.get();
    const start = version();
    ctx.core.setSelection([a]);
    ctx.core.commands.nudge(5, 0);
    ctx.tick();
    expect(version()).toBe(start);
    ctx.core.commands.renameNode(a, 'Logo');
    ctx.tick();
    expect(version()).toBe(start + 1);
    ctx.core.commands.setFlagFor([a], 'visible', false);
    ctx.tick();
    expect(version()).toBe(start + 2);
    expect(NodeSchema.safeParse(nodeMap(doc, a).toJSON()).success).toBe(true);
  });
});
