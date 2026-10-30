import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newNodeId } from '../../src/shared/document/ids.js';
import { initDocument } from '../../src/shared/document/init.js';
import { ROOT_KEYS, serverOrigin } from '../../src/shared/document/keys.js';
import {
  createTouches,
  hasTouches,
  normalizeDocument,
  normalizeRotation,
  planNormalization,
  recordTouches,
  type Touches,
} from '../../src/shared/document/normalize.js';
import { NodeSchema } from '../../src/shared/document/schema.js';

const USER = 'user_real';
const ACTOR = 'socket-1';
const ORIGIN = serverOrigin('server-normalize');

function rect(id: string, pageId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'rect',
    pageId,
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    createdBy: USER,
    fill: '#FF6B4AFF',
    stroke: null,
    strokeWidth: 1,
    strokeDash: 'solid',
    shadow: null,
    cornerRadius: 4,
    ...overrides,
  };
}

function connectorProps(id: string, pageId: string, overrides: Record<string, unknown> = {}) {
  const { cornerRadius: _cornerRadius, ...shape } = rect(id, pageId);
  return {
    ...shape,
    type: 'connector',
    from: { x: 0, y: 0 },
    to: { x: 100, y: 50 },
    route: 'straight',
    startCap: 'none',
    endCap: 'arrow',
    ...overrides,
  };
}

function textProps(id: string, pageId: string, overrides: Record<string, unknown> = {}) {
  const { fill: _fill, stroke: _stroke, strokeWidth: _sw, strokeDash: _sd, shadow: _sh, cornerRadius: _cr, ...base } = rect(id, pageId);
  return {
    ...base,
    type: 'text',
    fontFamily: 'Manrope',
    fontSize: 16,
    fontWeight: 400,
    italic: false,
    underline: false,
    strike: false,
    color: '#FFFFFFFF',
    align: 'left',
    lineHeight: 1.2,
    autoWidth: true,
    ...overrides,
  };
}

function toMap(props: Record<string, unknown>) {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(props)) map.set(key, value);
  return map;
}

// Documento con una página y un registro de lo que toca la «conexión» de pruebas.
function setup() {
  const doc = new Y.Doc();
  const { pageId } = initDocument(doc);
  let touches = createTouches();
  let who = { actor: ACTOR as string | null, userId: USER as string | null };
  const roots = ['nodes', 'pages', 'texts', 'animations'] as const;
  for (const root of roots) {
    const type = doc.getMap(ROOT_KEYS[root]);
    type.observeDeep((events, transaction) => {
      if (transaction.origin !== 'client') return;
      recordTouches(touches, root, type as Y.AbstractType<unknown>, events, who);
    });
  }
  const nodes = doc.getMap<Y.Map<unknown>>(ROOT_KEYS.nodes);
  return {
    doc,
    pageId: pageId!,
    nodes,
    texts: doc.getMap<Y.Text>(ROOT_KEYS.texts),
    animations: doc.getMap<Y.Map<unknown>>(ROOT_KEYS.animations),
    pages: doc.getMap<Y.Map<unknown>>(ROOT_KEYS.pages),
    client(fn: () => void, as: { actor: string | null; userId: string | null } = { actor: ACTOR, userId: USER }) {
      who = as;
      doc.transact(fn, 'client');
    },
    take(): Touches {
      const current = touches;
      touches = createTouches();
      return current;
    },
    node(id: string) {
      return nodes.get(id)?.toJSON() as Record<string, unknown> | undefined;
    },
  };
}

function seedValid(ctx: ReturnType<typeof setup>, id: string, overrides: Record<string, unknown> = {}) {
  ctx.doc.transact(() => ctx.nodes.set(id, toMap(rect(id, ctx.pageId, overrides))));
}

