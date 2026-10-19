import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { newDoc, nodeMap, PAGE_ID, putNode, rect } from '../../test-utils.ts';
import { FAST_BIT, packFast, transferOf, unpackFast, type DocBatch, type MainToHost } from '../protocol.ts';
import { DocHost } from './DocHost.ts';

const QUIET = { warn: () => {}, error: () => {}, debug: () => {} };

// Un cambio de otro cliente: llega como update, no como transacción local.
function remote(doc: Y.Doc, change: (peer: Y.Doc) => void) {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const before = Y.encodeStateVector(peer);
  change(peer);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, before), 'remote');
  peer.destroy();
}

// Transporte que clona cada mensaje y transfiere los buffers, como postMessage entre hilos.
function cloningHost(doc: Y.Doc) {
  const batches: DocBatch[] = [];
  const host = new DocHost(doc, null, {
    logger: QUIET,
    post: (batch, transfer) => {
      const cloned = structuredClone(batch, { transfer });
      batches.push(cloned);
    },
  });
  const send = (message: MainToHost) => host.handle(structuredClone(message));
  const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
  return { host, batches, send, flush };
}

describe('DocHost', () => {
  it('cada mensaje de ops es una transacción y un paso de deshacer', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const host = new DocHost(doc, null, { logger: QUIET });
    host.take();
    let transactions = 0;
    doc.on('afterTransaction', (tr: Y.Transaction) => tr.changed.size && transactions++);
    host.handle({ t: 'ops', seq: 1, origin: 'local', step: 'new', selection: [id], ops: [{ k: 'node.patch', id, set: { x: 5, y: 6 } }, { k: 'text.set', id, content: 'Hola' }] });
    expect(transactions).toBe(1);
    expect(nodeMap(doc, id).get('x')).toBe(5);
    host.handle({ t: 'undo', seq: 2, selection: [] });
    expect(nodeMap(doc, id).get('x')).toBe(0);
    expect(doc.getMap(ROOT_KEYS.texts).has(id)).toBe(false);
    host.destroy();
  });

  it('node.patch no reescribe valores iguales y animation.delete de una clave que no existe no hace nada', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ shadow: { x: 1, y: 1, blur: 2, color: '#000000FF' } }));
    const host = new DocHost(doc, null, { logger: QUIET });
    let updates = 0;
    doc.on('update', () => updates++);
    host.handle({
      t: 'ops',
      seq: 1,
      origin: 'local',
      step: 'new',
      selection: [],
      ops: [{ k: 'node.patch', id, set: { x: 0, shadow: { x: 1, y: 1, blur: 2, color: '#000000FF' } } }, { k: 'animation.delete', id }],
    });
    expect(updates).toBe(0);
    host.destroy();
  });

  it('una op sin efecto da un lote sin parches con su applied; con el crédito gastado sale al llegar consumed', async () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ fill: '#FF0000FF' }));
    const { host, batches, send, flush } = cloningHost(doc);
    await flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.full).toBe(true);
    send({ t: 'ops', seq: 1, origin: 'local', step: 'new', selection: [], ops: [{ k: 'node.patch', id, set: { fill: '#FF0000FF' } }] });
    await flush();
    expect(batches).toHaveLength(1);
    send({ t: 'consumed' });
    await flush();
    expect(batches).toHaveLength(2);
    expect(batches[1]).toMatchObject({ applied: 1 });
    expect(batches[1]!.fast ?? batches[1]!.keys ?? batches[1]!.set).toBeUndefined();
    host.destroy();
  });

  it('el crédito funde varios updates remotos en un lote', async () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { host, batches, send, flush } = cloningHost(doc);
    await flush();
    for (let i = 1; i <= 5; i++) remote(doc, (peer) => nodeMap(peer, id).set('x', i));
    await flush();
    expect(batches).toHaveLength(1);
    send({ t: 'consumed' });
    await flush();
    expect(batches).toHaveLength(2);
    const values: number[] = [];
    unpackFast(batches[1]!.fast!, (_id, _mask, read) => values.push(read[0] as number));
    expect(values).toEqual([5]);
    expect(batches[1]!.local).toBeUndefined();
    host.destroy();
  });

  it('clasifica en parche rápido, claves, registro completo y baja', () => {
    const doc = newDoc();
    const a = putNode(doc, rect());
    const b = putNode(doc, rect({ index: 'a1', name: 'B' }));
    const c = putNode(doc, rect({ index: 'a2' }));
    const d = putNode(doc, rect({ index: 'a3' }));
    const host = new DocHost(doc, null, { logger: QUIET });
    host.take();
    doc.transact(() => {
      nodeMap(doc, a).set('x', 9);
      nodeMap(doc, b).set('fill', '#00FF00FF');
      nodeMap(doc, b).delete('name');
      doc.getMap(ROOT_KEYS.nodes).delete(d);
    }, 'remote');
    putNode(doc, rect({ id: c, index: 'a2', w: 33 }));
    const batch = host.take()!;
    const fast: string[] = [];
    unpackFast(batch.fast!, (id) => fast.push(id));
    expect(fast).toEqual([a]);
    expect(batch.keys).toEqual([{ id: b, set: { fill: '#00FF00FF' }, unset: ['name'] }]);
    expect(batch.set?.map((record) => record.id)).toEqual([c]);
    expect(batch.del).toEqual([d]);
    host.destroy();
  });

  it('un cambio dentro de un tipo anidado del nodo manda el registro entero', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const host = new DocHost(doc, null, { logger: QUIET });
    host.take();
    doc.transact(() => {
      const nested = new Y.Map<unknown>();
      nodeMap(doc, id).set('name', 'Caja');
      nodeMap(doc, id).set('meta', nested);
    }, 'remote');
    doc.transact(() => (nodeMap(doc, id).get('meta') as Y.Map<unknown>).set('k', 1), 'remote');
    const batch = host.take()!;
    expect(batch.keys).toBeUndefined();
    expect(batch.set?.[0]?.id ?? batch.del?.[0]).toBe(id);
    host.destroy();
  });

  it('empaquetar y desempaquetar los parches rápidos es simétrico y transferible', () => {
    const packed = packFast([
      { id: 'a', mask: FAST_BIT.x! | FAST_BIT.visible!, values: [1.5, 0, 0, 0, true, false] },
      { id: 'b', mask: FAST_BIT.rotation! | FAST_BIT.locked!, values: [0, 0, -1, 0, false, false] },
    ]);
    const batch = structuredClone({ t: 'batch', gen: 1, applied: 0, invalid: 0, fast: packed } as DocBatch);
    expect(transferOf({ t: 'batch', gen: 1, applied: 0, invalid: 0, fast: packed })).toHaveLength(2);
    const out: Array<[string, unknown[]]> = [];
    unpackFast(batch.fast!, (id, mask, values) => out.push([id, values.filter((_, i) => mask & (1 << i))]));
    expect(out).toEqual([
      ['a', [1.5, true]],
      ['b', [-1, false]],
    ]);
  });

  it('en solo lectura descarta las ops y las acusa', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const warnings: string[] = [];
    const host = new DocHost(doc, null, { logger: { ...QUIET, warn: (message: string) => warnings.push(message) } });
    host.take();
    host.readOnly = true;
    host.handle({ t: 'ops', seq: 1, origin: 'local', step: 'new', selection: [], ops: [{ k: 'node.delete', id }] });
    host.handle({ t: 'ops', seq: 2, origin: 'local', step: 'new', selection: [], ops: [{ k: 'node.delete', id }] });
    expect(doc.getMap(ROOT_KEYS.nodes).has(id)).toBe(true);
    expect(host.take()).toMatchObject({ applied: 2 });
    expect(warnings).toHaveLength(1);
    host.destroy();
  });

  it('un lote con un deshacer lleva local y la selección a restaurar; uno solo remoto, no', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const host = new DocHost(doc, null, { logger: QUIET });
    host.take();
    host.handle({ t: 'ops', seq: 1, origin: 'local', step: 'new', selection: [id], ops: [{ k: 'node.patch', id, set: { x: 4 } }] });
    host.handle({ t: 'step-after', selection: [] });
    host.take();
    remote(doc, (peer) => nodeMap(peer, id).set('y', 3));
    expect(host.take()?.local).toBeUndefined();
    host.handle({ t: 'undo', seq: 2, selection: [] });
    const batch = host.take()!;
    expect(batch.local).toBe(true);
    expect(batch.restoreSelection).toEqual([id]);
    expect(batch.history).toEqual({ canUndo: false, canRedo: true });
    host.destroy();
  });

  it('el primer lote es full con las páginas y la meta', () => {
    const host = new DocHost(newDoc(), null, { logger: QUIET });
    const batch = host.take()!;
    expect(batch.full).toBe(true);
    expect(batch.pages?.map((page) => page.id)).toEqual([PAGE_ID]);
    expect(batch.meta).not.toBeNull();
    host.destroy();
  });
});
