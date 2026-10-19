import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOT_KEYS, serverOrigin } from '../shared/document/keys.js';
import { createTouches, normalizeDocument } from '../shared/document/normalize.js';
import { NodeSchema } from '../shared/document/schema.js';
import { routeEnd, routeStart } from './geometry/connectors.ts';
import { LOCAL_ORIGIN } from './origins.ts';
import { makeCore, newDoc, nodeId, nodeMap, PAGE_ID, pointer, putNode, rect } from './test-utils.ts';
import type { ConnectorRecord } from './types.ts';

function connector(from: unknown, to: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: nodeId(),
    type: 'connector',
    pageId: PAGE_ID,
    parentId: null,
    index: 'a5',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    createdBy: 'user-a',
    fill: null,
    stroke: '#EEF2F6FF',
    strokeWidth: 2,
    strokeDash: 'solid',
    shadow: null,
    from,
    to,
    route: 'straight',
    startCap: 'none',
    endCap: 'arrow',
    ...overrides,
  };
}

// A en (0, 0, 100, 50) y B en (300, 200, 100, 50), unidos del lado derecho de A al izquierdo de B.
function setup(route = 'straight') {
  const doc = newDoc();
  const a = putNode(doc, rect({ x: 0, y: 0, w: 100, h: 50 }));
  const b = putNode(doc, rect({ x: 300, y: 200, w: 100, h: 50, index: 'a1' }));
  const c = putNode(doc, connector({ nodeId: a, anchor: 'right' }, { nodeId: b, anchor: 'left' }, { route }));
  const ctx = makeCore(doc);
  ctx.tick();
  const path = () => (ctx.sink.records.get(c) as ConnectorRecord).path!;
  return { ...ctx, a, b, c, path };
}

