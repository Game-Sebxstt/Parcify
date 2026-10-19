import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { makeCore, newDoc, nodeMap, putNode, rect } from '../test-utils.ts';
import { RemoteInbox } from './RemoteInbox.ts';

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    pending,
    timers: {
      now: () => 0,
      setTimeout: (fn: () => void) => {
        const handle = next++;
        pending.set(handle, fn);
        return handle;
      },
      clearTimeout: (handle: unknown) => void pending.delete(handle as number),
    },
    fire() {
      const all = [...pending.values()];
      pending.clear();
      for (const fn of all) fn();
    },
  };
}

describe('RemoteInbox', () => {
  it('sin consumidor aplica en el momento', () => {
    const inbox = new RemoteInbox();
    const seen: number[] = [];
    inbox.enqueue(() => seen.push(1));
    expect(seen).toEqual([1]);
    expect(inbox.pending).toBe(0);
  });

  it('con consumidor encola en orden, pide un frame y se vacía al pedirlo', () => {
    const clock = fakeTimers();
    const inbox = new RemoteInbox(clock.timers);
    let frames = 0;
    inbox.attach(() => frames++);
    const seen: number[] = [];
    inbox.enqueue(() => seen.push(1));
    inbox.enqueue(() => seen.push(2));
    expect(seen).toEqual([]);
    expect(frames).toBe(1);
    expect(inbox.drain()).toBe(2);
    expect(seen).toEqual([1, 2]);
    expect(clock.pending.size).toBe(0);
  });

  it('si el frame no llega, lo pendiente se aplica tras el tope', () => {
    const clock = fakeTimers();
    const inbox = new RemoteInbox(clock.timers);
    inbox.attach(() => {});
    const seen: number[] = [];
    inbox.enqueue(() => seen.push(1));
    clock.fire();
    expect(seen).toEqual([1]);
  });

  it('al soltar el consumidor aplica lo pendiente; clear lo descarta', () => {
    const inbox = new RemoteInbox(fakeTimers().timers);
    const detach = inbox.attach(() => {});
    const seen: number[] = [];
    inbox.enqueue(() => seen.push(1));
    detach();
    expect(seen).toEqual([1]);
    inbox.attach(() => {});
    inbox.enqueue(() => seen.push(2));
    inbox.clear();
    expect(inbox.drain()).toBe(0);
    expect(seen).toEqual([1]);
  });
});

describe('updates remotos dentro del frame', () => {
  it('el motor aplica el update al principio del frame y lo pinta en ese mismo frame', () => {
    const remote = newDoc();
    const id = putNode(remote, rect());
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    const { core, sink, tick, backend } = makeCore(doc);
    const inbox = backend.inbox;
    const before = sink.records.get(id)!;
    const update = (() => {
      let captured: Uint8Array | null = null;
      remote.once('update', (u: Uint8Array) => (captured = u));
      nodeMap(remote, id).set('x', 55);
      return captured!;
    })();
    inbox.enqueue(() => Y.applyUpdate(doc, update, 'remote'));
    expect(core.store.get(id)?.x).toBe(0);
    const stats: number[] = [];
    core.onFrame((frame) => stats.push(frame.changed));
    tick();
    expect(core.store.get(id)?.x).toBe(55);
    expect(sink.records.get(id)).toBe(before);
    expect(stats).toEqual([1]);
    expect(inbox.pending).toBe(0);
    core.destroy();
  });
});
