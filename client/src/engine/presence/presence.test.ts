import { describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { ROOT_KEYS, type PresenceState } from '../../shared/document/keys.js';
import { DocHost } from '../doc/host/DocHost.ts';
import { makeCore, newDoc, PAGE_ID, putNode, rect } from '../test-utils.ts';
import { CursorInterpolator, CURSOR_SMOOTHING_MS } from './cursors.ts';
import { gestureIds, Presence, PRESENCE_INTERVAL_MS, selectionFields } from './Presence.ts';
import { createThrottle, type Timers } from './throttle.ts';

function fakeTimers() {
  let now = 0;
  const queue: Array<{ at: number; fn: () => void; id: number }> = [];
  let next = 1;
  const timers: Timers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = next++;
      queue.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = queue.findIndex((t) => t.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const due = queue[0];
      if (!due || due.at > now) break;
      queue.shift();
      due.fn();
    }
  };
  return { timers, advance };
}

const USER = { id: 'u1', name: 'Ana', color: '#FB8F5A', avatarAssetId: null };
const QUIET = { warn: () => {}, error: () => {}, debug: () => {} };

describe('throttle', () => {
  it('fusiona las peticiones de un intervalo en una sola llamada final', () => {
    const { timers, advance } = fakeTimers();
    let calls = 0;
    const throttle = createThrottle(() => calls++, 33, timers);
    throttle.schedule();
    expect(calls).toBe(1);
    for (let i = 0; i < 10; i++) throttle.schedule();
    expect(calls).toBe(1);
    advance(33);
    expect(calls).toBe(2);
    advance(100);
    expect(calls).toBe(2);
  });

  it('Presence envía como mucho 30 estados por segundo con el último valor', () => {
    const { timers, advance } = fakeTimers();
    let last: PresenceState | null = null;
    const presence = new Presence((state) => (last = state), USER, 'page', timers);
    const before = presence.sent;
    for (let i = 0; i < 120; i++) {
      presence.update({ cursor: { x: i, y: i } });
      advance(1000 / 120);
    }
    advance(PRESENCE_INTERVAL_MS);
    const sent = presence.sent - before;
    expect(sent).toBeLessThanOrEqual(31);
    expect(sent).toBeGreaterThanOrEqual(25);
    expect((last as PresenceState | null)?.cursor).toEqual({ x: 119, y: 119 });
    presence.destroy();
  });
});

describe('selección en Awareness', () => {
  it('por encima de 500 ids envía [] y selectionBox', () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    const few = Array.from({ length: 500 }, (_, i) => `n${i}`);
    expect(selectionFields(few, box)).toEqual({ selection: few, selectionBox: null });
    const many = Array.from({ length: 501 }, (_, i) => `n${i}`);
    expect(selectionFields(many, box)).toEqual({ selection: [], selectionBox: box });
  });

  it('el gesto usa «selection» cuando coincide con la selección', () => {
    expect(gestureIds(['a', 'b'], ['a', 'b'])).toBe('selection');
    expect(gestureIds(['a'], ['a', 'b'])).toEqual(['a']);
    expect(gestureIds(Array.from({ length: 600 }, (_, i) => `n${i}`), [])).toBe('selection');
  });

  it('el host descarta estados remotos con forma inválida', () => {
    const { timers } = fakeTimers();
    const docA = new Y.Doc();
    const a = new Awareness(docA);
    const host = new DocHost(docA, a, { timers, logger: QUIET });
    const presence = new Presence(null, USER, 'page', timers);
    const take = () => {
      const delta = host.take()?.presence;
      if (delta) presence.receive(delta);
    };
    take();
    a.states.set(999, { user: { id: 'x' } });
    a.emit('change', [{ added: [999], updated: [], removed: [] }, 'remote']);
    take();
    expect(presence.remote().size).toBe(0);
    a.states.set(1000, { ...presence.state, user: { ...USER, id: 'u2' } });
    a.emit('change', [{ added: [1000], updated: [], removed: [] }, 'remote']);
    take();
    expect(presence.remote().get(1000)?.user.id).toBe('u2');
    a.states.set(1000, { user: { id: 'roto' } });
    a.emit('change', [{ added: [], updated: [1000], removed: [] }, 'remote']);
    take();
    expect(presence.remote().has(1000)).toBe(false);
    host.destroy();
  });

  it('el host escribe la presencia del principal en cuanto llega y le pone su editingText', () => {
    const { timers } = fakeTimers();
    const doc = newDoc();
    const id = putNode(doc, rect());
    const awareness = new Awareness(doc);
    const host = new DocHost(doc, awareness, { timers, logger: QUIET });
    const presence = new Presence((state) => host.handle({ t: 'presence', state }), USER, PAGE_ID, timers);
    presence.update({ cursor: { x: 1, y: 2 }, editingText: { nodeId: 'otro', anchor: 'x', head: 'x' } });
    presence.flush();
    expect(awareness.getLocalState()?.cursor).toEqual({ x: 1, y: 2 });
    expect(awareness.getLocalState()?.editingText).toBeNull();
    doc.transact(() => doc.getMap(ROOT_KEYS.texts).set(id, new Y.Text('Hola')));
    host.handle({ t: 'text-open', session: 1, id, value: 'Hola', selection: [id] });
    const editing = awareness.getLocalState()?.editingText as { nodeId: string; anchor: string } | null;
    expect(editing?.nodeId).toBe(id);
    expect(() => JSON.parse(editing!.anchor)).not.toThrow();
    host.handle({ t: 'text-close', session: 1 });
    expect(awareness.getLocalState()?.editingText).toBeNull();
    host.destroy();
  });
});

