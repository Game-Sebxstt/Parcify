import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { newDoc, nodeId, nodeMap, PAGE_ID, putNode, rect } from '../test-utils.ts';
import { DocHost } from '../doc/host/DocHost.ts';
import { FAST_BIT, packFast, type DocBatch } from '../doc/protocol.ts';
import type { NodeRecord } from '../types.ts';
import { DocumentStore } from './DocumentStore.ts';
import { compareOrder, keysOnTop, needsReindex, reindex, zOrderIndexes } from './order.ts';
import { SceneTree } from './tree.ts';

// El espejo alimentado por un host sobre el Y.Doc: flush() lleva al espejo el lote pendiente y lo vacía.
function mirror(doc: Y.Doc, logger: { warn: (message: string) => void } = { warn: () => {} }) {
  let dirty = 0;
  const host = new DocHost(doc, null, { logger: { ...logger, error: () => {}, debug: () => {} }, onPending: () => dirty++ });
  const store = new DocumentStore();
  const flush = () => {
    const batch = host.take();
    if (batch) store.applyBatch(batch);
    return store.flush();
  };
  return { store, flush, dirty: () => dirty, resetDirty: () => (dirty = 0) };
}

const group = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ ...rect(), type: 'group', w: 0, h: 0, ...overrides });

describe('DocumentStore', () => {
  it('materializa los nodos válidos y descarta los inválidos', () => {
    const doc = newDoc();
    const ok = putNode(doc, rect());
    const bad = putNode(doc, rect({ w: -5 }));
    const unknown = putNode(doc, { ...rect(), type: 'hexagon' });
    const warnings: string[] = [];
    const { store, flush } = mirror(doc, { warn: (m: string) => void warnings.push(m) });
    flush();
    expect(store.get(ok)).toMatchObject({ id: ok, type: 'rect' });
    expect(store.get(bad)).toBeUndefined();
    expect(store.get(unknown)).toBeUndefined();
    expect(warnings).toHaveLength(2);
  });

  it('avisa una sola vez por nodo inválido y lo recupera cuando se corrige', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ opacity: 4 }));
    const warnings: string[] = [];
    const { store, flush } = mirror(doc, { warn: (m: string) => void warnings.push(m) });
    flush();
    nodeMap(doc, id).set('x', 10);
    flush();
    expect(warnings).toHaveLength(1);
    nodeMap(doc, id).set('opacity', 0.5);
    flush();
    expect(store.get(id)?.opacity).toBe(0.5);
  });

  it('acumula ids sucios y los procesa una vez por flush', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { store, flush, dirty, resetDirty } = mirror(doc);
    flush();
    resetDirty();
    for (let i = 0; i < 10; i++) nodeMap(doc, id).set('x', i);
    expect(dirty()).toBe(10);
    const result = flush();
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.fast).toBe(true);
    expect(result.structural).toBe(false);
    expect(store.get(id)?.x).toBe(9);
    nodeMap(doc, id).set('w', 30);
    expect(flush().changes[0]!.fast).toBe(false);
    nodeMap(doc, id).set('x', 1);
    nodeMap(doc, id).set('fill', '#00FF00FF');
    expect(flush().changes[0]!.fast).toBe(false);
    expect(store.get(id)).toMatchObject({ x: 1, fill: '#00FF00FF' });
  });

  it('la ruta rápida valida los límites: una x fuera de rango invalida el nodo', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { store, flush } = mirror(doc, { warn: () => {} });
    flush();
    nodeMap(doc, id).set('x', 1e9);
    flush();
    expect(store.get(id)).toBeUndefined();
  });

  it('la ruta rápida parchea el registro en sitio y otra clave lo sustituye', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { store, flush } = mirror(doc);
    flush();
    const before = store.get(id)!;
    nodeMap(doc, id).set('x', 40);
    nodeMap(doc, id).set('opacity', 0.5);
    const fast = flush().changes[0]!;
    expect(fast).toMatchObject({ fast: true });
    expect(fast.prev).toBe(before);
    expect(fast.next).toBe(before);
    expect(store.get(id)).toBe(before);
    expect(before).toMatchObject({ x: 40, opacity: 0.5 });
    nodeMap(doc, id).set('w', 70);
    const whole = flush().changes[0]!;
    expect(whole.fast).toBe(false);
    expect(whole.next).not.toBe(before);
    expect(store.get(id)?.w).toBe(70);
  });

  it('un valor rápido inválido no deja el registro a medio parchear', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { store, flush } = mirror(doc, { warn: () => {} });
    flush();
    const before = store.get(id)!;
    doc.transact(() => {
      nodeMap(doc, id).set('x', 5);
      nodeMap(doc, id).set('opacity', 3);
    });
    flush();
    expect(before.x).toBe(0);
    expect(store.get(id)).toBeUndefined();
  });

  it('un cambio solo del texto llega como cambio rápido con el mismo registro', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { store, flush } = mirror(doc);
    flush();
    const record = store.get(id)!;
    const text = new Y.Text();
    doc.transact(() => doc.getMap(ROOT_KEYS.texts).set(id, text));
    let result = flush();
    expect(result.changes).toEqual([{ id, prev: record, next: record, fast: true, layer: false }]);
    expect(store.text(id)).toBe('');
    text.insert(0, 'Hola');
    result = flush();
    expect(result.changes[0]).toMatchObject({ id, fast: true });
    expect(store.text(id)).toBe('Hola');
  });

  it('marca como estructural un cambio de índice o de padre', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { flush } = mirror(doc);
    flush();
    nodeMap(doc, id).set('index', 'a5');
    expect(flush().structural).toBe(true);
  });
});