describe('conectores en el motor', () => {
  it('se dibujan en mundo entre las anclas de sus nodos', () => {
    const { path, core, c } = setup();
    expect(path()).toEqual([100, 25, 300, 225]);
    expect(core.geometryOf(c)).toEqual({ minX: 100, minY: 25, maxX: 300, maxY: 225 });
    expect([...core.connectorsOf('otro-nodo')]).toEqual([]);
  });

  it('el índice inverso recalcula el conector cuando su nodo cambia de caja, también al redimensionar o girar', () => {
    const { core, a, b, c, path, tick, doc } = setup();
    expect([...core.connectorsOf(a)]).toEqual([c]);
    expect([...core.connectorsOf(b)]).toEqual([c]);
    // B se hace el doble de alto: el centro de su lado izquierdo baja.
    core.commands.commitTransform([b], [1, 0, 0, 2, 0, -200]);
    tick();
    expect(routeEnd(path())).toEqual({ x: 300, y: 250 });
    // A gira 90°: su lado derecho pasa a estar abajo.
    doc.transact(() => nodeMap(doc, a).set('rotation', Math.PI / 2), 'remote');
    tick();
    const start = routeStart(path());
    expect(start.x).toBeCloseTo(50);
    expect(start.y).toBeCloseTo(75);
  });

  it('un update de otro cliente pinta el nodo en su frame y recalcula el conector en el siguiente', () => {
    const { core, a, path, tick, doc } = setup();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.on('update', (update: Uint8Array) => Y.applyUpdate(doc, update, 'remote'));
    remote.transact(() => nodeMap(remote, a).set('y', 100));
    tick();
    expect(core.geometryOf(a)?.minY).toBe(100);
    expect(routeStart(path())).toEqual({ x: 100, y: 25 });
    expect(core.scheduler.pending).toBe(true);
    tick();
    expect(routeStart(path())).toEqual({ x: 100, y: 125 });
    // Un cambio propio recalcula el conector en el mismo frame.
    core.commands.commitTransform([a], [1, 0, 0, 1, 0, 50]);
    tick();
    expect(routeStart(path())).toEqual({ x: 100, y: 175 });
  });

  it('durante el arrastre de un extremo el conector se recalcula sin escribir en el documento', () => {
    const { core, a, c, sink, tick, doc } = setup();
    let writes = 0;
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin === LOCAL_ORIGIN && tr.changed.size > 0) writes++;
    });
    core.setSelection([a]);
    const ctl = core.controller;
    ctl.pointerDown(pointer(50, 25));
    ctl.pointerMove(pointer(60, 25, { ctrl: true }));
    tick();
    ctl.pointerMove(pointer(90, 45, { ctrl: true }));
    tick();
    const preview = sink.overrides.get(c)!;
    expect(preview.redraw).toBe(true);
    expect(routeStart((preview.record as ConnectorRecord).path!)).toEqual({ x: 140, y: 45 });
    expect(writes).toBe(0);
    ctl.pointerUp(pointer(90, 45, { ctrl: true }));
    tick();
    expect(writes).toBe(1);
    expect(sink.overrides.has(c)).toBe(false);
    expect(routeStart((sink.records.get(c) as ConnectorRecord).path!)).toEqual({ x: 140, y: 45 });
    // La caja de los extremos se pone al día en la misma transacción.
    expect(nodeMap(doc, c).get('x')).toBe(140);
  });

  it('un texto que crece al escribir pone al día la caja de los extremos de sus conectores', () => {
    const { core, a, doc, sink, tick } = setup();
    const text = core.commands.createText({ x: 300, y: 400 })!;
    tick();
    const connectorId = core.commands.createConnector({ nodeId: a, anchor: 'right' }, { nodeId: text, anchor: 'bottom' }, 'straight')!;
    tick();
    const record = core.record(text)!;
    let transactions = 0;
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin === LOCAL_ORIGIN && tr.changed.size > 0) transactions++;
    });
    core.commands.fitText(text, { h: record.h + 100 });
    expect(transactions).toBe(1);
    const box = nodeMap(doc, connectorId).toJSON() as { x: number; y: number; w: number; h: number };
    expect(box.x + box.w).toBeCloseTo(record.x + record.w / 2);
    expect(box.y + box.h).toBeCloseTo(record.y + record.h + 100);
    tick();
    expect(routeEnd((sink.records.get(connectorId) as ConnectorRecord).path!).y).toBeCloseTo(record.y + record.h + 100);
  });

  it('borrar un extremo localmente lo convierte en coordenada libre en la misma transacción', () => {
    const { core, b, c, doc, tick } = setup();
    const transactions: number[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin === LOCAL_ORIGIN) transactions.push(tr.changed.size);
    });
    core.setSelection([b]);
    core.commands.deleteSelection();
    tick();
    expect(transactions).toHaveLength(1);
    expect(nodeMap(doc, c).get('to')).toEqual({ x: 300, y: 225 });
    expect(nodeMap(doc, c).get('from')).toMatchObject({ anchor: 'right' });
    expect(NodeSchema.safeParse(nodeMap(doc, c).toJSON()).success).toBe(true);
    // Deshacer devuelve el nodo y el ancla a la vez.
    core.commands.undo();
    tick();
    expect(nodeMap(doc, c).get('to')).toEqual({ nodeId: b, anchor: 'left' });
  });

  it('si el borrado llega de otro usuario, se pinta en el último punto y el servidor lo deja libre ahí', () => {
    const { core, b, c, doc, path, tick } = setup('elbow');
    core.commands.commitTransform([b], [1, 0, 0, 1, 20, 10]);
    tick();
    const before = routeEnd(path());
    // Otra réplica, que no conoce la conversión, borra B.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.transact(() => remote.getMap(ROOT_KEYS.nodes).delete(b));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'remote');
    tick();
    expect(routeEnd(path())).toEqual(before);
    expect(nodeMap(doc, c).get('to')).toEqual({ nodeId: b, anchor: 'left' });
    // La normalización del servidor escribe ese mismo punto a partir de la caja de los extremos.
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    const touches = createTouches();
    touches.deletedNodes.add(b);
    normalizeDocument(server, touches, serverOrigin('server-normalize'));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), 'remote');
    tick();
    expect(nodeMap(doc, c).get('to')).toEqual(before);
    expect(routeEnd(path())).toEqual(before);
  });

  it('la herramienta C crea un conector anclado del nodo de origen al de destino', () => {
    const { core, a, b, tick } = setup();
    core.commands.setTool('connector');
    const ctl = core.controller;
    ctl.pointerDown(pointer(98, 25));
    ctl.pointerMove(pointer(200, 100));
    tick();
    ctl.pointerMove(pointer(302, 226));
    tick();
    ctl.pointerUp(pointer(302, 226));
    tick();
    const created = core.selection.get()[0]!;
    const record = core.record(created);
    expect(record?.type).toBe('connector');
    if (record?.type !== 'connector') return;
    expect(record.from).toEqual({ nodeId: a, anchor: 'right' });
    expect(record.to).toEqual({ nodeId: b, anchor: 'left' });
    expect(core.tool.get()).toBe('select');
  });

  it('el handle de un extremo lo suelta en el vacío como punto libre', () => {
    const { core, c, tick } = setup();
    core.setSelection([c]);
    tick();
    const ctl = core.controller;
    ctl.pointerDown(pointer(300, 225));
    ctl.pointerMove(pointer(500, 400));
    tick();
    ctl.pointerMove(pointer(520, 410));
    tick();
    ctl.pointerUp(pointer(520, 410));
    tick();
    const record = core.record(c);
    expect(record?.type === 'connector' && record.to).toEqual({ x: 520, y: 410 });
  });

  it('copiar un conector con sus dos nodos lo ancla a las copias', () => {
    const { core, a, b, c, tick } = setup();
    core.setSelection([a, b, c]);
    core.commands.duplicateSelection();
    tick();
    const copies = core.selection.get().map((id) => core.record(id)!);
    const copy = copies.find((record) => record.type === 'connector');
    const ids = new Set(copies.map((record) => record.id));
    expect(copy?.type === 'connector' && 'nodeId' in copy.from && ids.has(copy.from.nodeId)).toBe(true);
    expect(copy?.type === 'connector' && 'nodeId' in copy.to && ids.has(copy.to.nodeId)).toBe(true);
  });
});

