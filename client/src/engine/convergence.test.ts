import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOT_KEYS, serverOrigin } from '../shared/document/keys.js';
import { createTouches, normalizeDocument } from '../shared/document/normalize.js';
import { AnimationSchema, NodeSchema } from '../shared/document/schema.js';
import { AnimationCommands } from './commands/animation.ts';
import { compareOrder } from './model/order.ts';
import { connectorNode, frame, group, makeCore, newDoc, nodeMap, PAGE_ID, putNode, rect } from './test-utils.ts';

// Réplicas en memoria: los cambios se hacen «sin conexión» y después se intercambian todos los updates.
function replicas(count: number, seed: (doc: Y.Doc) => void) {
  const base = newDoc();
  seed(base);
  const state = Y.encodeStateAsUpdate(base);
  return Array.from({ length: count }, (_, i) => {
    const doc = new Y.Doc();
    doc.clientID = 100 + i;
    Y.applyUpdate(doc, state, 'remote');
    return makeCore(doc, { user: { id: `user-${i}`, name: `U${i}`, color: '#FB8F5A', avatarAssetId: null } });
  });
}

function syncAll(docs: Y.Doc[]) {
  const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc));
  for (const doc of docs) for (const update of updates) Y.applyUpdate(doc, update, 'remote');
}

function snapshot(doc: Y.Doc) {
  return doc.getMap(ROOT_KEYS.nodes).toJSON();
}

function expectConverged(cores: ReturnType<typeof makeCore>[]) {
  for (const c of cores) c.tick();
  const [first, ...rest] = cores;
  for (const other of rest) expect(snapshot(other!.doc)).toEqual(snapshot(first!.doc));
  // Todos los clientes pintan lo mismo en el mismo orden.
  const order = first!.core.tree.paintOrder(PAGE_ID);
  for (const other of rest) expect(other!.core.tree.paintOrder(PAGE_ID)).toEqual(order);
  for (const node of Object.values(snapshot(first!.doc))) expect(NodeSchema.safeParse(node).success).toBe(true);
}

// El servidor normaliza lo que tocaron los clientes y todos reciben sus correcciones.
function normalizeOnServer(cores: ReturnType<typeof makeCore>[], deleted: readonly string[] = []) {
  const server = new Y.Doc();
  for (const c of cores) Y.applyUpdate(server, Y.encodeStateAsUpdate(c.doc));
  const touches = createTouches();
  for (const id of server.getMap(ROOT_KEYS.nodes).keys()) touches.nodes.set(id, { actor: null, userId: null, created: false });
  for (const id of deleted) touches.deletedNodes.add(id);
  normalizeDocument(server, touches, serverOrigin('server-normalize'));
  const fix = Y.encodeStateAsUpdate(server);
  for (const c of cores) Y.applyUpdate(c.doc, fix, 'remote');
}

// Cada padre existe, es un contenedor de la misma página y subir por los padres siempre termina.
function expectValidTree(doc: Y.Doc) {
  const nodes = snapshot(doc) as Record<string, { id: string; type: string; pageId: string; parentId: string | null }>;
  for (const node of Object.values(nodes)) {
    const seen = new Set<string>([node.id]);
    let current = node;
    while (current.parentId) {
      const parent = nodes[current.parentId];
      expect(parent, `padre de ${current.id}`).toBeDefined();
      expect(['group', 'frame']).toContain(parent!.type);
      expect(parent!.pageId).toBe(current.pageId);
      expect(seen.has(parent!.id)).toBe(false);
      seen.add(parent!.id);
      current = parent!;
    }
  }
}