describe('espejo con cambios optimistas', () => {
  const record = (overrides: Record<string, unknown> = {}) => rect(overrides) as unknown as NodeRecord;
  const batch = (applied: number, extra: Partial<DocBatch> = {}): DocBatch => ({ t: 'batch', gen: 1, applied, invalid: 0, ...extra });
  const fast = (id: string, x: number) => packFast([{ id, mask: FAST_BIT.x!, values: [x] }]);

  function loaded(...records: NodeRecord[]) {
    const store = new DocumentStore();
    store.applyBatch(batch(0, { full: true, set: records, pages: [], meta: null }));
    store.flush();
    return store;
  }

  it('lo optimista se ve en el acto y un lote remoto con la op pendiente no lo pisa', () => {
    const a = record({ x: 0 });
    const store = loaded(a);
    store.applyLocal(1, [{ k: 'node.patch', id: a.id, set: { x: 50 } }]);
    expect(store.get(a.id)?.x).toBe(50);
    // Un remoto mueve la y y la x antes del acuse: lo visible sigue con la x propia y toma la y remota.
    store.applyBatch(batch(0, { keys: [{ id: a.id, set: { x: 7, y: 9 }, unset: [] }] }));
    expect(store.get(a.id)).toMatchObject({ x: 50, y: 9 });
    // Al acusar, se queda el valor final del host.
    store.applyBatch(batch(1, { fast: fast(a.id, 50) }));
    expect(store.get(a.id)).toMatchObject({ x: 50, y: 9 });
    expect(store.pendingSince()).toBeNull();
  });

  it('una op sin efecto vuelve a lo confirmado con su acuse vacío', () => {
    const a = record({ fill: '#FF0000FF' });
    const store = loaded(a);
    store.applyLocal(1, [{ k: 'node.patch', id: a.id, set: { fill: '#00FF00FF' } }]);
    store.applyBatch(batch(1));
    expect(store.get(a.id)).toMatchObject({ fill: '#FF0000FF' });
  });

  it('full descarta los pendientes', () => {
    const a = record();
    const store = loaded(a);
    store.applyLocal(1, [{ k: 'node.delete', id: a.id }]);
    expect(store.get(a.id)).toBeUndefined();
    store.applyBatch(batch(0, { full: true, set: [record({ id: a.id })], pages: [], meta: null }));
    expect(store.get(a.id)).toBeDefined();
    expect(store.pendingSince()).toBeNull();
  });

  it('un cambio de padre local es estructural y su prev lleva el padre viejo', () => {
    const g = record({ type: 'group', w: 0, h: 0 });
    const a = record();
    const store = loaded(g, a);
    store.applyLocal(1, [{ k: 'node.patch', id: a.id, set: { parentId: g.id } }]);
    const result = store.flush();
    expect(result.structural).toBe(true);
    expect(result.changes[0]).toMatchObject({ id: a.id, fast: false });
    expect(result.changes[0]!.prev?.parentId).toBeNull();
    expect(result.changes[0]!.next?.parentId).toBe(g.id);
  });

  it('un remoto y un local sobre el mismo id en un frame dan un solo cambio con el prev del frame anterior', () => {
    const a = record({ x: 0 });
    const store = loaded(a);
    const seen = store.get(a.id)!;
    store.applyBatch(batch(0, { fast: fast(a.id, 5) }));
    store.applyLocal(1, [{ k: 'node.patch', id: a.id, set: { w: 70 } }]);
    const { changes } = store.flush();
    expect(changes).toHaveLength(1);
    expect(changes[0]!.prev).toBe(seen);
    expect(changes[0]!.next?.w).toBe(70);
  });

  it('un parche rápido sobre la sombra no cambia el objeto que tiene el árbol', () => {
    const a = record({ x: 0 });
    const store = loaded(a);
    store.applyLocal(1, [{ k: 'node.patch', id: a.id, set: { name: 'A' } }]);
    store.flush();
    const visible = store.get(a.id)!;
    store.applyBatch(batch(0, { fast: fast(a.id, 30) }));
    expect(visible.x).toBe(0);
    // El valor confirmado se ve recalculado sobre lo pendiente, en un objeto nuevo.
    expect(store.get(a.id)).toMatchObject({ x: 30, name: 'A' });
    expect(store.get(a.id)).not.toBe(visible);
  });

  it('el texto local se ve en el acto; un texto remoto con la sesión pendiente va a la sombra', () => {
    const a = record();
    const store = loaded(a);
    store.applyLocal(1, [{ k: 'text.local', id: a.id, content: 'Hola' }]);
    expect(store.text(a.id)).toBe('Hola');
    store.applyBatch(batch(0, { texts: [[a.id, 'xx']] }));
    expect(store.text(a.id)).toBe('Hola');
    store.applyBatch(batch(1, { texts: [[a.id, 'xxHola']] }));
    expect(store.text(a.id)).toBe('xxHola');
  });

  it('las páginas locales marcan pagesChanged al momento', () => {
    const store = loaded();
    store.applyLocal(1, [{ k: 'page.set', id: 'P1', page: { name: 'Uno', index: 'a0' } }]);
    expect(store.flush().pagesChanged).toBe(true);
    expect(store.pages().map((page) => page.id)).toEqual(['P1']);
    store.applyBatch(batch(1, { pages: [{ id: 'P1', name: 'Uno', index: 'a0' }] }));
    expect(store.flush().pagesChanged).toBe(false);
  });
});

