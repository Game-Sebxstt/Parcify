import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { DocHost } from '../engine/doc/host/DocHost.ts';
import { createEngine, DirectBackend, type Engine } from '../engine/index.ts';
import { COLLAB_COLORS } from '../shared/collab-colors.js';
import type { PresenceState } from '../shared/document/keys.js';
import { addMany, addNode, createDemoDoc, DEMO_PAGE, did, MANY_COUNT, nodeBox, removeNodes, setNode } from './demo.ts';

const RELAY = 'landing-relay';

type Point = { x: number; y: number };

export type LandingDemo = {
  toggleMany(): boolean;
  onFrameWork(listener: (ms: number) => void): () => void;
  setPlaying(playing: boolean): void;
  destroy(): void;
};

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const center = (box: { x: number; y: number; w: number; h: number }): Point => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

// Dos documentos y dos Awareness en la misma página: el visitante y «Ana» se sincronizan como dos clientes.
export async function mountLandingDemo(input: {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  reducedMotion: boolean;
  anaName: string;
  visitorName: string;
}): Promise<LandingDemo> {
  const doc = createDemoDoc();
  const ana = new Y.Doc();
  Y.applyUpdate(ana, Y.encodeStateAsUpdate(doc), RELAY);
  const relayToAna = (update: Uint8Array, origin: unknown) => origin !== RELAY && Y.applyUpdate(ana, update, RELAY);
  const relayToVisitor = (update: Uint8Array, origin: unknown) => origin !== RELAY && Y.applyUpdate(doc, update, RELAY);
  doc.on('update', relayToAna);
  ana.on('update', relayToVisitor);

  const awareness = new Awareness(doc);
  const anaAwareness = new Awareness(ana);
  const relayPresence = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(anaAwareness, [...added, ...updated, ...removed]), RELAY);
  };
  anaAwareness.on('update', relayPresence);

  const anaState: PresenceState = {
    user: { id: 'ana', name: input.anaName, color: COLLAB_COLORS[6], avatarAssetId: null },
    pageId: DEMO_PAGE,
    cursor: { x: 640, y: 380 },
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: [],
    selectionBox: null,
    marquee: null,
    gesture: null,
    editingText: null,
    chatTyping: false,
    aiBusy: false,
  };
  const publish = (patch: Partial<PresenceState>) => {
    Object.assign(anaState, patch);
    anaAwareness.setLocalState({ ...anaState });
  };
  publish({});

  const host = new DocHost(doc, awareness);
  const engine: Engine = await createEngine({
    canvas: input.canvas,
    container: input.container,
    backend: new DirectBackend(host),
    user: { id: 'visitante', name: input.visitorName, color: COLLAB_COLORS[1], avatarAssetId: null },
    permissions: { canEdit: true },
    pageId: DEMO_PAGE,
    embedded: true,
  });

  // El escenario es un círculo: el cartel se encaja con margen para que las esquinas no queden cortadas.
  const frame = () => {
    engine.commands.fitAll();
    engine.commands.zoomTo(engine.state.zoom.get() * 0.78);
  };
  requestAnimationFrame(frame);
  const refit = new ResizeObserver(() => frame());
  refit.observe(input.container);

  // Ana mueve el cursor en el documento a ritmo de fotograma, como haría un cliente remoto.
  async function glide(to: Point, ms: number, signal: AbortSignal, drag?: { id: string; offset: Point }) {
    const from = anaState.cursor ?? to;
    const start = performance.now();
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const t = Math.min(1, (performance.now() - start) / ms);
      const point = { x: from.x + (to.x - from.x) * ease(t), y: from.y + (to.y - from.y) * ease(t) };
      publish({ cursor: point });
      if (drag) setNode(ana, drag.id, { x: Math.round(point.x - drag.offset.x), y: Math.round(point.y - drag.offset.y) });
      if (t === 1) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  let created: string | null = null;
  let loop = 0;

  async function script(signal: AbortSignal) {
    for (;;) {
      loop++;
      const star = nodeBox(ana, did('star-big'));
      if (star) {
        await glide(center(star), 900, signal);
        publish({ selection: [did('star-big')] });
        await wait(250, signal);
        const target = loop % 2 ? { x: 470, y: 250 } : { x: 220, y: 220 };
        await glide(target, 1100, signal, { id: did('star-big'), offset: { x: star.w / 2, y: star.h / 2 } });
        await wait(500, signal);
      }
      if (created) removeNodes(ana, [created]);
      const spot = loop % 2 ? { x: 630, y: 120 } : { x: 640, y: 210 };
      await glide(spot, 800, signal);
      created = did(`ana-${loop % 2}`);
      addNode(ana, {
        id: created, type: 'diamond', pageId: DEMO_PAGE, parentId: null, x: spot.x - 28, y: spot.y - 28, w: 56, h: 56,
        rotation: 0, opacity: 1, visible: true, locked: false, createdBy: 'landing', fill: '#00BDBEFF', stroke: null,
        strokeWidth: 1, strokeDash: 'solid', shadow: null,
      });
      publish({ selection: [created] });
      await wait(900, signal);
      const tag = nodeBox(ana, did('tag'));
      if (tag) {
        await glide(center(tag), 700, signal);
        publish({ selection: [did('tag')] });
        setNode(ana, did('tag'), { fill: loop % 2 ? '#FB8F5AFF' : '#AAD696FF' });
        await wait(800, signal);
      }
      publish({ selection: [] });
      await wait(1600, signal);
    }
  }

  let controller = new AbortController();
  let playing = !input.reducedMotion;
  const run = () => {
    if (!playing) return;
    controller = new AbortController();
    void script(controller.signal).catch(() => undefined);
  };

  // Cuando el visitante selecciona algo, Ana deja lo que hace y se acerca a mirarlo; luego sigue.
  const unwatch = engine.state.selection.subscribe((ids) => {
    if (!playing || ids.length === 0) return;
    const box = nodeBox(doc, ids[0]!);
    if (!box) return;
    controller.abort();
    const watch = new AbortController();
    controller = watch;
    void glide({ x: box.x + box.w + 36, y: box.y + box.h + 28 }, 600, watch.signal)
      .then(() => wait(1800, watch.signal))
      .then(() => {
        if (controller === watch) run();
      })
      .catch(() => undefined);
  });

  run();

  let many: string[] | null = null;

  return {
    toggleMany() {
      if (many) {
        removeNodes(doc, many);
        many = null;
        frame();
        return false;
      }
      many = addMany(doc);
      engine.commands.fitAll();
      return many.length === MANY_COUNT;
    },
    onFrameWork(listener) {
      return engine.onFrame((stats) => listener(stats.work));
    },
    setPlaying(next) {
      if (next === playing) return;
      playing = next;
      if (next) run();
      else controller.abort();
    },
    destroy() {
      controller.abort();
      unwatch();
      refit.disconnect();
      engine.destroy();
      host.destroy();
      anaAwareness.off('update', relayPresence);
      awareness.destroy();
      anaAwareness.destroy();
      doc.off('update', relayToAna);
      ana.off('update', relayToVisitor);
      doc.destroy();
      ana.destroy();
    },
  };
}
