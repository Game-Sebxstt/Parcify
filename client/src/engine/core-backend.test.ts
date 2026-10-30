import { describe, expect, it } from 'vitest';
import { LinkBackend } from './doc/backend.ts';
import type { DocBatch, MainToHost } from './doc/protocol.ts';
import { ACK_TIMEOUT_MS, EditorCore, PONG_TIMEOUT_MS } from './EditorCore.ts';
import { routeStart } from './geometry/connectors.ts';
import type { Timers } from './presence/throttle.ts';
import { DEFAULT_DOCUMENT_BACKGROUND } from './render/color.ts';
import { NullSink } from './render/sink.ts';
import { DEFAULT_BACKGROUND } from '../shared/document/init.js';
import { connectorNode, makeCore, newDoc, PAGE_ID, putNode, rect, TEST_USER } from './test-utils.ts';
import type { ConnectorRecord, NodeRecord } from './types.ts';

function manualTimers() {
  let now = 1_000;
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
    const end = now + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const due = queue[0];
      if (!due || due.at > end) break;
      queue.shift();
      now = due.at;
      due.fn();
    }
    now = end;
  };
  return { timers, advance };
}

const PAGE = { id: PAGE_ID, name: 'Página 1', index: 'a0' };
const full = (records: NodeRecord[] = []): DocBatch => ({ t: 'batch', gen: 1, applied: 0, invalid: 0, full: true, set: records, texts: [], pages: [PAGE], meta: null });

// Motor sobre un LinkBackend alimentado a mano: así se ve lo que pasa cuando el host tarda o no contesta.
function linked(options: { onSynced?: (synced: boolean) => void; onCrash?: (message: string) => void; timers?: Timers } = {}) {
  const sent: MainToHost[] = [];
  const backend = new LinkBackend(1, (message) => sent.push(message), { ...(options.onSynced ? { onSynced: options.onSynced } : {}), ...(options.onCrash ? { onCrash: options.onCrash } : {}) }, options.timers);
  backend.receive(full());
  let pending: ((time: number) => void) | null = null;
  const core = new EditorCore({
    backend,
    sink: new NullSink(),
    user: TEST_USER,
    screen: { width: 1000, height: 800 },
    raf: (callback) => {
      pending = callback;
      return 1;
    },
    caf: () => {
      pending = null;
    },
    ...(options.timers ? { timers: options.timers } : {}),
  });
  const tick = () => {
    const run = pending;
    pending = null;
    run?.(0);
  };
  return { core, backend, sent, tick };
}

describe('motor sobre el backend del documento', () => {
  it('el constructor aplica el lote full antes de leer las páginas', () => {
    const { core } = linked();
    expect(core.pages.get().map((page) => page.id)).toEqual([PAGE_ID]);
    expect(core.pageId.get()).toBe(PAGE_ID);
  });

  it('el constructor pinta el fondo que trae el primer lote (caché o vista previa)', () => {
    const backend = new LinkBackend(1, () => {}, {});
    backend.receive({ ...full(), meta: { schemaVersion: 2, createdAt: 0, background: '#224466FF' } });
    const sink = new NullSink();
    const core = new EditorCore({ backend, sink, user: TEST_USER, screen: { width: 1000, height: 800 }, raf: () => 1, caf: () => {} });
    expect(sink.backgrounds).toEqual(['#224466FF']);
    core.destroy();
  });

  it('el color inicial del renderer es el fondo por defecto del documento', () => {
    expect(DEFAULT_DOCUMENT_BACKGROUND).toBe(DEFAULT_BACKGROUND);
  });

  it('synced llega después de llevar al árbol los registros del mismo lote', () => {
    const geometry: unknown[] = [];
    const node = rect({ x: 40, y: 40 }) as unknown as NodeRecord;
    const ctx = linked({ onSynced: () => geometry.push(ctx.core.geometryOf(node.id)) });
    ctx.tick();
    ctx.backend.receive({ t: 'batch', gen: 1, applied: 0, invalid: 0, set: [node], synced: true });
    ctx.tick();
    expect(geometry).toEqual([{ minX: 40, minY: 40, maxX: 140, maxY: 90 }]);
  });

  it('tras deshacer un movimiento, el conector se recalcula en el mismo frame que el nodo', () => {
    const doc = newDoc();
    const a = putNode(doc, rect({ x: 0, y: 0, w: 100, h: 50 }));
    const b = putNode(doc, rect({ x: 300, y: 200, w: 100, h: 50, index: 'a1' }));
    const c = putNode(doc, connectorNode({ nodeId: a, anchor: 'right' }, { nodeId: b, anchor: 'left' }));
    const { core, sink, tick } = makeCore(doc);
    const path = () => (sink.records.get(c) as ConnectorRecord).path!;
    core.commands.commitTransform([a], [1, 0, 0, 1, 0, 100]);
    tick();
    expect(routeStart(path())).toEqual({ x: 100, y: 125 });
    core.commands.undo();
    tick();
    expect(routeStart(path())).toEqual({ x: 100, y: 25 });
    expect(core.scheduler.pending).toBe(false);
  });

  it('el vigilante no salta en una sesión sin actividad remota tras una op sin efecto', () => {
    const { timers, advance } = manualTimers();
    const doc = newDoc();
    const id = putNode(doc, rect({ fill: '#FF0000FF' }));
    const { core, tick } = makeCore(doc, { timers });
    let crashed = false;
    core.backend.crash = () => {
      crashed = true;
    };
    core.commands.setStyle({ fill: '#FF0000FF' }, [id]);
    tick();
    advance(20_000);
    expect(crashed).toBe(false);
    expect(core.store.pendingSince()).toBeNull();
  });

  it('sin acuse pregunta al host; si contesta sigue, y si no, se da por caído', () => {
    const { timers, advance } = manualTimers();
    const crashes: string[] = [];
    const ctx = linked({ timers, onCrash: (message) => crashes.push(message) });
    const id = ctx.core.commands.createShape('rect', { x: 0, y: 0, w: 10, h: 10 });
    expect(id).not.toBeNull();
    advance(ACK_TIMEOUT_MS + 5_000);
    const ping = ctx.sent.find((message) => message.t === 'ping');
    expect(ping).toBeDefined();
    ctx.backend.receivePong();
    advance(PONG_TIMEOUT_MS + 1_000);
    expect(crashes).toEqual([]);
    advance(ACK_TIMEOUT_MS + PONG_TIMEOUT_MS + 10_000);
    expect(crashes).toHaveLength(1);
  });
});