describe('SceneTree', () => {
  function setup(nodes: Array<Record<string, unknown>>) {
    const doc = newDoc();
    for (const node of nodes) putNode(doc, node);
    const { store, flush } = mirror(doc, { warn: () => {} });
    flush();
    const tree = new SceneTree(store);
    tree.rebuild();
    return tree;
  }

  it('ordena por (index, id), con el id como desempate', () => {
    const a = rect({ id: 'b0000000000000000000a', index: 'a1' });
    const b = rect({ id: 'a0000000000000000000b', index: 'a1' });
    const c = rect({ id: 'c0000000000000000000c', index: 'a0' });
    const tree = setup([a, b, c]);
    expect(tree.childrenOf(PAGE_ID, null)).toEqual([c.id, b.id, a.id]);
  });

  it('trata como raíz un nodo con padre inexistente, que no es contenedor o de otra página', () => {
    const notContainer = rect();
    const missing = rect({ parentId: nodeId() });
    const child = rect({ parentId: notContainer.id });
    const g = group({ pageId: 'OTHER_00000000000000a' });
    const crossPage = rect({ parentId: g.id });
    const tree = setup([notContainer, missing, child, g, crossPage]);
    for (const node of [missing, child, crossPage]) expect(tree.parent(node.id as string)).toBeNull();
  });

  it('rompe los ciclos tratando a sus miembros como raíz', () => {
    const a = group();
    const b = group({ parentId: a.id });
    a.parentId = b.id;
    const leaf = rect({ parentId: b.id });
    const tree = setup([a, b, leaf]);
    expect(tree.parent(a.id as string)).toBeNull();
    expect(tree.parent(b.id as string)).toBeNull();
    expect(tree.parent(leaf.id as string)).toBe(b.id);
  });

  it('compone la matriz de mundo con la del grupo', () => {
    const g = group({ x: 100, y: 50 });
    const child = rect({ parentId: g.id, x: 10, y: 10 });
    const tree = setup([g, child]);
    expect(tree.paintOrder(PAGE_ID)).toEqual([g.id, child.id]);
  });
});

