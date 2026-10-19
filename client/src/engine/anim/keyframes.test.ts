import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { ANIMATION_LIMITS } from '../../shared/document/limits.js';
import { AnimationSchema } from '../../shared/document/schema.js';
import { AnimationCommands } from '../commands/animation.ts';
import { makeCore, newDoc, putNode, rect } from '../test-utils.ts';

type Harness = ReturnType<typeof makeCore> & { keyframes: AnimationCommands };

function replicas(count: number, seed: (doc: Y.Doc) => void): Harness[] {
  const base = newDoc();
  seed(base);
  const state = Y.encodeStateAsUpdate(base);
  return Array.from({ length: count }, (_, i) => {
    const doc = new Y.Doc();
    doc.clientID = 200 + i;
    Y.applyUpdate(doc, state, 'remote');
    const harness = makeCore(doc, { user: { id: `user-${i}`, name: `U${i}`, color: '#FB8F5A', avatarAssetId: null } });
    return { ...harness, keyframes: new AnimationCommands(harness.core) };
  });
}

function syncAll(harnesses: Harness[]) {
  const updates = harnesses.map(({ doc }) => Y.encodeStateAsUpdate(doc));
  for (const { doc } of harnesses) for (const update of updates) Y.applyUpdate(doc, update, 'remote');
  for (const harness of harnesses) harness.tick();
}

const animations = (doc: Y.Doc) => doc.getMap(ROOT_KEYS.animations).toJSON() as Record<string, unknown>;

// Los documentos coinciden, son válidos y el espejo de cada cliente es lo que dice su documento.
function expectConverged(harnesses: Harness[], id: string) {
  const [first, ...rest] = harnesses;
  const expected = animations(first!.doc);
  for (const other of rest) expect(animations(other.doc)).toEqual(expected);
  for (const { doc, core } of harnesses) {
    const json = animations(doc)[id];
    if (json === undefined) {
      expect(core.store.animation(id)).toBeUndefined();
      continue;
    }
    expect(AnimationSchema.safeParse(json).success).toBe(true);
    expect(core.store.animation(id)).toEqual(AnimationSchema.parse(json));
  }
}

function seedAnimation(doc: Y.Doc, id: string) {
  doc.transact(() => {
    const animation = new Y.Map<unknown>();
    for (const [key, value] of Object.entries({ duration: 1000, delay: 0, loop: 1, direction: 'normal', autoplay: 'none' })) animation.set(key, value);
    const tracks = new Y.Map<unknown>();
    const track = new Y.Map<unknown>();
    track.set('seed', { t: 0, v: 0, e: 'linear' });
    tracks.set('offsetX', track);
    animation.set('tracks', tracks);
    doc.getMap(ROOT_KEYS.animations).set(id, animation);
  }, 'remote');
}

