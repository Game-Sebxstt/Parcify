import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { BENCH_IMAGE_SEED, BENCH_IMAGE_SIZE, BENCH_IMAGES, BENCH_VARIANTS, imageFile, mulberry32 } from './random.ts';

// Genera una sola vez las 200 imágenes sintéticas del benchmark (1600×1200, patrones de colores planos) y sus
// variantes thumb, medium y full. Se versionan en bench/fixtures/images: el benchmark no depende del servidor.
// Uso: node bench/fixtures/make-images.ts

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'images');

const PALETTE: Array<[number, number, number]> = [
  [251, 143, 90],
  [170, 214, 150],
  [36, 67, 85],
  [238, 242, 246],
  [240, 113, 103],
  [127, 178, 240],
  [201, 160, 255],
  [255, 209, 102],
  [18, 28, 44],
  [92, 201, 182],
  [255, 140, 180],
  [120, 120, 140],
];

type Shape = { kind: 'rect' | 'circle'; x: number; y: number; w: number; h: number; color: number };
type Scene = { background: number; shapes: Shape[] };

// Escena en coordenadas 0..1: el mismo dibujo a cualquier resolución, sin remuestrear.
function scene(random: () => number): Scene {
  const pick = () => Math.floor(random() * PALETTE.length);
  const shapes: Shape[] = [];
  const count = 6 + Math.floor(random() * 6);
  for (let i = 0; i < count; i++) {
    const w = 0.1 + random() * 0.45;
    shapes.push({ kind: random() < 0.6 ? 'rect' : 'circle', x: random() * (1 - w), y: random() * 0.8, w, h: 0.1 + random() * 0.45, color: pick() });
  }
  return { background: pick(), shapes };
}

function render(s: Scene, width: number, height: number): Buffer {
  // Una fila por línea con el byte de filtro delante (0, sin filtro): PNG con paleta de 8 bits.
  const stride = width + 1;
  const data = Buffer.alloc(stride * height, s.background);
  for (let y = 0; y < height; y++) data[y * stride] = 0;
  for (const shape of s.shapes) {
    const x0 = Math.round(shape.x * width);
    const y0 = Math.round(shape.y * height);
    const x1 = Math.min(width, Math.round((shape.x + shape.w) * width));
    const y1 = Math.min(height, Math.round((shape.y + shape.h) * height));
    if (shape.kind === 'rect') {
      for (let y = y0; y < y1; y++) data.fill(shape.color, y * stride + 1 + x0, y * stride + 1 + x1);
      continue;
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2;
    const ry = (y1 - y0) / 2;
    for (let y = y0; y < y1; y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const half = rx * Math.sqrt(1 - dy * dy);
      const from = Math.max(0, Math.round(cx - half));
      const to = Math.min(width, Math.round(cx + half));
      if (to > from) data.fill(shape.color, y * stride + 1 + from, y * stride + 1 + to);
    }
  }
  return data;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function png(width: number, height: number, rows: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  const palette = Buffer.from(PALETTE.flat());
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', palette),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(out, { recursive: true });
const random = mulberry32(BENCH_IMAGE_SEED);
let bytes = 0;
for (let i = 0; i < BENCH_IMAGES; i++) {
  const s = scene(random);
  for (const [variant, side] of Object.entries(BENCH_VARIANTS) as Array<[keyof typeof BENCH_VARIANTS, number]>) {
    const width = side;
    const height = Math.round((side * BENCH_IMAGE_SIZE.h) / BENCH_IMAGE_SIZE.w);
    const file = png(width, height, render(s, width, height));
    bytes += file.length;
    writeFileSync(join(out, imageFile(i, variant)), file);
  }
}
console.log(`${BENCH_IMAGES * 3} imágenes en ${out} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
