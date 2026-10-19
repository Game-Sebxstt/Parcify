import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { META_KEYS, ROOT_KEYS } from '../shared/document/keys.js';
import { DOCUMENT_SCHEMA_VERSION } from '../shared/document/schema.js';

// Los ids de nodo y de página tienen 21 caracteres, como los de nanoid.
export const did = (name: string) => name.padEnd(21, '_').slice(0, 21);

export const DEMO_PAGE = did('landing-page');

const CORAL = '#FB8F5AFF';
const SAGE = '#AAD696FF';
const PETROL = '#244355FF';
const INK = '#EEF2F6FF';
const SURFACE = '#122136FF';

type Props = Record<string, unknown>;

function base(id: string, type: string, box: { x: number; y: number; w: number; h: number }, extra: Props = {}): Props {
  return {
    id: did(id),
    type,
    pageId: DEMO_PAGE,
    parentId: null,
    ...box,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    createdBy: 'landing',
    fill: null,
    stroke: null,
    strokeWidth: 1,
    strokeDash: 'solid',
    shadow: null,
    ...extra,
  };
}

// Un cartel pequeño hecho con las piezas del logo: el aro, las dos medias lunas y las estrellas.
export const DEMO_NODES: Props[] = [
  base('card', 'rect', { x: 0, y: 0, w: 720, h: 440 }, { fill: SURFACE, cornerRadius: 16 }),
  base('ring', 'arc', { x: 60, y: 60, w: 320, h: 320 }, { fill: CORAL, startAngle: 0, endAngle: Math.PI * 2, innerRatio: 0.86 }),
  base('moon-coral', 'arc', { x: 110, y: 110, w: 220, h: 220 }, { fill: CORAL, startAngle: Math.PI * 0.55, endAngle: Math.PI * 1.45, innerRatio: 0.55 }),
  base('moon-sage', 'arc', { x: 110, y: 110, w: 220, h: 220 }, { fill: SAGE, startAngle: Math.PI * 1.55, endAngle: Math.PI * 2.45, innerRatio: 0.55 }),
  base('star-big', 'star', { x: 196, y: 196, w: 48, h: 48 }, { fill: CORAL, points: 4, innerRatio: 0.35 }),
  base('star-small', 'star', { x: 268, y: 150, w: 22, h: 22 }, { fill: SAGE, points: 4, innerRatio: 0.35 }),
  base('title', 'rect', { x: 420, y: 96, w: 240, h: 44 }, { fill: INK, cornerRadius: 8 }),
  base('line-1', 'rect', { x: 420, y: 164, w: 200, h: 16 }, { fill: PETROL, cornerRadius: 8 }),
  base('line-2', 'rect', { x: 420, y: 196, w: 168, h: 16 }, { fill: PETROL, cornerRadius: 8 }),
  base('button', 'rect', { x: 420, y: 300, w: 150, h: 48 }, { fill: CORAL, cornerRadius: 24 }),
  base('tag', 'ellipse', { x: 600, y: 300, w: 48, h: 48 }, { fill: SAGE }),
];

function writeNode(nodes: Y.Map<unknown>, props: Props) {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(props)) map.set(key, value);
  nodes.set(String(props.id), map);
}

export function createDemoDoc(): Y.Doc {
  const doc = new Y.Doc();
  const indexes = generateNKeysBetween(null, null, DEMO_NODES.length);
  doc.transact(() => {
    const meta = doc.getMap(ROOT_KEYS.meta);
    meta.set(META_KEYS.schemaVersion, DOCUMENT_SCHEMA_VERSION);
    meta.set(META_KEYS.createdAt, 0);
    meta.set(META_KEYS.background, '#000B1DFF');
    const page = new Y.Map<unknown>();
    page.set('name', 'Página 1');
    page.set('index', 'a0');
    doc.getMap(ROOT_KEYS.pages).set(DEMO_PAGE, page);
    const nodes = doc.getMap(ROOT_KEYS.nodes);
    DEMO_NODES.forEach((props, i) => writeNode(nodes, { ...props, index: indexes[i] }));
  });
  return doc;
}

export function lastIndex(doc: Y.Doc): string | null {
  let last: string | null = null;
  doc.getMap(ROOT_KEYS.nodes).forEach((value) => {
    const index = value instanceof Y.Map ? value.get('index') : null;
    if (typeof index === 'string' && (last === null || index > last)) last = index;
  });
  return last;
}

export function addNode(doc: Y.Doc, props: Props) {
  doc.transact(() => writeNode(doc.getMap(ROOT_KEYS.nodes), { ...props, index: generateKeyBetween(lastIndex(doc), null) }));
}

export function setNode(doc: Y.Doc, id: string, patch: Props) {
  const node = doc.getMap(ROOT_KEYS.nodes).get(id);
  if (!(node instanceof Y.Map)) return false;
  doc.transact(() => {
    for (const [key, value] of Object.entries(patch)) node.set(key, value);
  });
  return true;
}

export function nodeBox(doc: Y.Doc, id: string): { x: number; y: number; w: number; h: number } | null {
  const node = doc.getMap(ROOT_KEYS.nodes).get(id);
  if (!(node instanceof Y.Map)) return null;
  return { x: Number(node.get('x')), y: Number(node.get('y')), w: Number(node.get('w')), h: Number(node.get('h')) };
}

const MANY_COLORS = [CORAL, SAGE, PETROL, INK];
export const MANY_COUNT = 1000;

// Los 1.000 elementos del control: una rejilla determinista alrededor del cartel.
export function addMany(doc: Y.Doc): string[] {
  const ids: string[] = [];
  const indexes = generateNKeysBetween(lastIndex(doc), null, MANY_COUNT);
  const columns = 50;
  doc.transact(() => {
    const nodes = doc.getMap(ROOT_KEYS.nodes);
    for (let i = 0; i < MANY_COUNT; i++) {
      const id = did(`many-${i}`);
      ids.push(id);
      const col = i % columns;
      const row = Math.floor(i / columns);
      const type = i % 3 === 0 ? 'ellipse' : i % 3 === 1 ? 'rect' : 'star';
      writeNode(nodes, {
        ...base(id, type, { x: -380 + col * 30, y: 500 + row * 30, w: 22, h: 22 }, {
          fill: MANY_COLORS[i % MANY_COLORS.length],
          ...(type === 'rect' ? { cornerRadius: 4 } : {}),
          ...(type === 'star' ? { points: 4, innerRatio: 0.4 } : {}),
        }),
        index: indexes[i],
      });
    }
  });
  return ids;
}

export function removeNodes(doc: Y.Doc, ids: readonly string[]) {
  doc.transact(() => {
    const nodes = doc.getMap(ROOT_KEYS.nodes);
    for (const id of ids) nodes.delete(id);
  });
}
