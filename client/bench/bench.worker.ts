import '../src/lib/zod-jitless.ts';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { DocHost } from '../src/engine/doc/host/DocHost.ts';
import type { MainMessage, WorkerMessage } from '../src/engine/doc/protocol.ts';
import type { PresenceState } from '../src/shared/document/keys.js';
import { mulberry32 } from './fixtures/random.ts';

// Worker del benchmark: el mismo DocHost que el editor, sin proveedor. Un par remoto en este mismo worker hace de
// servidor: sus updates se aplican al documento del host con origen remoto, como haría el proveedor.
export type BenchMessage =
  | WorkerMessage
  | { t: 'bench-load'; state: Uint8Array }
  | { t: 'start-burst'; ids: string[]; seed: number; view: { minX: number; minY: number; maxX: number; maxY: number }; local: PresenceState }
  | { t: 'burst-begin' }
  | { t: 'stop-burst' };

export type BenchReply = MainMessage | { t: 'bench-stats'; updates: number; applyP50: number; applyP95: number };

const scope = self as unknown as {
  postMessage(message: BenchReply, options?: { transfer?: Transferable[] }): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<BenchMessage>) => void): void;
};
const post = (message: BenchReply, transfer: Transferable[] = []) => scope.postMessage(message, { transfer });

const doc = new Y.Doc();
const awareness = new Awareness(doc);
const host = new DocHost(doc, awareness, { post: (batch, transfer) => post(batch, transfer), reply: (message) => post(message) });

type Burst = { stop(): void; updates: () => number; times: number[] };
let burst: Burst | null = null;

function startBurst(message: Extract<BenchMessage, { t: 'start-burst' }>): Burst {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const random = mulberry32(message.seed);
  const nodes = remote.getMap<Y.Map<unknown>>('nodes');
  const times: number[] = [];
  let updates = 0;
  remote.on('update', (update: Uint8Array) => {
    const started = performance.now();
    Y.applyUpdate(doc, update, 'remote');
    times.push(performance.now() - started);
  });
  // Un colaborador que mueve el cursor a la vez.
  const remoteAwareness = new Awareness(remote);
  const forward = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(remoteAwareness, [...added, ...updated, ...removed]), 'remote');
  };
  remoteAwareness.on('update', forward);
  const { view } = message;
  // 30 updates por segundo, cada uno mueve 100 nodos.
  const timer = setInterval(() => {
    remote.transact(() => {
      for (const id of message.ids) {
        const map = nodes.get(id);
        if (!map) continue;
        map.set('x', (map.get('x') as number) + Math.round((random() - 0.5) * 20));
        map.set('y', (map.get('y') as number) + Math.round((random() - 0.5) * 20));
      }
    });
    remoteAwareness.setLocalState({
      ...message.local,
      user: { id: 'bench-remote', name: 'Remoto', color: '#5AA9FB', avatarAssetId: null },
      cursor: { x: view.minX + random() * (view.maxX - view.minX), y: view.minY + random() * (view.maxY - view.minY) },
    });
    updates++;
  }, 1000 / 30);
  return {
    times,
    updates: () => updates,
    stop: () => {
      clearInterval(timer);
      remoteAwareness.off('update', forward);
      removeAwarenessStates(awareness, [remoteAwareness.clientID], 'remote');
      remote.destroy();
    },
  };
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! * 100) / 100;
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.t) {
    case 'bench-load':
      Y.applyUpdate(doc, message.state, 'remote');
      return;
    case 'start-burst':
      burst?.stop();
      burst = startBurst(message);
      return;
    // Lo aplicado durante el calentamiento no cuenta.
    case 'burst-begin':
      if (burst) burst.times.length = 0;
      return;
    case 'stop-burst': {
      const current = burst;
      burst = null;
      current?.stop();
      post({ t: 'bench-stats', updates: current?.updates() ?? 0, applyP50: percentile(current?.times ?? [], 0.5), applyP95: percentile(current?.times ?? [], 0.95) });
      return;
    }
    default:
      host.handle(message as Parameters<DocHost['handle']>[0]);
  }
});
post({ t: 'booted' });
