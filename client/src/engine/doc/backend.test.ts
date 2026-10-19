import { describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Timers } from '../presence/throttle.ts';
import { makeCore, newDoc, nodeMap, putNode, rect } from '../test-utils.ts';
import { DirectBackend, LinkBackend } from './backend.ts';
import { DocHost } from './host/DocHost.ts';
import type { DocBatch, MainToHost } from './protocol.ts';

const QUIET = { warn: () => {}, error: () => {}, debug: () => {} };
const batch = (gen: number, applied: number, extra: Partial<DocBatch> = {}): DocBatch => ({ t: 'batch', gen, applied, invalid: 0, ...extra });

function manualTimers() {
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

describe('LinkBackend', () => {
  it('sin consumidor encola y no devuelve el crédito; ready se resuelve con el lote full', async () => {
    const sent: MainToHost[] = [];
    const backend = new LinkBackend(1, (message) => sent.push(message));
    let ready = false;
    void backend.ready.then(() => (ready = true));
    backend.receive(batch(1, 0));
    await Promise.resolve();
    expect(ready).toBe(false);
    backend.receive(batch(1, 0, { full: true, set: [] }));
    await Promise.resolve();
    expect(ready).toBe(true);
    expect(backend.drain()).toBe(0);
    expect(sent).toEqual([]);
    const applied: DocBatch[] = [];
    backend.attach({ apply: (b) => applied.push(b), wake: () => {} });
    expect(backend.drain()).toBe(1);
    expect(applied[0]!.full).toBe(true);
    expect(sent).toEqual([{ t: 'consumed' }]);
  });

  it('un segundo motor lanza y los lotes de otra generación se descartan', () => {
    const backend = new LinkBackend(2, () => {});
    backend.attach({ apply: () => {}, wake: () => {} });
    expect(() => backend.attach({ apply: () => {}, wake: () => {} })).toThrow();
    backend.receive(batch(1, 0, { full: true }));
    expect(backend.drain()).toBe(0);
  });

  it('con consumidor despierta al motor y aplica solo si el frame no llega a tiempo', () => {
    const { timers, advance } = manualTimers();
    const backend = new LinkBackend(1, () => {}, {}, timers);
    let wakes = 0;
    let applied = 0;
    backend.attach({ apply: () => applied++, wake: () => wakes++ });
    backend.receive(batch(1, 0, { full: true }));
    expect(wakes).toBe(1);
    advance(100);
    expect(applied).toBe(1);
  });

  it('destroy rechaza un ready pendiente', async () => {
    const backend = new LinkBackend(1, () => {});
    backend.destroy();
    await expect(backend.ready).rejects.toThrow();
  });
});

describe('DirectBackend', () => {
  it('despierta al motor con un update aplicado fuera de la cola y con la Awareness remota', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const awareness = new Awareness(doc);
    const backend = new DirectBackend(new DocHost(doc, awareness, { logger: QUIET }));
    let wakes = 0;
    backend.attach({ apply: () => {}, wake: () => wakes++ });
    backend.drain();
    wakes = 0;
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(peer);
    nodeMap(peer, id).set('x', 3);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, before), 'remote');
    expect(wakes).toBeGreaterThan(0);
    backend.drain();
    wakes = 0;
    awareness.states.set(5, {
      user: { id: 'bea', name: 'Bea', color: '#5AA9FB', avatarAssetId: null },
      pageId: 'PAGE_0000000000000001',
      cursor: { x: 1, y: 1 },
      viewport: { x: 0, y: 0, zoom: 1 },
      selection: [],
      selectionBox: null,
      marquee: null,
      gesture: null,
      editingText: null,
      chatTyping: false,
      aiBusy: false,
    });
    awareness.emit('change', [{ added: [5], updated: [], removed: [] }, 'remote']);
    expect(wakes).toBe(1);
  });

  it('el motor pinta un update de otro cliente sin que nadie pida el frame a mano', () => {
    const { doc, core, hasFrame, tick } = (() => {
      const harness = makeCore();
      return { ...harness, hasFrame: () => harness.hasFrame };
    })();
    tick();
    const id = putNode(doc, rect({ x: 7 }));
    expect(hasFrame()).toBe(true);
    tick();
    expect(core.store.get(id)?.x).toBe(7);
  });
});
