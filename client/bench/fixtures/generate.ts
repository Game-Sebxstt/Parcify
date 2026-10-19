import { generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { META_KEYS, ROOT_KEYS } from '../../src/shared/document/keys.js';
import { DOCUMENT_SCHEMA_VERSION } from '../../src/shared/document/schema.js';
import { BENCH_IMAGES, mulberry32 } from './random.ts';

export { mulberry32 } from './random.ts';

export const BENCH_SEED = 20261015;
// 1.000 formas (60 de ellas conectores y 50 textos cortos) y 200 imágenes de 200 assets distintos.
export const BENCH_SHAPES = 1000;
export const BENCH_CONNECTORS = 60;
export const BENCH_TEXTS = 50;

const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
const HEX = '0123456789abcdef';
const PALETTE = ['#FB8F5AFF', '#AAD696FF', '#244355FF', '#EEF2F6FF', '#F07167FF', '#7FB2F0FF', '#C9A0FFFF', '#FFD166FF'];
const ROUTES = ['straight', 'elbow', 'curved'] as const;
const FITS = ['fill', 'cover', 'contain'] as const;

function seededId(random: () => number): string {
  let id = '';
  for (let i = 0; i < 21; i++) id += ALPHABET[Math.floor(random() * 64)];
  return id;
}

// uuid v4 con la semilla.
function seededUuid(random: () => number): string {
  let hex = '';
  for (let i = 0; i < 32; i++) hex += HEX[Math.floor(random() * 16)];
  const variant = HEX[8 + Math.floor(random() * 4)];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type Pick = 'rect' | 'ellipse' | 'star' | 'triangle' | 'diamond' | 'polygon' | 'arc' | 'line';
const MIX: Array<[Pick, number]> = [
  ['rect', 0.3],
  ['ellipse', 0.2],
  ['star', 0.1],
  ['triangle', 0.1],
  ['diamond', 0.08],
  ['polygon', 0.08],
  ['arc', 0.06],
  ['line', 0.08],
];

function pickType(value: number): Pick {
  let acc = 0;
  for (const [type, weight] of MIX) {
    acc += weight;
    if (value < acc) return type;
  }
  return 'rect';
}

// `image` es el número de la imagen en bench/fixtures/images.
export type BenchImage = { id: string; assetId: string; image: number };
export type BenchFixture = { doc: Y.Doc; pageId: string; ids: string[]; images: BenchImage[] };

// Documento determinista del escenario de referencia. Las formas, los textos y las imágenes ocupan una celda de
// una cuadrícula; los conectores unen celdas vecinas y van al final de `ids` y encima en el orden z.
export function generateBenchDoc(options: { count?: number; images?: number; seed?: number } = {}): BenchFixture {
  const shapes = options.count ?? BENCH_SHAPES;
  const imageCount = options.images ?? BENCH_IMAGES;
  const connectors = Math.min(BENCH_CONNECTORS, Math.floor(shapes / 10));
  const texts = Math.min(BENCH_TEXTS, Math.floor(shapes / 10));
  const cells = shapes - connectors + imageCount;
  const random = mulberry32(options.seed ?? BENCH_SEED);
  const doc = new Y.Doc();
  const pageId = seededId(random);
  const ids: string[] = [];
  const images: BenchImage[] = [];
  const indexes = generateNKeysBetween(null, null, cells + connectors);
  const columns = Math.ceil(Math.sqrt(cells * 1.78));
  const cell = 150;
  // Una imagen cada cells / imageCount celdas y los textos repartidos por el resto.
  const imageEvery = imageCount ? cells / imageCount : Infinity;
  const textEvery = texts ? (cells - imageCount) / texts : Infinity;

  doc.transact(() => {
    const meta = doc.getMap(ROOT_KEYS.meta);
    meta.set(META_KEYS.schemaVersion, DOCUMENT_SCHEMA_VERSION);
    meta.set(META_KEYS.createdAt, 0);
    meta.set(META_KEYS.background, '#000B1DFF');
    const page = new Y.Map<unknown>();
    page.set('name', 'Página 1');
    page.set('index', 'a0');
    doc.getMap(ROOT_KEYS.pages).set(pageId, page);

    const nodes = doc.getMap(ROOT_KEYS.nodes);
    const textMap = doc.getMap(ROOT_KEYS.texts);
    const put = (props: Record<string, unknown>) => {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(props)) map.set(key, value);
      nodes.set(props.id as string, map);
    };
    const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    let shapeCells = 0;
    for (let i = 0; i < cells; i++) {
      const id = seededId(random);
      ids.push(id);
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = col * cell + Math.round(random() * 30);
      const y = row * cell + Math.round(random() * 30);
      const common = { id, pageId, parentId: null, index: indexes[i], rotation: 0, opacity: 1, visible: true, locked: false, createdBy: 'bench' };
      if (images.length < imageCount && i >= images.length * imageEvery) {
        const assetId = seededUuid(random);
        images.push({ id, assetId, image: images.length });
        boxes.push({ x, y, w: 120, h: 90 });
        put({ ...common, type: 'image', x, y, w: 120, h: 90, assetId, fit: FITS[Math.floor(random() * FITS.length)], cornerRadius: random() < 0.3 ? 8 : 0 });
        continue;
      }
      // La celda j de las que no son imagen lleva texto cuando cruza un múltiplo de textEvery.
      const j = shapeCells++;
      if (Math.floor(j / textEvery) < Math.floor((j + 1) / textEvery)) {
        boxes.push({ x, y, w: 110, h: 20 });
        put({
          ...common,
          type: 'text',
          x,
          y,
          w: 110,
          h: 20,
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: 500,
          italic: false,
          underline: false,
          strike: false,
          color: '#EEF2F6FF',
          align: 'left',
          lineHeight: 1.25,
          autoWidth: false,
        });
        textMap.set(id, new Y.Text(`Nota ${i}`));
        continue;
      }
      const type = pickType(random());
      const w = Math.round(40 + random() * 90);
      const h = type === 'line' ? Math.round(random() * 80) : Math.round(40 + random() * 90);
      const stroke = random() < 0.35;
      boxes.push({ x, y, w, h });
      const props: Record<string, unknown> = {
        ...common,
        type,
        x,
        y,
        w,
        h,
        rotation: random() < 0.3 ? Math.round((random() * 2 - 1) * Math.PI * 1000) / 1000 : 0,
        opacity: random() < 0.15 ? 0.6 : 1,
        fill: type === 'line' ? null : PALETTE[Math.floor(random() * PALETTE.length)],
        stroke: type === 'line' || stroke ? PALETTE[Math.floor(random() * PALETTE.length)] : null,
        strokeWidth: type === 'line' ? 3 : stroke ? 2 : 1,
        strokeDash: random() < 0.1 ? 'dashed' : 'solid',
        shadow: null,
      };
      if (type === 'rect') props.cornerRadius = random() < 0.5 ? 8 : 0;
      if (type === 'star') Object.assign(props, { points: 5, innerRatio: 0.5 });
      if (type === 'polygon') props.sides = 6;
      if (type === 'arc') Object.assign(props, { startAngle: 0, endAngle: Math.PI * 1.5, innerRatio: 0.4 });
      if (type === 'line') {
        Object.assign(props, { points: [[0, 0], [w, h]], startCap: 'none', endCap: random() < 0.5 ? 'arrow' : 'none', rotation: 0 });
      }
      put(props);
    }

    // Conectores entre una celda y su vecina de la derecha o de abajo.
    for (let k = 0; k < connectors; k++) {
      const id = seededId(random);
      ids.push(id);
      const a = Math.floor(random() * (cells - columns - 1));
      const down = random() < 0.5;
      const b = down ? a + columns : a + 1;
      const from = boxes[a]!;
      const to = boxes[b]!;
      const start = down ? { x: from.x + from.w / 2, y: from.y + from.h } : { x: from.x + from.w, y: from.y + from.h / 2 };
      const end = down ? { x: to.x + to.w / 2, y: to.y } : { x: to.x, y: to.y + to.h / 2 };
      put({
        id,
        type: 'connector',
        pageId,
        parentId: null,
        index: indexes[cells + k],
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        w: Math.abs(end.x - start.x),
        h: Math.abs(end.y - start.y),
        ...(start.x > end.x ? { flipX: true } : {}),
        ...(start.y > end.y ? { flipY: true } : {}),
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        createdBy: 'bench',
        fill: null,
        stroke: PALETTE[Math.floor(random() * PALETTE.length)],
        strokeWidth: 2,
        strokeDash: 'solid',
        shadow: null,
        from: { nodeId: ids[a], anchor: down ? 'bottom' : 'right' },
        to: { nodeId: ids[b], anchor: down ? 'top' : 'left' },
        route: ROUTES[k % ROUTES.length],
        startCap: 'none',
        endCap: 'arrow',
      });
    }
  });
  return { doc, pageId, ids, images };
}
