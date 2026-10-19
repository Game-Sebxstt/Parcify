import type { EditorCore } from '../EditorCore.ts';
import type { Renderer } from '../render/Renderer.ts';
import { collectScene, renderRaster } from './raster.ts';

export const PREVIEW_INTERVAL_MS = 10 * 60_000;
export const PREVIEW_MAX_SIDE = 800;

// Miniatura JPG de la primera página, con su fondo. null si la página está vacía.
export async function renderPreview(core: EditorCore, renderer: Renderer): Promise<Blob | null> {
  const page = core.store.pages()[0];
  if (!page) return null;
  const scene = collectScene(core, { kind: 'page', pageId: page.id });
  if (!scene) return null;
  const scale = Math.min(2, PREVIEW_MAX_SIDE / Math.max(scene.bounds.w, scene.bounds.h));
  const result = await renderRaster(renderer, scene, { scale, format: 'jpeg', transparent: false, quality: 0.85, variant: 'medium' });
  return result.blob;
}

type PublisherOptions = {
  core: EditorCore;
  renderer: Renderer;
  upload: (blob: Blob) => Promise<void>;
  canPublish: () => boolean;
};

// Sube la miniatura al salir del editor y cada 10 min, solo si el contenido cambió desde la última.
export class PreviewPublisher {
  private published: number;
  private running: Promise<void> | null = null;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly options: PublisherOptions) {
    this.published = options.core.contentVersion;
    this.timer = setInterval(() => void this.publish(), PREVIEW_INTERVAL_MS);
  }

  publish(): Promise<void> {
    if (this.running) return this.running;
    const version = this.options.core.contentVersion;
    if (version === this.published || !this.options.canPublish()) return Promise.resolve();
    this.running = (async () => {
      try {
        const blob = await renderPreview(this.options.core, this.options.renderer);
        if (!blob) return;
        await this.options.upload(blob);
        this.published = version;
      } catch {
        // Se reintenta en la siguiente ocasión.
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  destroy(): void {
    clearInterval(this.timer);
  }
}