describe('orden fraccional', () => {
  const items = (keys: string[]) => keys.map((index, i) => ({ id: `id${i}`, index }));

  it('compara por índice y después por id', () => {
    expect(compareOrder({ id: 'b', index: 'a0' }, { id: 'a', index: 'a1' })).toBeLessThan(0);
    expect(compareOrder({ id: 'b', index: 'a1' }, { id: 'a', index: 'a1' })).toBeGreaterThan(0);
  });

  it('reindexa conservando el orden con claves cortas', () => {
    const long = 'a0' + 'V'.repeat(70);
    const sorted = items(['a0', long, 'a1']);
    expect(needsReindex(sorted.map((s) => s.index))).toBe(true);
    const keys = reindex(sorted);
    const next = sorted.map((s) => keys.get(s.id)!);
    expect([...next].sort()).toEqual(next);
    expect(needsReindex(next)).toBe(false);
  });

  it('keysOnTop reindexa si la última clave es demasiado larga', () => {
    const sorted = items(['a0', 'a0' + 'z'.repeat(70)]);
    const { keys, reindexed } = keysOnTop(sorted, 1);
    expect(reindexed).not.toBeNull();
    expect(keys[0]! > reindexed!.get('id1')!).toBe(true);
  });

  it('mueve al frente, al fondo y un paso', () => {
    const sorted = items(['a0', 'a1', 'a2', 'a3']);
    const apply = (move: Parameters<typeof zOrderIndexes>[2], ids: string[]) => {
      const updates = zOrderIndexes(sorted, new Set(ids), move);
      return sorted
        .map((s) => ({ id: s.id, index: updates.get(s.id) ?? s.index }))
        .sort(compareOrder)
        .map((s) => s.id);
    };
    expect(apply('front', ['id0'])).toEqual(['id1', 'id2', 'id3', 'id0']);
    expect(apply('back', ['id3'])).toEqual(['id3', 'id0', 'id1', 'id2']);
    expect(apply('forward', ['id1'])).toEqual(['id0', 'id2', 'id1', 'id3']);
    expect(apply('backward', ['id2'])).toEqual(['id0', 'id2', 'id1', 'id3']);
  });

  it('con índices duplicados (colisión concurrente) reindexa a todos los hermanos', () => {
    const sorted = items(['a0', 'a1', 'a1', 'a2']);
    // id3 tiene que quedar entre id1 e id2, que comparten índice: no hay hueco.
    const updates = zOrderIndexes(sorted, new Set(['id3']), 'backward');
    expect(updates.size).toBe(4);
    const order = sorted.map((s) => ({ id: s.id, index: updates.get(s.id)! })).sort(compareOrder).map((s) => s.id);
    expect(order).toEqual(['id0', 'id1', 'id3', 'id2']);
  });
});