describe('convergencia de grupos y frames con tres réplicas', () => {
  it('A agrupa dentro de un grupo mientras B borra ese grupo y C mueve un nodo: convergen sin padres rotos', () => {
    let g = '';
    let x = '';
    let y = '';
    const cores = replicas(3, (doc) => {
      y = putNode(doc, rect({ x: 0, y: 300, index: 'a0' }));
      g = putNode(doc, group({ x: 100, y: 100, index: 'a1' }));
      x = putNode(doc, rect({ parentId: g, x: 0, y: 0 }));
    });
    const [a, b, c] = cores as [ReturnType<typeof makeCore>, ReturnType<typeof makeCore>, ReturnType<typeof makeCore>];
    // A agrupa X (dentro de G, el más alto) con Y: el grupo nuevo queda dentro de G.
    a.core.setSelection([x, y]);
    const h = a.core.commands.groupSelection()!;
    expect(a.core.record(h)?.parentId).toBe(g);
    // B borra G con lo que tiene dentro.
    b.core.setSelection([g]);
    b.core.commands.deleteSelection();
    // C mueve Y.
    c.core.setSelection([y]);
    c.core.commands.nudge(25, 0);

    syncAll(cores.map((r) => r.doc));
    for (const r of cores) r.tick();
    // Antes de normalizar, todos tratan igual al grupo huérfano: como raíz.
    for (const r of cores) expect(r.core.tree.parent(h)).toBeNull();
    normalizeOnServer(cores, [g, x]);
    expectConverged(cores);
    expectValidTree(a.doc);
    const nodes = a.doc.getMap(ROOT_KEYS.nodes);
    expect(nodes.has(g) || nodes.has(x)).toBe(false);
    expect(nodeMap(a.doc, h).get('parentId')).toBeNull();
    expect(nodeMap(a.doc, y).get('parentId')).toBe(h);
  });

  it('dos personas meten a la vez un frame dentro del otro y una tercera crea dentro: sin ciclos tras normalizar', () => {
    let f1 = '';
    let f2 = '';
    const cores = replicas(3, (doc) => {
      f1 = putNode(doc, frame({ x: 0, y: 0, w: 300, h: 300, index: 'a0' }));
      f2 = putNode(doc, frame({ x: 500, y: 0, w: 300, h: 300, index: 'a1' }));
    });
    const [a, b, c] = cores as [ReturnType<typeof makeCore>, ReturnType<typeof makeCore>, ReturnType<typeof makeCore>];
    a.core.commands.commitTransform([f1], [1, 0, 0, 1, 520, 0], { drop: { x: 650, y: 150 } });
    expect(a.core.record(f1)?.parentId).toBe(f2);
    b.core.commands.commitTransform([f2], [1, 0, 0, 1, -480, 0], { drop: { x: 150, y: 150 } });
    expect(b.core.record(f2)?.parentId).toBe(f1);
    const inside = c.core.commands.createShape('rect', { x: 50, y: 50, w: 40, h: 40 })!;
    expect(c.core.record(inside)?.parentId).toBe(f1);

    syncAll(cores.map((r) => r.doc));
    for (const r of cores) r.tick();
    // El ciclo se pinta igual en todos: los dos frames como raíz.
    for (const r of cores) {
      expect(r.core.tree.parent(f1)).toBeNull();
      expect(r.core.tree.parent(f2)).toBeNull();
    }
    normalizeOnServer(cores);
    expectConverged(cores);
    expectValidTree(a.doc);
    const parents = [f1, f2].map((id) => nodeMap(a.doc, id).get('parentId'));
    expect(parents.filter((parent) => parent !== null)).toHaveLength(1);
    expect(nodeMap(a.doc, inside).get('parentId')).toBe(f1);
  });
});

