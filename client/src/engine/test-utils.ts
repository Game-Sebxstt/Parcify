import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { initDocument } from '../shared/document/init.js';
import { ROOT_KEYS } from '../shared/document/keys.js';
import { DirectBackend } from './doc/backend.ts';
import { DocHost } from './doc/host/DocHost.ts';
import { EditorCore, type CoreOptions } from './EditorCore.ts';
import type { Timers } from './presence/throttle.ts';
import { NullSink } from './render/sink.ts';

export const TEST_USER = { id: 'user-a', name: 'Ana', color: '#FB8F5A', avatarAssetId: null };
export const PAGE_ID = 'PAGE_0000000000000001';

export function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDocument(doc, { pageId: PAGE_ID, now: 0 });
  return doc;
}

let counter = 0;
export function nodeId(): string {
  counter++;
  return `n${String(counter).padStart(20, '0')}`;
}

export function rect(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: nodeId(),
    type: 'rect',
    pageId: PAGE_ID,
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
    createdBy: TEST_USER.id,
    fill: '#FF0000FF',
    stroke: null,
    strokeWidth: 1,
    strokeDash: 'solid',
    shadow: null,
    cornerRadius: 0,
    ...overrides,
  };
}

const BASE = { pageId: PAGE_ID, parentId: null, index: 'a0', x: 0, y: 0, rotation: 0, opacity: 1, visible: true, locked: false, createdBy: TEST_USER.id };

export function group(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: nodeId(), type: 'group', ...BASE, w: 0, h: 0, ...overrides };
}

export function frame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: nodeId(), type: 'frame', ...BASE, w: 400, h: 300, fill: '#FFFFFFFF', clip: true, ...overrides };
}

export function connectorNode(from: unknown, to: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: nodeId(),
    type: 'connector',
    ...BASE,
    index: 'a5',
    w: 0,
    h: 0,
    fill: null,
    stroke: '#EEF2F6FF',
    strokeWidth: 2,
    strokeDash: 'solid',
    shadow: null,
    from,
    to,
    route: 'straight',
    startCap: 'none',
    endCap: 'arrow',
    ...overrides,
  };
}

export function putNode(doc: Y.Doc, props: Record<string, unknown>, origin: unknown = 'remote'): string {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(props)) map.set(key, value);
    doc.getMap(ROOT_KEYS.nodes).set(props.id as string, map);
  }, origin);
  return props.id as string;
}

export function nodeMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap(ROOT_KEYS.nodes).get(id) as Y.Map<unknown>;
}

// Host en el mismo hilo sobre un Y.Doc: las pruebas pueden tocar el documento directamente.
export function directBackend(doc: Y.Doc, awareness: Awareness | null = null, options: { timers?: Timers } = {}) {
  const host = new DocHost(doc, awareness, { logger: { warn: () => {}, error: () => {}, debug: () => {} }, ...(options.timers ? { timers: options.timers } : {}) });
  return { host, backend: new DirectBackend(host) };
}

// Motor sin Pixi: los frames se ejecutan a mano con tick().
export function makeCore(doc: Y.Doc = newDoc(), options: Partial<Omit<CoreOptions, 'backend'>> & { awareness?: Awareness | null } = {}) {
  const sink = new NullSink();
  let pending: ((time: number) => void) | null = null;
  const { awareness = null, ...rest } = options;
  const { host, backend } = directBackend(doc, awareness, rest.timers ? { timers: rest.timers } : {});
  const core = new EditorCore({
    backend,
    sink,
    user: TEST_USER,
    screen: { width: 1000, height: 800 },
    camera: { x: 0, y: 0, zoom: 1 },
    raf: (callback) => {
      pending = callback;
      return 1;
    },
    caf: () => {
      pending = null;
    },
    logger: { warn: () => {} },
    ...rest,
  });
  const tick = (time: number = performance.now()) => {
    const run = pending;
    pending = null;
    run?.(time);
  };
  tick();
  return { core, sink, doc, host, backend, tick, get hasFrame() { return pending !== null; } };
}

export const pointer = (x: number, y: number, extra: Partial<{ shift: boolean; alt: boolean; ctrl: boolean; button: number }> = {}) => ({
  x,
  y,
  button: 0,
  shift: false,
  alt: false,
  ctrl: false,
  pointerId: 1,
  ...extra,
});