describe('keyframes en colaboración', () => {
  it('dos usuarios añaden keyframes a la misma pista a la vez: se conservan los dos y convergen', () => {
    let id = '';
    const [a, b] = replicas(2, (doc) => {
      id = putNode(doc, rect());
      seedAnimation(doc, id);
    }) as [Harness, Harness];
    const ka = a.keyframes.addKeyframe(id, 'offsetX', { t: 0.25, v: 10 });
    const kb = b.keyframes.addKeyframe(id, 'offsetX', { t: 0.75, v: 30, e: 'easeOut' });
    expect(ka).not.toBeNull();
    expect(kb).not.toBeNull();
    a.tick();
    b.tick();
    syncAll([a, b]);
    expectConverged([a, b], id);
    const track = a.core.store.animation(id)!.tracks.offsetX!;
    expect(Object.keys(track).sort()).toEqual(['seed', ka!, kb!].sort());
    expect(track[kb!]).toEqual({ t: 0.75, v: 30, e: 'easeOut' });
  });

  it('crear la animación a la vez desde cero converge en una sola animación válida', () => {
    let id = '';
    const [a, b] = replicas(2, (doc) => {
      id = putNode(doc, rect());
    }) as [Harness, Harness];
    a.keyframes.addKeyframe(id, 'opacity', { t: 0, v: 1 });
    b.keyframes.addKeyframe(id, 'opacity', { t: 1, v: 0 });
    a.tick();
    b.tick();
    syncAll([a, b]);
    expectConverged([a, b], id);
    expect(Object.keys(a.core.store.animation(id)!.tracks.opacity!).length).toBeGreaterThanOrEqual(1);
  });

  it('mover y borrar el mismo keyframe a la vez converge', () => {
    let id = '';
    const [a, b] = replicas(2, (doc) => {
      id = putNode(doc, rect());
      seedAnimation(doc, id);
    }) as [Harness, Harness];
    expect(a.keyframes.moveKeyframe(id, 'offsetX', 'seed', 0.9)).toBe(true);
    expect(b.keyframes.deleteKeyframe(id, 'offsetX', 'seed')).toBe(true);
    a.tick();
    b.tick();
    syncAll([a, b]);
    expectConverged([a, b], id);
  });

  it('un keyframe remoto llega al espejo mientras hay una edición propia sin acusar', () => {
    let id = '';
    const [a, b] = replicas(2, (doc) => {
      id = putNode(doc, rect());
      seedAnimation(doc, id);
    }) as [Harness, Harness];
    const kb = b.keyframes.addKeyframe(id, 'offsetX', { t: 0.5, v: 5 })!;
    b.tick();
    const ka = a.keyframes.addKeyframe(id, 'offsetX', { t: 0.1, v: 1 })!;
    // El update de B se aplica en A antes de que A procese su propio lote.
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc), 'remote');
    a.tick();
    expect(Object.keys(a.core.store.animation(id)!.tracks.offsetX!).sort()).toEqual(['seed', ka, kb].sort());
    syncAll([a, b]);
    expectConverged([a, b], id);
  });
});