describe('convergencia con varias réplicas', () => {
  it('tres usuarios mueven el mismo nodo a la vez y quedan iguales', () => {
    let id = '';
    const cores = replicas(3, (doc) => {
      id = putNode(doc, rect({ x: 0, y: 0 }));
    });
    cores.forEach(({ core }, i) => {
      core.setSelection([id]);
      core.commands.commitTransform([id], [1, 0, 0, 1, (i + 1) * 10, (i + 1) * 5]);
    });
    syncAll(cores.map((c) => c.doc));
    expectConverged(cores);
    expect([10, 20, 30]).toContain(nodeMap(cores[0]!.doc, id).get('x'));
  });

  it('dos usuarios reindexan el mismo padre a la vez y el orden relativo se conserva', () => {
    const long = (n: number) => 'a0' + 'V'.repeat(64) + String(n + 1);
    const ids: string[] = [];
    const cores = replicas(2, (doc) => {
      for (let i = 0; i < 5; i++) ids.push(putNode(doc, rect({ x: i * 120, index: long(i) })));
    });
    const before = cores[0]!.core.tree.paintOrder(PAGE_ID);
    expect(before).toEqual(ids);
    // Cada uno añade una forma encima: las claves largas obligan a reindexar a los hermanos.
    const created = cores.map(({ core }) => core.commands.createShape('rect', { x: 0, y: 500, w: 50, h: 50 })!);
    syncAll(cores.map((c) => c.doc));
    expectConverged(cores);
    const after = cores[0]!.core.tree.paintOrder(PAGE_ID);
    expect(after.filter((id) => ids.includes(id))).toEqual(ids);
    expect(after.slice(-2).sort()).toEqual([...created].sort());
    for (const node of Object.values(snapshot(cores[0]!.doc)) as Array<{ index: string }>) expect(node.index.length).toBeLessThanOrEqual(64);
  });

  it('uno borra mientras otro mueve: el nodo desaparece en todos', () => {
    let id = '';
    const cores = replicas(2, (doc) => {
      id = putNode(doc, rect());
    });
    cores[0]!.core.setSelection([id]);
    cores[0]!.core.commands.deleteSelection();
    cores[1]!.core.setSelection([id]);
    cores[1]!.core.commands.commitTransform([id], [1, 0, 0, 1, 50, 50]);
    syncAll(cores.map((c) => c.doc));
    expectConverged(cores);
    expect(cores[1]!.doc.getMap(ROOT_KEYS.nodes).has(id)).toBe(false);
    expect(cores[1]!.core.selection.get()).toEqual([]);
  });

  it('un ciclo creado a la vez se pinta igual en todos y la normalización lo repara', () => {
    const g1: Record<string, unknown> = { ...rect(), type: 'group', w: 0, h: 0 };
    const g2: Record<string, unknown> = { ...rect(), type: 'group', w: 0, h: 0, index: 'a1' };
    const cores = replicas(2, (doc) => {
      putNode(doc, g1);
      putNode(doc, g2);
    });
    cores[0]!.doc.transact(() => nodeMap(cores[0]!.doc, g1.id as string).set('parentId', g2.id));
    cores[1]!.doc.transact(() => nodeMap(cores[1]!.doc, g2.id as string).set('parentId', g1.id));
    syncAll(cores.map((c) => c.doc));
    for (const c of cores) c.tick();
    for (const { core } of cores) {
      expect(core.tree.parent(g1.id as string)).toBeNull();
      expect(core.tree.parent(g2.id as string)).toBeNull();
    }
    // El servidor aplica la misma normalización compartida y todos convergen a un árbol sin ciclos.
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(cores[0]!.doc));
    const touches = createTouches();
    for (const id of [g1.id, g2.id] as string[]) touches.nodes.set(id, { actor: null, userId: null, created: false });
    normalizeDocument(server, touches, serverOrigin('server-normalize'));
    const fix = Y.encodeStateAsUpdate(server);
    for (const c of cores) Y.applyUpdate(c.doc, fix, 'remote');
    expectConverged(cores);
    const parents = [g1, g2].map((g) => nodeMap(cores[0]!.doc, g.id as string).get('parentId'));
    expect(parents.filter((p) => p !== null).length).toBeLessThanOrEqual(1);
    const records = Object.values(snapshot(cores[0]!.doc)) as Array<{ id: string; index: string }>;
    expect([...records].sort(compareOrder)).toHaveLength(2);
  });
});

