import * as Y from 'yjs';
import { DirectBackend } from '../doc/backend.ts';
import { DocHost } from '../doc/host/DocHost.ts';
import { EditorCore, type EngineUser } from '../EditorCore.ts';
import type { Timers } from '../presence/throttle.ts';
import type { Renderer } from '../render/Renderer.ts';
import { NullSink } from '../render/sink.ts';
import type { Box } from '../types.ts';
import { collectScene, renderRaster, type ExportScene } from './raster.ts';

export const THUMB_WIDTH = 128;
export const THUMB_HEIGHT = 80;
// Margen alrededor del contenido, en píxeles de la miniatura.
const THUMB_MARGIN = 4;
// Como la vista previa (fitAll), nunca se amplía por encima del 100 %.
const THUMB_MAX_SCALE = 1;

export type ThumbnailOptions = { width: number; height: number; pageId?: string | null };

const READER: EngineUser = { id: 'thumbnail', name: '', color: '#888888', avatarAssetId: null };

// Ningún temporizador llega a dispararse: el motor vive solo lo que dura una llamada síncrona.
const STILL_TIMERS: Timers = {
  now: () => 0,
  setTimeout: () => null,
  clearTimeout: () => {},
};

// Escena de una página de la versión, sin Pixi: un motor de solo lectura sobre una copia del estado que se destruye
// al terminar. Sin pageId (o si la versión no la tiene), la primera página. null si la página no pinta nada.
export function versionScene(state: Uint8Array, pageId?: string | null): ExportScene | null {
  const doc = new Y.Doc();
  let host: DocHost | null = null;
  let backend: DirectBackend | null = null;
  let core: EditorCore | null = null;
  try {
    Y.applyUpdate(doc, state);
    host = new DocHost(doc, null, { timers: STILL_TIMERS });
    host.readOnly = true;
    backend = new DirectBackend(host);
    core = new EditorCore({
      backend,
      sink: new NullSink(),
      user: READER,
      readOnly: true,
      screen: { width: 1, height: 1 },
      // Sin frames: syncModel deja el árbol, las cajas y los recorridos de los conectores listos.
      raf: () => 0,
      caf: () => {},
      timers: STILL_TIMERS,
      ...(pageId ? { pageId } : {}),
    });
    core.syncModel();
    const page = core.pageId.get();
    return page ? collectScene(core, { kind: 'page', pageId: page }) : null;
  } finally {
    core?.destroy();
    backend?.destroy();
    host?.destroy();
    doc.destroy();
  }
}

// Caja del mundo que llena la miniatura con el contenido centrado y la escala que la lleva a width × height.
export function thumbnailFrame(content: Box, width: number, height: number): { bounds: Box; scale: number } {
  const w = Math.max(content.w, 1);
  const h = Math.max(content.h, 1);
  const scale = Math.min(THUMB_MAX_SCALE, (width - THUMB_MARGIN * 2) / w, (height - THUMB_MARGIN * 2) / h);
  const bw = width / scale;
  const bh = height / scale;
  return { scale, bounds: { x: content.x + content.w / 2 - bw / 2, y: content.y + content.h / 2 - bh / 2, w: bw, h: bh } };
}

// Miniatura JPG de una página de la versión, pintada con el renderer del editor (sin otro contexto WebGL).
// null si la página está vacía.
export async function renderVersionThumbnail(state: Uint8Array, renderer: Renderer, options: ThumbnailOptions): Promise<Blob | null> {
  const scene = versionScene(state, options.pageId);
  if (!scene) return null;
  const { bounds, scale } = thumbnailFrame(scene.bounds, options.width, options.height);
  const result = await renderRaster(renderer, { ...scene, bounds }, { scale, format: 'jpeg', quality: 0.8, variant: 'thumb', transparent: false });
  return result.blob;
}
