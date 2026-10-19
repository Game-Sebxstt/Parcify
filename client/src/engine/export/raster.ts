import { Container, RenderTexture } from 'pixi.js';
import type { AssetVariant } from '../assets/AssetResolver.ts';
import type { EditorCore } from '../EditorCore.ts';
import { geometryAABB, paintedFromGeometry, transformedAABB } from '../geometry/bounds.ts';
import { IDENTITY, type Mat } from '../geometry/matrix.ts';
import { parseColor } from '../render/color.ts';
import type { LoadedImage, Renderer } from '../render/Renderer.ts';
import { FrameView } from '../render/views/FrameView.ts';
import type { ImageSlot } from '../render/views/ImageView.ts';
import { ShapeView } from '../render/views/ShapeView.ts';
import { emptyAABB, hasTextContent, isContainer, isEmptyAABB, isRenderable, unionAABB, type Box, type SceneRecord } from '../types.ts';

export const EXPORT_TILE = 2048;
export const EXPORT_MAX_SIDE = 16_384;
export const EXPORT_MAX_PIXELS = 64_000_000;
export const EXPORT_SCALES = [1, 2, 3] as const;

export type ExportFormat = 'png' | 'jpeg';
export type Tile = { x: number; y: number; w: number; h: number };
export type ExportPlan = { scale: number; width: number; height: number; reduced: boolean; tiles: Tile[] };

// Tamaño en píxeles a esa escala, reducido para no pasar de 16.384 px de lado ni de 64 MP.
export function planExport(size: { w: number; h: number }, scale: number, maxTexture: number): ExportPlan {
  const w = Math.max(size.w, 1e-6);
  const h = Math.max(size.h, 1e-6);
  let effective = scale;
  const side = Math.max(w, h) * effective;
  if (side > EXPORT_MAX_SIDE) effective *= EXPORT_MAX_SIDE / side;
  const pixels = w * effective * (h * effective);
  if (pixels > EXPORT_MAX_PIXELS) effective *= Math.sqrt(EXPORT_MAX_PIXELS / pixels);
  const reduced = effective < scale;
  const width = clampSide(w * effective, reduced);
  const height = clampSide(h * effective, reduced);
  return { scale: effective, width, height, reduced, tiles: tilesFor(width, height, maxTexture) };
}

// Al reducir se redondea hacia abajo para no pasar del tope.
function clampSide(value: number, reduced: boolean): number {
  return Math.min(EXPORT_MAX_SIDE, Math.max(1, reduced ? Math.floor(value) : Math.ceil(value - 1e-6)));
}

// Una sola pasada si cabe en una textura de la GPU; si no, mosaicos de 2048 px (o menos si la GPU no llega).
export function tilesFor(width: number, height: number, maxTexture: number): Tile[] {
  if (width <= maxTexture && height <= maxTexture) return [{ x: 0, y: 0, w: width, h: height }];
  const size = Math.min(EXPORT_TILE, maxTexture);
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) tiles.push({ x, y, w: Math.min(size, width - x), h: Math.min(size, height - y) });
  }
  return tiles;
}

export type ExportItem = { id: string; record: SceneRecord; world: Mat; text: string; parent: string | null };
export type ExportScene = { bounds: Box; items: ExportItem[]; background: string };
export type ExportTarget = { kind: 'page'; pageId: string } | { kind: 'nodes'; ids: readonly string[] };

// Nodos que entran en la exportación, en orden de pintado, y su caja pintada. null si no hay nada visible.
export function collectScene(core: EditorCore, target: ExportTarget): ExportScene | null {
  const { store, tree } = core;
  const first = target.kind === 'page' ? null : store.get(target.ids[0] ?? '');
  const pageId = target.kind === 'page' ? target.pageId : first?.pageId;
  if (!pageId) return null;
  const roots = target.kind === 'nodes' ? new Set(target.ids.filter((id) => store.get(id)?.pageId === pageId)) : null;
  const included = new Set<string>();
  const items: ExportItem[] = [];
  const box = emptyAABB();
  for (const id of tree.paintOrder(pageId)) {
    const record = store.get(id);
    if (!record || !(isRenderable(record) || isContainer(record))) continue;
    const parentId = tree.parent(id);
    const parent = parentId && included.has(parentId) ? parentId : null;
    if (roots && !roots.has(id) && !parent) continue;
    included.add(id);
    const drawn: SceneRecord = isRenderable(record) ? core.drawnRecord(record) : record;
    const world = core.viewMatrix(record);
    items.push({ id, record: drawn, world, text: hasTextContent(record) ? store.text(id) : '', parent });
    if (!record.visible || hiddenWithin(core, id, included) || clippedWithin(core, id, included) || record.type === 'group') continue;
    const geometry = drawn.type === 'connector' && drawn.path ? transformedAABB(drawn.path, IDENTITY) : geometryAABB(record, world);
    unionAABB(box, paintedFromGeometry(record, geometry));
  }
  if (isEmptyAABB(box)) return null;
  const minX = Math.floor(box.minX);
  const minY = Math.floor(box.minY);
  return {
    bounds: { x: minX, y: minY, w: Math.ceil(box.maxX) - minX, h: Math.ceil(box.maxY) - minY },
    items,
    background: store.meta()?.background ?? '#FFFFFFFF',
  };
}