describe('normalización', () => {
  it('un nodo válido no produce correcciones', () => {
    const ctx = setup();
    const id = newNodeId();
    ctx.client(() => ctx.nodes.set(id, toMap(rect(id, ctx.pageId))));
    const touches = ctx.take();
    expect(hasTouches(touches)).toBe(true);
    expect(touches.nodes.get(id)).toMatchObject({ actor: ACTOR, userId: USER, created: true });
    expect(planNormalization(ctx.doc, touches).corrections).toEqual([]);
  });

  it('recorta valores a sus límites y normaliza la rotación', () => {
    const ctx = setup();
    const id = newNodeId();
    ctx.client(() =>
      ctx.nodes.set(
        id,
        toMap(rect(id, ctx.pageId, { x: 5e6, y: -Infinity, w: 2e5, h: 80, opacity: 3, strokeWidth: 999, cornerRadius: 500, rotation: 3 * Math.PI, name: 'n'.repeat(120), shadow: { x: 5000, y: 0, blur: 900, color: '#000000FF' } })),
      ),
    );
    const result = normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    const node = ctx.node(id)!;
    expect(node).toMatchObject({ x: 1e6, y: 0, w: 1e5, h: 80, opacity: 1, strokeWidth: 200, cornerRadius: 40 });
    expect(Math.abs(node.rotation as number)).toBeCloseTo(Math.PI);
    expect(node.name).toHaveLength(80);
    expect(node.shadow).toEqual({ x: 1000, y: 0, blur: 100, color: '#000000FF' });
    expect(NodeSchema.safeParse(node).success).toBe(true);
    expect(result.corrections.every((c) => c.actor === ACTOR)).toBe(true);
    expect(result.corrections.length).toBeGreaterThanOrEqual(9);
  });

  it('normalizeRotation lleva cualquier ángulo a [-π, π]', () => {
    expect(normalizeRotation(0.5)).toBe(0.5);
    expect(normalizeRotation(2 * Math.PI + 0.25)).toBeCloseTo(0.25);
    expect(normalizeRotation(-3 * Math.PI - 0.25)).toBeCloseTo(Math.PI - 0.25);
    expect(normalizeRotation(Number.NaN)).toBe(0);
  });

  it('parentId inexistente, de otra página, que no es contenedor o en ciclo → null', () => {
    const ctx = setup();
    const otherPage = newNodeId();
    ctx.doc.transact(() => ctx.pages.set(otherPage, toMap({ name: 'Otra', index: 'a1' })));
    const plain = newNodeId();
    const groupElsewhere = newNodeId();
    seedValid(ctx, plain);
    ctx.doc.transact(() =>
      ctx.nodes.set(groupElsewhere, toMap({ ...rect(groupElsewhere, otherPage), type: 'group', w: 0, h: 0 })),
    );
    const a = newNodeId();
    const b = newNodeId();
    const c = newNodeId();
    const d = newNodeId();
    ctx.client(() => {
      ctx.nodes.set(a, toMap(rect(a, ctx.pageId, { parentId: newNodeId() })));
      ctx.nodes.set(b, toMap(rect(b, ctx.pageId, { parentId: plain })));
      ctx.nodes.set(c, toMap(rect(c, ctx.pageId, { parentId: groupElsewhere })));
      ctx.nodes.set(d, toMap(rect(d, ctx.pageId, { parentId: 'no-es-un-id' })));
    });
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    for (const id of [a, b, c, d]) expect(ctx.node(id)!.parentId).toBeNull();

    const g1 = newNodeId();
    const g2 = newNodeId();
    ctx.doc.transact(() => {
      ctx.nodes.set(g1, toMap({ ...rect(g1, ctx.pageId), type: 'group', w: 0, h: 0 }));
      ctx.nodes.set(g2, toMap({ ...rect(g2, ctx.pageId), type: 'group', w: 0, h: 0, parentId: g1 }));
    });
    ctx.client(() => ctx.nodes.get(g1)!.set('parentId', g2));
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    const parents = [ctx.node(g1)!.parentId, ctx.node(g2)!.parentId];
    expect(parents.filter((p) => p === null)).toHaveLength(1);
  });

  it('createdBy falso al crear → userId real; cambiarlo después → se restaura', () => {
    const ctx = setup();
    const id = newNodeId();
    ctx.client(() => ctx.nodes.set(id, toMap(rect(id, ctx.pageId, { createdBy: 'impostor' }))));
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    expect(ctx.node(id)!.createdBy).toBe(USER);

    ctx.client(() => ctx.nodes.get(id)!.set('createdBy', 'otro'), { actor: 'socket-2', userId: 'user_2' });
    const result = normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    expect(ctx.node(id)!.createdBy).toBe(USER);
    expect(result.corrections).toEqual([expect.objectContaining({ key: 'createdBy', actor: 'socket-2' })]);
  });

  it('un conector colgante pasa a coordenadas libres, sin strike', () => {
    const ctx = setup();
    const target = newNodeId();
    const connector = newNodeId();
    seedValid(ctx, target);
    ctx.doc.transact(() =>
      ctx.nodes.set(
        connector,
        toMap({
          ...rect(connector, ctx.pageId, { x: 10, y: 20, w: 30, h: 40 }),
          type: 'connector',
          from: { nodeId: target, anchor: 'right' },
          to: { x: 0, y: 0 },
          route: 'straight',
          startCap: 'none',
          endCap: 'arrow',
        }),
      ),
    );
    ctx.client(() => ctx.nodes.delete(target));
    const touches = ctx.take();
    expect([...touches.deletedNodes]).toEqual([target]);
    const result = normalizeDocument(ctx.doc, touches, ORIGIN);
    expect(ctx.node(connector)!.from).toEqual({ x: 10, y: 20 });
    expect(result.corrections.every((c) => c.actor === null)).toBe(true);
  });

  it('el extremo colgante toma el último punto que guarda la caja del conector, con su sentido', () => {
    const ctx = setup();
    const start = newNodeId();
    const end = newNodeId();
    const connector = newNodeId();
    seedValid(ctx, start);
    seedValid(ctx, end);
    // El inicio está abajo a la derecha (flipX y flipY) y el final arriba a la izquierda.
    ctx.doc.transact(() =>
      ctx.nodes.set(
        connector,
        toMap({
          ...rect(connector, ctx.pageId, { x: 100, y: 50, w: 200, h: 80, flipX: true, flipY: true }),
          type: 'connector',
          from: { nodeId: start, anchor: 'left' },
          to: { nodeId: end, anchor: { u: 1, v: 0.5 } },
          route: 'elbow',
          startCap: 'none',
          endCap: 'arrow',
        }),
      ),
    );
    ctx.client(() => {
      ctx.nodes.delete(start);
      ctx.nodes.delete(end);
    });
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    expect(ctx.node(connector)!.from).toEqual({ x: 300, y: 130 });
    expect(ctx.node(connector)!.to).toEqual({ x: 100, y: 50 });
  });

  it('un conector a un nodo de otra página o a sí mismo también queda libre', () => {
    const ctx = setup();
    const page2 = newNodeId();
    const other = newNodeId();
    const connector = newNodeId();
    ctx.doc.transact(() => {
      ctx.pages.set(page2, toMap({ name: 'Página 2', index: 'a1' }));
      ctx.nodes.set(other, toMap(rect(other, page2)));
    });
    ctx.client(() =>
      ctx.nodes.set(
        connector,
        toMap({
          ...rect(connector, ctx.pageId, { x: 0, y: 0, w: 50, h: 10 }),
          type: 'connector',
          from: { nodeId: other, anchor: 'top' },
          to: { nodeId: connector, anchor: 'center' },
          route: 'curved',
          startCap: 'none',
          endCap: 'none',
        }),
      ),
    );
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    expect(ctx.node(connector)!.from).toEqual({ x: 0, y: 0 });
    expect(ctx.node(connector)!.to).toEqual({ x: 50, y: 10 });
  });

  it('recorta los waypoints del conector y quita los que no son una lista o quedan vacíos', () => {
    const ctx = setup();
    const long = newNodeId();
    const empty = newNodeId();
    const broken = newNodeId();
    const mixed = newNodeId();
    const allBad = newNodeId();
    const waypoints = Array.from({ length: 70 }, (_, i) => [i, i]);
    waypoints[3] = [5e6, -Infinity];
    ctx.client(() => {
      ctx.nodes.set(long, toMap(connectorProps(long, ctx.pageId, { waypoints })));
      ctx.nodes.set(empty, toMap(connectorProps(empty, ctx.pageId, { waypoints: [] })));
      ctx.nodes.set(broken, toMap(connectorProps(broken, ctx.pageId, { waypoints: 'codo' })));
      ctx.nodes.set(mixed, toMap(connectorProps(mixed, ctx.pageId, { waypoints: [[1, 2], 'codo', [3, '4'], [5], [5, 6]] })));
      ctx.nodes.set(allBad, toMap(connectorProps(allBad, ctx.pageId, { waypoints: [['a', 'b'], null] })));
    });
    const touches = ctx.take();
    const result = normalizeDocument(ctx.doc, touches, ORIGIN);

    const kept = ctx.node(long)!.waypoints as number[][];
    expect(kept).toHaveLength(64);
    expect(kept[3]).toEqual([1e6, 0]);
    expect(kept[63]).toEqual([63, 63]);
    expect(ctx.node(mixed)!.waypoints).toEqual([
      [1, 2],
      [5, 6],
    ]);
    for (const id of [empty, broken, allBad]) {
      expect(ctx.node(id)).toBeDefined();
      expect('waypoints' in ctx.node(id)!).toBe(false);
    }
    for (const id of [long, empty, broken, mixed, allBad]) expect(NodeSchema.safeParse(ctx.node(id)).success).toBe(true);
    expect(result.corrections.filter((c) => c.reason === 'connector_waypoints')).toEqual([
      expect.objectContaining({ op: 'unset', target: 'node', key: 'waypoints', actor: ACTOR }),
      expect.objectContaining({ op: 'unset', target: 'node', key: 'waypoints', actor: ACTOR }),
      expect.objectContaining({ op: 'unset', target: 'node', key: 'waypoints', actor: ACTOR }),
    ]);
    expect(planNormalization(ctx.doc, touches).corrections).toEqual([]);
  });

  it('quita un fixedHeight que no es booleano y conserva el texto', () => {
    const ctx = setup();
    const id = newNodeId();
    const fixed = newNodeId();
    ctx.client(() => {
      ctx.nodes.set(id, toMap(textProps(id, ctx.pageId, { autoWidth: false, fixedHeight: 'sí' })));
      ctx.nodes.set(fixed, toMap(textProps(fixed, ctx.pageId, { autoWidth: false, fixedHeight: true })));
    });
    const result = normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    expect(result.corrections).toEqual([
      expect.objectContaining({ op: 'unset', id, key: 'fixedHeight', reason: 'text_fixed_height' }),
    ]);
    expect('fixedHeight' in ctx.node(id)!).toBe(false);
    expect(NodeSchema.safeParse(ctx.node(id)).success).toBe(true);
    expect(ctx.node(fixed)!.fixedHeight).toBe(true);
  });

  it('una animación con scale: 0 y opacidad fuera de rango sale sin correcciones', () => {
    const ctx = setup();
    const id = newNodeId();
    seedValid(ctx, id);
    ctx.client(() =>
      ctx.animations.set(
        id,
        toMap({
          duration: 1000,
          delay: 0,
          loop: 1,
          direction: 'normal',
          autoplay: 'present',
          tracks: {
            scale: { a: { t: 0, v: 0, e: 'easeOutBack' }, b: { t: 1, v: 1, e: 'linear' } },
            opacity: { c: { t: 0, v: 0, e: 'linear' }, d: { t: 1, v: 1.2, e: 'linear' } },
            scaleX: { e: { t: 0.5, v: 2, e: 'linear' } },
          },
        }),
      ),
    );
    expect(normalizeDocument(ctx.doc, ctx.take(), ORIGIN).corrections).toEqual([]);
    expect(ctx.animations.has(id)).toBe(true);
  });

  it('borra lo irrecuperable: tipo desconocido, claves requeridas ausentes y entradas que no son mapas', () => {
    const ctx = setup();
    const unknown = newNodeId();
    const missing = newNodeId();
    const notMap = newNodeId();
    const withoutPage = newNodeId();
    ctx.client(() => {
      ctx.nodes.set(unknown, toMap({ ...rect(unknown, ctx.pageId), type: 'hexagon' }));
      const partial = rect(missing, ctx.pageId) as Record<string, unknown>;
      delete partial.fill;
      ctx.nodes.set(missing, toMap(partial));
      (ctx.nodes as Y.Map<unknown>).set(notMap, 'texto');
      ctx.nodes.set(withoutPage, toMap(rect(withoutPage, newNodeId())));
    });
    const result = normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    expect(ctx.nodes.size).toBe(0);
    expect(result.corrections.filter((c) => c.op === 'delete')).toHaveLength(4);
    expect(result.corrections.every((c) => c.actor === ACTOR)).toBe(true);
  });

  it('borra textos y animaciones huérfanos y trunca los textos largos', () => {
    const ctx = setup();
    const id = newNodeId();
    seedValid(ctx, id);
    const orphan = newNodeId();
    ctx.client(() => {
      const long = new Y.Text();
      long.insert(0, 'a'.repeat(30));
      ctx.texts.set(id, long);
      const lost = new Y.Text();
      lost.insert(0, 'hola');
      ctx.texts.set(orphan, lost);
      ctx.animations.set(orphan, toMap({ duration: 1000, delay: 0, loop: 1, direction: 'normal', autoplay: 'none', tracks: {} }));
    });
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN, { limits: { maxTextLength: 10 } });
    expect(ctx.texts.get(id)!.toString()).toBe('a'.repeat(10));
    expect(ctx.texts.has(orphan)).toBe(false);
    expect(ctx.animations.has(orphan)).toBe(false);
  });

  it('al borrar un nodo se van su texto y su animación, y sus hijos quedan en la raíz', () => {
    const ctx = setup();
    const group = newNodeId();
    const child = newNodeId();
    ctx.doc.transact(() => {
      ctx.nodes.set(group, toMap({ ...rect(group, ctx.pageId), type: 'group', w: 0, h: 0 }));
      ctx.nodes.set(child, toMap(rect(child, ctx.pageId, { parentId: group })));
      const text = new Y.Text();
      text.insert(0, 'etiqueta');
      ctx.texts.set(group, text);
      ctx.animations.set(group, toMap({ duration: 1000, delay: 0, loop: 1, direction: 'normal', autoplay: 'none', tracks: {} }));
    });
    ctx.client(() => ctx.nodes.delete(group));
    const result = normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    expect(ctx.node(child)!.parentId).toBeNull();
    expect(ctx.texts.has(group)).toBe(false);
    expect(ctx.animations.has(group)).toBe(false);
    expect(result.corrections.every((c) => c.actor === null)).toBe(true);
  });

  it('una animación inválida se borra', () => {
    const ctx = setup();
    const id = newNodeId();
    seedValid(ctx, id);
    ctx.client(() => ctx.animations.set(id, toMap({ duration: 5, delay: 0, loop: 1, direction: 'normal', autoplay: 'none', tracks: {} })));
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    expect(ctx.animations.has(id)).toBe(false);
  });

  it('borra los nodos creados por encima del límite y avisa', () => {
    const ctx = setup();
    seedValid(ctx, newNodeId());
    seedValid(ctx, newNodeId());
    const created = [newNodeId(), newNodeId(), newNodeId()];
    ctx.client(() => {
      for (const id of created) ctx.nodes.set(id, toMap(rect(id, ctx.pageId)));
    });
    const result = normalizeDocument(ctx.doc, ctx.take(), ORIGIN, { limits: { maxNodes: 3 } });
    expect(ctx.nodes.size).toBe(3);
    expect(result.limits).toEqual([
      { what: 'nodes', actor: ACTOR },
      { what: 'nodes', actor: ACTOR },
    ]);

    const page2 = newNodeId();
    ctx.doc.transact(() => ctx.pages.set(page2, toMap({ name: 'Dos', index: 'a1' })));
    const crowded = [newNodeId(), newNodeId()];
    ctx.client(() => {
      for (const id of crowded) ctx.nodes.set(id, toMap(rect(id, page2)));
    });
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN, { limits: { maxNodesPerPage: 1 } });
    expect(crowded.filter((id) => ctx.nodes.has(id))).toHaveLength(1);
  });

  it('páginas: repara nombre e índice, borra las que superan el límite y sus nodos', () => {
    const ctx = setup();
    const odd = newNodeId();
    ctx.client(() => ctx.pages.set(odd, toMap({ name: '   ', index: '¡mal!' })));
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    const page = ctx.pages.get(odd)!.toJSON();
    expect(page.name).toBe('Página');
    expect(page.index).toMatch(/^[0-9A-Za-z]+$/);

    const extra = newNodeId();
    const node = newNodeId();
    ctx.client(() => {
      ctx.pages.set(extra, toMap({ name: 'Extra', index: 'b0' }));
      ctx.nodes.set(node, toMap(rect(node, extra)));
    });
    const result = normalizeDocument(ctx.doc, ctx.take(), ORIGIN, { limits: { maxPages: 2 } });
    expect(ctx.pages.has(extra)).toBe(false);
    expect(ctx.nodes.has(node)).toBe(false);
    expect(result.limits).toContainEqual({ what: 'pages', actor: ACTOR });
  });

  it('es idempotente: una segunda pasada no corrige nada y dos réplicas convergen', () => {
    const ctx = setup();
    const id = newNodeId();
    ctx.client(() => ctx.nodes.set(id, toMap(rect(id, ctx.pageId, { x: 9e9, createdBy: 'x' }))));
    const touches = ctx.take();
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(ctx.doc));
    normalizeDocument(ctx.doc, touches, ORIGIN);
    expect(planNormalization(ctx.doc, touches).corrections).toEqual([]);
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(ctx.doc));
    expect(replica.getMap(ROOT_KEYS.nodes).toJSON()).toEqual(ctx.doc.getMap(ROOT_KEYS.nodes).toJSON());
  });

  it('la transacción de corrección lleva el origen indicado', () => {
    const ctx = setup();
    const id = newNodeId();
    ctx.client(() => ctx.nodes.set(id, toMap(rect(id, ctx.pageId, { opacity: 2 }))));
    const origins: unknown[] = [];
    ctx.doc.on('afterTransaction', (transaction) => origins.push(transaction.origin));
    normalizeDocument(ctx.doc, ctx.take(), ORIGIN);
    expect(origins).toEqual([ORIGIN]);
  });
});