describe('seguir a un colaborador', () => {
  it('la cámara se acerca a su vista interpolando, se para al llegar y deja de seguir al mover la cámara a mano', () => {
    const { timers } = fakeTimers();
    const doc = newDoc();
    const awareness = new Awareness(doc);
    const frame = makeCore(doc, { awareness, timers });
    const { core, tick } = frame;
    awareness.states.set(3000, { ...core.presence.state, user: { ...USER, id: 'u3' }, viewport: { x: 500, y: 300, zoom: 2 } });
    awareness.emit('change', [{ added: [3000], updated: [], removed: [] }, 'remote']);
    core.follow(3000);
    expect(core.following.get()).toBe(3000);
    let time = 1000;
    tick(time);
    const first = core.camera.state();
    expect(first.x).toBeGreaterThan(0);
    expect(first.x).toBeLessThan(500);
    for (let i = 0; i < 200 && frame.hasFrame; i++) {
      time += 16;
      tick(time);
    }
    expect(core.camera.state()).toEqual({ x: 500, y: 300, zoom: 2 });
    expect(frame.hasFrame).toBe(false);
    core.controller.wheel({ x: 10, y: 10, deltaX: 0, deltaY: 100, ctrl: false });
    expect(core.following.get()).toBeNull();
    core.follow(3000);
    awareness.states.delete(3000);
    awareness.emit('change', [{ added: [], updated: [], removed: [3000] }, 'remote']);
    tick(time + 16);
    expect(core.following.get()).toBeNull();
    core.destroy();
  });
});

describe('cursores remotos', () => {
  it('interpolan en 120 ms desde la posición actual', () => {
    const cursors = new CursorInterpolator();
    cursors.set('a', 0, 0, 0);
    expect(cursors.sample('a', 0)).toEqual({ x: 0, y: 0 });
    cursors.set('a', 100, 0, 1000);
    expect(cursors.animating(1000)).toBe(true);
    const mid = cursors.sample('a', 1000 + CURSOR_SMOOTHING_MS / 2)!;
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(100);
    expect(cursors.sample('a', 1000 + CURSOR_SMOOTHING_MS)).toEqual({ x: 100, y: 0 });
    expect(cursors.animating(1000 + CURSOR_SMOOTHING_MS)).toBe(false);
  });

  it('el planificador deja de pedir frames cuando termina la interpolación', () => {
    const { timers } = fakeTimers();
    const doc = newDoc();
    const awareness = new Awareness(doc);
    const frame = makeCore(doc, { awareness, timers });
    const { core, tick } = frame;
    const moveCursor = (x: number) => {
      awareness.states.set(2000, { ...core.presence.state, user: { ...USER, id: 'u2' }, cursor: { x, y: 0 } });
      awareness.emit('change', [{ added: [], updated: [2000], removed: [] }, 'remote']);
    };
    awareness.states.set(2000, { ...core.presence.state, user: { ...USER, id: 'u2' }, cursor: { x: 0, y: 0 } });
    awareness.emit('change', [{ added: [2000], updated: [], removed: [] }, 'remote']);
    tick(0);
    moveCursor(100);
    let time = 1000;
    tick(time);
    expect(frame.hasFrame).toBe(true);
    for (let i = 0; i < 20 && frame.hasFrame; i++) {
      time += 16;
      tick(time);
    }
    expect(frame.hasFrame).toBe(false);
    expect(time - 1000).toBeGreaterThanOrEqual(CURSOR_SMOOTHING_MS);
    const frames = core.scheduler.frames;
    tick(time + 1000);
    expect(core.scheduler.frames).toBe(frames);
    core.destroy();
  });
});
