import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { ANIMATION_LIMITS } from '../../shared/document/limits.js';
import { AnimationSchema } from '../../shared/document/schema.js';
import { AnimationCommands, clampAnimValue, restValue, type KeyRef } from '../commands/animation.ts';
import type { NodeRecord } from '../types.ts';
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

describe('edición de keyframes en lote', () => {
  type Prop = 'offsetX' | 'opacity' | 'scaleX';

  // Nodo con offsetX en 0, 500 y 1000 ms (a, b, c) y opacity en 0 y 1000 ms (o0, o1), en una animación de 1000 ms.
  function setup(seed: (keyframes: AnimationCommands, id: string) => void = () => {}) {
    const harness = makeCore();
    const id = putNode(harness.doc, rect({ opacity: 0.8 }));
    harness.tick();
    const keyframes = new AnimationCommands(harness.core);
    const a = keyframes.addKeyframe(id, 'offsetX', { t: 0, v: 0 })!;
    const b = keyframes.addKeyframe(id, 'offsetX', { t: 0.5, v: 50 })!;
    const c = keyframes.addKeyframe(id, 'offsetX', { t: 1, v: 100 })!;
    const o0 = keyframes.addKeyframe(id, 'opacity', { t: 0, v: 1 })!;
    const o1 = keyframes.addKeyframe(id, 'opacity', { t: 1, v: 0 })!;
    seed(keyframes, id);
    harness.tick();
    const ref = (prop: Prop, key: string): KeyRef => ({ nodeId: id, prop, key });
    // [ms, v] de la pista, de menor a mayor.
    const track = (prop: Prop, node = id) => {
      const animation = harness.core.store.animation(node)!;
      return Object.values(animation.tracks[prop] ?? {})
        .map((kf) => [Math.round(animation.delay + kf.t * animation.duration), kf.v] as const)
        .sort((x, y) => x[0] - y[0]);
    };
    return { ...harness, id, keyframes, a, b, c, o0, o1, ref, track };
  }

  // Transacciones locales mientras corre `run`.
  function countTransactions(doc: Y.Doc, run: () => void): number {
    let count = 0;
    const listener = (transaction: Y.Transaction) => {
      if (transaction.local) count++;
    };
    doc.on('afterTransaction', listener);
    run();
    doc.off('afterTransaction', listener);
    return count;
  }

  it('mover 3 keyframes de 2 pistas 200 ms es una transacción y un paso de deshacer (CA-5.5)', () => {
    const { core, doc, tick, keyframes, a, b, o0, ref, track } = setup();
    const refs = [ref('offsetX', a), ref('offsetX', b), ref('opacity', o0)];
    expect(countTransactions(doc, () => expect(keyframes.moveKeyframes(refs, 200)).toBe(true))).toBe(1);
    tick();
    expect(track('offsetX')).toEqual([
      [200, 0],
      [700, 50],
      [1000, 100],
    ]);
    expect(track('opacity')).toEqual([
      [200, 1],
      [1000, 0],
    ]);
    core.commands.undo();
    tick();
    expect(track('offsetX')).toEqual([
      [0, 0],
      [500, 50],
      [1000, 100],
    ]);
    expect(track('opacity')).toEqual([
      [0, 1],
      [1000, 0],
    ]);
  });

  it('un keyframe movido sobre otro no seleccionado de la misma pista lo sustituye', () => {
    const { tick, keyframes, b, c, ref, track, core, id } = setup();
    expect(keyframes.moveKeyframes([ref('offsetX', b)], 500)).toBe(true);
    tick();
    expect(track('offsetX')).toEqual([
      [0, 0],
      [1000, 50],
    ]);
    expect(core.store.animation(id)!.tracks.offsetX![c]).toBeUndefined();
    expect(core.store.animation(id)!.tracks.offsetX![b]).toBeDefined();
  });

  it('mover más allá del final amplía la iteración sin mover los demás; no se pasa de 0', () => {
    const { tick, keyframes, a, b, c, ref, track, core, id } = setup();
    expect(keyframes.moveKeyframes([ref('offsetX', c)], 500)).toBe(true);
    tick();
    expect(core.store.animation(id)!.duration).toBe(1500);
    expect(track('offsetX')).toEqual([
      [0, 0],
      [500, 50],
      [1500, 100],
    ]);
    expect(track('opacity')).toEqual([
      [0, 1],
      [1000, 0],
    ]);
    // El primero ya está en 0: no se mueve.
    expect(keyframes.moveKeyframes([ref('offsetX', a)], -300)).toBe(false);
    // El delta se recorta para que el primero de la selección quede en 0.
    expect(keyframes.moveKeyframes([ref('offsetX', b), ref('offsetX', c)], -800)).toBe(true);
    tick();
    expect(track('offsetX')).toEqual([
      [0, 50],
      [1000, 100],
    ]);
  });

  it('duplicar desplaza (max − min) + 100, o 100 con un solo instante, y la copia sustituye a lo que pisa', () => {
    const { tick, keyframes, a, b, ref, track, core, id } = setup();
    const result = keyframes.duplicateKeyframes([ref('offsetX', a), ref('offsetX', b)]);
    expect(result.ok).toBe(true);
    tick();
    // Copias en 600 y 1100: la iteración pasa a 1100 ms.
    expect(core.store.animation(id)!.duration).toBe(1100);
    expect(track('offsetX')).toEqual([
      [0, 0],
      [500, 50],
      [600, 0],
      [1000, 100],
      [1100, 50],
    ]);
    const copies = result.ok ? result.refs : [];
    expect(copies).toHaveLength(2);
    expect(copies.every((copy) => copy.key !== a && copy.key !== b)).toBe(true);
    const single = keyframes.duplicateKeyframes([ref('offsetX', b)]);
    tick();
    expect(single.ok && single.refs).toHaveLength(1);
    // La copia de 500 ms cae en 600 y sustituye a la copia anterior de 600.
    expect(track('offsetX')).toEqual([
      [0, 0],
      [500, 50],
      [600, 50],
      [1000, 100],
      [1100, 50],
    ]);
  });

  it('copiar y pegar en otro instante conserva la separación y se reasigna a un único destino (CA-5.6)', () => {
    const { doc, tick, keyframes, a, b, ref, track, id } = setup();
    const other = putNode(doc, rect({ x: 300 }));
    const third = putNode(doc, rect({ x: 600 }));
    tick();
    const clip = keyframes.copyKeyframes([ref('offsetX', a), ref('offsetX', b)])!;
    expect(clip).toMatchObject({ v: 1, baseMs: 0 });
    expect(clip.items.map((item) => item.offsetMs)).toEqual([0, 500]);
    const pasted = keyframes.pasteKeyframes(clip, 1000, [other]);
    expect(pasted.ok).toBe(true);
    tick();
    expect(track('offsetX', other)).toEqual([
      [1000, 0],
      [1500, 50],
    ]);
    expect(pasted.ok && pasted.refs.every((item) => item.nodeId === other)).toBe(true);
    // Con varios destinos se pega en el nodo de origen.
    expect(keyframes.pasteKeyframes(clip, 2000, [other, third]).ok).toBe(true);
    tick();
    expect(track('offsetX', id).map(([ms]) => ms)).toEqual([0, 500, 1000, 2000, 2500]);
    expect(track('offsetX', other)).toHaveLength(2);
  });

  it('pegar en una pista que pasaría de 64 keyframes no pega nada', () => {
    const { tick, keyframes, a, ref, track, id } = setup((commands, node) => {
      for (let i = 0; i < 62; i++) commands.addKeyframe(node, 'scaleX', { t: (i + 1) / 64, v: 1 });
    });
    const scale = Object.keys(keyframes.animation(id)!.tracks.scaleX!);
    expect(scale).toHaveLength(62);
    const clip = keyframes.copyKeyframes([ref('scaleX', scale[0]!), ref('scaleX', scale[1]!), ref('offsetX', a)])!;
    // 62 + 2 copias en otro instante = 64: cabe.
    expect(keyframes.pasteKeyframes(clip, 10, []).ok).toBe(true);
    tick();
    expect(track('scaleX')).toHaveLength(64);
    const before = track('offsetX');
    // Una más ya no cabe: tampoco se pega lo de las demás pistas.
    expect(keyframes.pasteKeyframes(clip, 20, [])).toEqual({ ok: false, reason: 'track_full' });
    tick();
    expect(track('scaleX')).toHaveLength(64);
    expect(track('offsetX')).toEqual(before);
  });

  it('estirar ×2 con el pivote en el primero deja 0, 1000 y 2000 en un paso de deshacer (CA-5.15)', () => {
    const { doc, core, tick, keyframes, a, b, c, ref, track } = setup();
    const refs = [ref('offsetX', a), ref('offsetX', b), ref('offsetX', c)];
    expect(countTransactions(doc, () => expect(keyframes.stretchKeyframes(refs, 0, 2)).toBe(true))).toBe(1);
    tick();
    expect(track('offsetX').map(([ms]) => ms)).toEqual([0, 1000, 2000]);
    core.commands.undo();
    tick();
    expect(track('offsetX').map(([ms]) => ms)).toEqual([0, 500, 1000]);
    // Con un solo instante no hay nada que estirar.
    expect(keyframes.stretchKeyframes([ref('offsetX', b)], 0, 2)).toBe(false);
  });

  it('el factor de estirado se limita a [0,05, 20] y a la duración máxima de la iteración', () => {
    const { tick, keyframes, a, b, c, ref, track, core, id } = setup();
    expect(keyframes.stretchKeyframes([ref('offsetX', a), ref('offsetX', c)], 0, 100)).toBe(true);
    tick();
    expect(track('offsetX').map(([ms]) => ms)).toEqual([0, 500, 20000]);
    // b (500) y c (20000) con el pivote en b: (60000 − (500 − 0)) / 19500.
    const refs = [ref('offsetX', b), ref('offsetX', c)];
    const limit = keyframes.stretchLimits(refs, 500);
    expect(limit.min).toBe(0.05);
    expect(limit.max).toBeCloseTo((60_000 - 500) / 19_500, 9);
    expect(keyframes.stretchKeyframes(refs, 500, 20)).toBe(true);
    tick();
    expect(core.store.animation(id)!.duration).toBe(60_000);
    // t tiene 4 decimales: en una iteración de 60 s, un keyframe cae a menos de 6 ms de su instante.
    const near = (actual: readonly number[], expected: readonly number[]) => actual.forEach((ms, i) => expect(Math.abs(ms - expected[i]!)).toBeLessThanOrEqual(6));
    near(
      track('offsetX').map(([ms]) => ms),
      [0, 500, 60_000],
    );
    // Encoger por debajo de 0,05 se queda en 0,05.
    expect(keyframes.stretchKeyframes(refs, 500, 0.001)).toBe(true);
    tick();
    near(
      track('offsetX').map(([ms]) => ms),
      [0, 500, 500 + 59_500 * 0.05],
    );
  });

  it('easing y borrado en lote', () => {
    const { doc, tick, keyframes, a, b, o0, ref, track, core, id } = setup();
    expect(keyframes.setEasing([ref('offsetX', a), ref('opacity', o0)], 'easeOut')).toBe(true);
    tick();
    const animation = core.store.animation(id)!;
    expect(animation.tracks.offsetX![a]).toMatchObject({ t: 0, e: 'easeOut' });
    expect(animation.tracks.opacity![o0]).toMatchObject({ t: 0, e: 'easeOut' });
    expect(animation.tracks.offsetX![b]!.e).toBe('linear');
    expect(keyframes.setEasing([ref('offsetX', a)], 'rebote' as never)).toBe(false);
    expect(countTransactions(doc, () => expect(keyframes.deleteKeyframes([ref('offsetX', a), ref('opacity', o0)])).toBe(true))).toBe(1);
    tick();
    expect(track('offsetX')).toHaveLength(2);
    expect(track('opacity')).toEqual([[1000, 0]]);
  });

  it('clampAnimValue recorta opacidad y escalas antes de validar', () => {
    expect(clampAnimValue('opacity', 1.5)).toBe(1);
    expect(clampAnimValue('opacity', -0.2)).toBe(0);
    expect(clampAnimValue('scale', -1)).toBe(0);
    expect(clampAnimValue('scaleY', 3)).toBe(3);
    expect(clampAnimValue('offsetX', -50)).toBe(-50);
    expect(clampAnimValue('fill', '#FFFFFFFF')).toBe('#FFFFFFFF');
    const { tick, keyframes, id, core } = setup();
    const key = keyframes.addKeyframe(id, 'scaleX', { t: 0.5, v: -2 })!;
    tick();
    expect(core.store.animation(id)!.tracks.scaleX![key]!.v).toBe(0);
  });

  it('un efecto sustituye solo sus pistas; sin otras pistas la iteración dura lo que el efecto', () => {
    const { doc, tick, keyframes, track, core, id } = setup();
    expect(keyframes.applyPreset([id], 'deslizar')).toBe(true);
    tick();
    expect(core.store.animation(id)!.duration).toBe(1000);
    expect(track('offsetX').map(([ms]) => ms)).toEqual([0, 500, 1000]);
    expect(track('opacity')).toEqual([
      [0, 0],
      [500, 0.8],
    ]);
    const alone = putNode(doc, rect({ opacity: 0.6 }));
    tick();
    expect(keyframes.applyPreset([alone], 'aparecer')).toBe(true);
    tick();
    expect(core.store.animation(alone)).toMatchObject({ duration: 400, delay: 0 });
    expect(track('opacity', alone)).toEqual([
      [0, 0],
      [400, 0.6],
    ]);
    expect(keyframes.applyPreset([alone], 'rebote')).toBe(true);
    tick();
    // Rebote usa offsetY: la opacidad de aparecer se queda y la iteración se amplía a los 600 ms del rebote.
    const animation = core.store.animation(alone)!;
    expect(animation.duration).toBe(600);
    expect(Object.values(animation.tracks.offsetY!).map((kf) => [kf.t, kf.v]).sort((x, y) => Number(x[0]) - Number(y[0]))).toEqual([
      [0, 0],
      [0.4, -16],
      [1, 0],
    ]);
    expect(Object.keys(animation.tracks.opacity!)).toHaveLength(2);
  });

  it('restValue del relleno de un texto es su color y el de las escalas por eje es 1', () => {
    const record = { type: 'text', color: '#112233FF', opacity: 1 } as unknown as NodeRecord;
    expect(restValue(record, 'fill')).toBe('#112233FF');
    expect(restValue(record, 'scaleX')).toBe(1);
    expect(restValue(record, 'scaleY')).toBe(1);
  });

  it('grabar una escala la multiplica por la que la pista tiene en ese instante', () => {
    const { tick, keyframes, id, core } = setup();
    expect(keyframes.recordAt(500, [{ id, prop: 'scaleX', value: 1.5, mode: 'multiply' }])).toBe(true);
    tick();
    expect(keyframes.recordAt(500, [{ id, prop: 'scaleX', value: 2, mode: 'multiply' }])).toBe(true);
    tick();
    const values = Object.values(core.store.animation(id)!.tracks.scaleX!)
      .map((kf) => [kf.t, kf.v])
      .sort((x, y) => Number(x[0]) - Number(y[0]));
    expect(values).toEqual([
      [0, 1],
      [0.5, 3],
    ]);
  });
});