function hiddenWithin(core: EditorCore, id: string, included: ReadonlySet<string>): boolean {
  for (let parent = core.tree.parent(id); parent && included.has(parent); parent = core.tree.parent(parent)) {
    if (core.store.get(parent)?.visible === false) return true;
  }
  return false;
}

// Un frame con recorte ya cuenta con su propia caja.
function clippedWithin(core: EditorCore, id: string, included: ReadonlySet<string>): boolean {
  for (let parent = core.tree.parent(id); parent && included.has(parent); parent = core.tree.parent(parent)) {
    const record = core.store.get(parent);
    if (record?.type === 'frame' && record.clip) return true;
  }
  return false;
}

// `variant`: resolución de las imágenes; `full` salvo en miniaturas.
export type RasterOptions = { scale: number; format: ExportFormat; transparent: boolean; quality?: number; variant?: AssetVariant; signal?: AbortSignal };
export type RasterResult = { blob: Blob; width: number; height: number; reduced: boolean };

export async function renderRaster(renderer: Renderer, scene: ExportScene, options: RasterOptions): Promise<RasterResult> {
  const signal = options.signal ?? new AbortController().signal;
  const plan = planExport(scene.bounds, options.scale, renderer.maxTextureSize);
  const images = await loadImages(renderer, scene, options.variant ?? 'full', signal);
  const outer = new Container();
  const inner = new Container();
  outer.addChild(inner);
  try {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    await buildViews(inner, scene, images, Math.max(1, plan.scale));
    const transparent = options.transparent && options.format === 'png';
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d context unavailable');
    if (!transparent) {
      const { color, alpha } = parseColor(scene.background);
      // JPG no admite transparencia: un fondo translúcido se compone sobre blanco.
      context.fillStyle = '#ffffff';
      if (options.format === 'jpeg' || alpha < 1) context.fillRect(0, 0, plan.width, plan.height);
      context.globalAlpha = alpha;
      context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      context.fillRect(0, 0, plan.width, plan.height);
      context.globalAlpha = 1;
    }
    const pixi = renderer.app.renderer;
    inner.scale.set(plan.scale);
    for (const tile of plan.tiles) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const target = RenderTexture.create({ width: tile.w, height: tile.h, resolution: 1, antialias: true });
      try {
        inner.position.set(-scene.bounds.x * plan.scale - tile.x, -scene.bounds.y * plan.scale - tile.y);
        pixi.render({ container: outer, target, clear: true, clearColor: [0, 0, 0, 0] });
        const piece = pixi.extract.canvas({ target }) as unknown as CanvasImageSource;
        context.drawImage(piece, tile.x, tile.y);
      } finally {
        target.destroy(true);
      }
    }
    const blob = await canvas.convertToBlob({ type: `image/${options.format}`, ...(options.format === 'jpeg' ? { quality: options.quality ?? 0.92 } : {}) });
    return { blob, width: plan.width, height: plan.height, reduced: plan.reduced };
  } finally {
    outer.destroy({ children: true });
    for (const image of images.values()) image?.destroy();
  }
}

async function loadImages(renderer: Renderer, scene: ExportScene, variant: AssetVariant, signal: AbortSignal): Promise<Map<string, LoadedImage | null>> {
  const ids = new Set<string>();
  for (const item of scene.items) if (item.record.type === 'image') ids.add(item.record.assetId);
  const loaded = new Map<string, LoadedImage | null>();
  await Promise.all([...ids].map(async (id) => loaded.set(id, await renderer.loadExportImage(id, variant, signal))));
  return loaded;
}

async function buildViews(root: Container, scene: ExportScene, images: ReadonlyMap<string, LoadedImage | null>, resolution: number): Promise<void> {
  const boxes = new Map<string, FrameView>();
  const waiting: Array<{ view: ShapeView; item: ExportItem }> = [];
  const fonts: Promise<void>[] = [];
  for (const item of scene.items) {
    const parent = item.parent ? (boxes.get(item.parent)?.body ?? root) : root;
    const record = item.record;
    if (isContainer(record)) {
      const box = new FrameView(record.type);
      box.draw(record, item.world);
      box.root.visible = record.visible;
      boxes.set(item.id, box);
      parent.addChild(box.root);
      continue;
    }
    const view = new ShapeView();
    let slot: ImageSlot = { kind: 'broken' };
    if (record.type === 'image') {
      const texture = images.get(record.assetId);
      if (texture) slot = { kind: 'ready', texture: texture.texture };
    }
    view.draw(record, slot);
    const font = view.drawText(record, item.text, resolution, false);
    if (font) {
      fonts.push(font);
      waiting.push({ view, item });
    }
    view.setWorld(item.world, record.opacity);
    view.root.visible = record.visible;
    parent.addChild(view.root);
  }
  if (!fonts.length) return;
  await Promise.allSettled(fonts);
  for (const { view, item } of waiting) view.drawText(item.record as Parameters<ShapeView['drawText']>[0], item.text, resolution, false);
}

// Nombre de archivo sin caracteres que los sistemas de archivos rechazan.
export function exportFileName(name: string, format: ExportFormat | 'svg' | 'pdf' | 'parcify'): string {
  const visible = Array.from(name, (char) => (char.charCodeAt(0) < 32 ? ' ' : char)).join('');
  const base = visible.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'parcify';
  return `${base}.${format === 'jpeg' ? 'jpg' : format}`;
}