describe('modelo de keyframes', () => {
  it('borrar el nodo borra su animación en la misma transacción y deshacer devuelve los dos', () => {
    const harness = makeCore();
    const { core, doc, tick } = harness;
    const id = putNode(doc, rect());
    tick();
    const keyframes = new AnimationCommands(core);
    keyframes.addKeyframe(id, 'offsetX', { t: 0, v: 0 });
    tick();
    expect(doc.getMap(ROOT_KEYS.animations).has(id)).toBe(true);
    const transactions: Array<Set<unknown>> = [];
    const listener = (transaction: Y.Transaction) => {
      if (transaction.local) transactions.push(new Set([...transaction.changed.keys()]));
    };
    doc.on('afterTransaction', listener);
    core.setSelection([id]);
    core.commands.deleteSelection();
    tick();
    doc.off('afterTransaction', listener);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.has(doc.getMap(ROOT_KEYS.nodes))).toBe(true);
    expect(transactions[0]!.has(doc.getMap(ROOT_KEYS.animations))).toBe(true);
    expect(doc.getMap(ROOT_KEYS.animations).has(id)).toBe(false);
    expect(core.store.animation(id)).toBeUndefined();
    core.commands.undo();
    tick();
    expect(core.record(id)).toBeDefined();
    expect(core.store.animation(id)?.tracks.offsetX).toBeDefined();
  });

  it('una pista admite como mucho 64 keyframes, también en el host', () => {
    const { core, doc, tick } = makeCore();
    const id = putNode(doc, rect());
    tick();
    const keyframes = new AnimationCommands(core);
    for (let i = 0; i < ANIMATION_LIMITS.maxKeyframesPerTrack; i++) expect(keyframes.addKeyframe(id, 'scale', { t: i / 64, v: 1 })).not.toBeNull();
    expect(keyframes.addKeyframe(id, 'scale', { t: 1, v: 2 })).toBeNull();
    core.writer.transact({}, (w) => w.setKeyframe(id, 'scale', 'extra', { t: 1, v: 2, e: 'linear' }));
    tick();
    const track = (doc.getMap(ROOT_KEYS.animations).get(id) as Y.Map<Y.Map<Y.Map<unknown>>>).get('tracks')!.get('scale')!;
    expect(track.size).toBe(ANIMATION_LIMITS.maxKeyframesPerTrack);
    expect(Object.keys(core.store.animation(id)!.tracks.scale!)).toHaveLength(ANIMATION_LIMITS.maxKeyframesPerTrack);
  });

  it('rechaza valores del tipo equivocado y deshacer quita el keyframe', () => {
    const { core, doc, tick } = makeCore();
    const id = putNode(doc, rect());
    tick();
    const keyframes = new AnimationCommands(core);
    expect(keyframes.addKeyframe(id, 'fill', { t: 0, v: 3 })).toBeNull();
    expect(keyframes.addKeyframe(id, 'offsetX', { t: 0, v: '#FFFFFFFF' })).toBeNull();
    expect(keyframes.addKeyframe(id, 'offsetX', { t: 2, v: 0 })).toBeNull();
    const key = keyframes.addKeyframe(id, 'fill', { t: 0.5, v: '#FFFFFFFF' })!;
    keyframes.addKeyframe(id, 'fill', { t: 1, v: '#000000FF' });
    tick();
    core.commands.undo();
    tick();
    expect(Object.keys(core.store.animation(id)!.tracks.fill!)).toEqual([key]);
  });

  it('en modo «Grabar» mover y cambiar la opacidad escriben keyframes y no tocan el nodo', () => {
    const { core, doc, tick } = makeCore();
    const id = putNode(doc, rect({ x: 10, y: 20 }));
    tick();
    const keyframes = new AnimationCommands(core);
    core.commands.recorder = (changes) => void keyframes.recordAt(500, changes);
    core.commands.select([id]);
    core.commands.nudge(30, 0);
    tick();
    const values = (prop: 'offsetX' | 'opacity') =>
      Object.values(core.store.animation(id)!.tracks[prop]!)
        .map((kf) => [kf.t, kf.v])
        .sort((a, b) => Number(a[0]) - Number(b[0]));
    expect(values('offsetX')).toEqual([
      [0, 0],
      [0.5, 30],
    ]);
    // Otra vez en el mismo instante: se suma al valor que ya tiene la pista y se actualiza el mismo keyframe.
    core.commands.nudge(5, 0);
    core.commands.setStyle({ opacity: 0.25 });
    tick();
    expect(values('offsetX')).toEqual([
      [0, 0],
      [0.5, 35],
    ]);
    expect(values('opacity')).toEqual([
      [0, 1],
      [0.5, 0.25],
    ]);
    expect(core.record(id)).toMatchObject({ x: 10, y: 20, opacity: 1 });
    core.commands.undo();
    tick();
    expect(Object.keys(core.store.animation(id)!.tracks.opacity ?? {})).toHaveLength(0);
    expect(values('offsetX')).toHaveLength(2);
  });

  it('un keyframe después del final amplía la duración sin mover los que ya hay, en un paso de deshacer', () => {
    const { core, doc, tick } = makeCore();
    const id = putNode(doc, rect());
    tick();
    const keyframes = new AnimationCommands(core);
    keyframes.addKeyframe(id, 'offsetX', { t: 0, v: 0 });
    keyframes.addKeyframe(id, 'offsetX', { t: 1, v: 40 });
    tick();
    const key = keyframes.keyframeAtTime(id, 'offsetX', 2500)!;
    tick();
    const animation = core.store.animation(id)!;
    expect(animation.duration).toBe(2500);
    const times = Object.values(animation.tracks.offsetX!).map((kf) => [animation.delay + kf.t * animation.duration, kf.v]);
    expect(times.sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [0, 0],
      [1000, 40],
      [2500, 40],
    ]);
    expect(keyframes.keyframeAtTime(id, 'offsetX', 2500)).toBe(key);
    core.commands.recorder = (changes) => void keyframes.recordAt(4000, changes);
    core.commands.select([id]);
    core.commands.nudge(10, 0);
    tick();
    expect(core.store.animation(id)!.duration).toBe(4000);
    expect(Object.values(core.store.animation(id)!.tracks.offsetX!).find((kf) => kf.t === 1)?.v).toBe(50);
    core.commands.undo();
    tick();
    expect(core.store.animation(id)!.duration).toBe(2500);
    expect(Object.keys(core.store.animation(id)!.tracks.offsetX!)).toHaveLength(3);
  });
});