describe('convergencia de los waypoints de un conector (CA-1.6)', () => {
  it('dos personas editan, restablecen y cambian el recorrido del mismo conector a la vez y convergen', () => {
    let connector = '';
    const cores = replicas(2, (doc) => {
      const a = putNode(doc, rect({ x: 0, y: 0, index: 'a0' }));
      const b = putNode(doc, rect({ x: 300, y: 200, index: 'a1' }));
      connector = putNode(doc, connectorNode({ nodeId: a, anchor: 'right' }, { nodeId: b, anchor: 'left' }, { waypoints: [[150, 25]] }));
    });
    const [ana, bea] = cores as [ReturnType<typeof makeCore>, ReturnType<typeof makeCore>];
    const sameRoute = () => {
      expectConverged(cores);
      expect(ana.core.routeOf(connector)).toEqual(bea.core.routeOf(connector));
    };

    // Ana mueve el punto de paso y Bea añade otro.
    expect(ana.core.commands.setConnectorPath(connector, { waypoints: [{ x: 150, y: 100 }] })).toBe(true);
    expect(bea.core.commands.setConnectorPath(connector, { waypoints: [{ x: 150, y: 25 }, { x: 220, y: 225 }] })).toBe(true);
    syncAll(cores.map((r) => r.doc));
    sameRoute();
    expect([[[150, 100]], [[150, 25], [220, 225]]]).toContainEqual(nodeMap(ana.doc, connector).get('waypoints'));

    // Ana restablece el recorrido mientras Bea mueve un punto.
    ana.core.commands.resetConnectorPath(connector);
    expect(nodeMap(ana.doc, connector).has('waypoints')).toBe(false);
    expect(bea.core.commands.setConnectorPath(connector, { waypoints: [{ x: 200, y: 60 }] })).toBe(true);
    syncAll(cores.map((r) => r.doc));
    sameRoute();

    // Ana pasa a codo (quita los waypoints en la misma transacción) mientras Bea escribe otros.
    expect(bea.core.commands.setConnectorPath(connector, { waypoints: [{ x: 120, y: 40 }] })).toBe(true);
    syncAll(cores.map((r) => r.doc));
    for (const r of cores) r.tick();
    ana.core.commands.setStyle({ route: 'elbow' }, [connector]);
    expect(nodeMap(ana.doc, connector).get('route')).toBe('elbow');
    expect(nodeMap(ana.doc, connector).has('waypoints')).toBe(false);
    bea.core.commands.setConnectorPath(connector, { waypoints: [{ x: 160, y: 40 }] });
    syncAll(cores.map((r) => r.doc));
    sameRoute();
  });
});

describe('convergencia de keyframes', () => {
  it('dos clientes mueven a la vez keyframes distintos de la misma pista: convergen sin perder ninguno (CA-5.7)', () => {
    let id = '';
    const cores = replicas(2, (doc) => {
      id = putNode(doc, rect());
      doc.transact(() => {
        const animation = new Y.Map<unknown>();
        for (const [key, value] of Object.entries({ duration: 1000, delay: 0, loop: 1, direction: 'normal', autoplay: 'none' })) animation.set(key, value);
        const tracks = new Y.Map<unknown>();
        const track = new Y.Map<unknown>();
        track.set('k1', { t: 0.2, v: 10, e: 'linear' });
        track.set('k2', { t: 0.6, v: 60, e: 'linear' });
        track.set('k3', { t: 1, v: 100, e: 'linear' });
        tracks.set('offsetX', track);
        animation.set('tracks', tracks);
        doc.getMap(ROOT_KEYS.animations).set(id, animation);
      }, 'remote');
    });
    const [a, b] = cores as [ReturnType<typeof makeCore>, ReturnType<typeof makeCore>];
    a.tick();
    b.tick();
    const ka = new AnimationCommands(a.core);
    const kb = new AnimationCommands(b.core);
    expect(ka.moveKeyframes([{ nodeId: id, prop: 'offsetX', key: 'k1' }], 100)).toBe(true);
    expect(kb.moveKeyframes([{ nodeId: id, prop: 'offsetX', key: 'k2' }], -100)).toBe(true);
    a.tick();
    b.tick();
    syncAll([a.doc, b.doc]);
    a.tick();
    b.tick();
    const json = (doc: Y.Doc) => doc.getMap(ROOT_KEYS.animations).toJSON();
    expect(json(b.doc)).toEqual(json(a.doc));
    expect(AnimationSchema.safeParse(json(a.doc)[id]).success).toBe(true);
    for (const { core } of cores) {
      const track = core.store.animation(id)!.tracks.offsetX!;
      expect(Object.keys(track).sort()).toEqual(['k1', 'k2', 'k3']);
      expect(track.k1).toMatchObject({ t: 0.3, v: 10 });
      expect(track.k2).toMatchObject({ t: 0.5, v: 60 });
      expect(track.k3).toMatchObject({ t: 1, v: 100 });
    }
  });
});
