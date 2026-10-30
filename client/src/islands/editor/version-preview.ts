import * as Y from 'yjs';
import type { AssetResolver } from '../../engine/assets/AssetResolver.ts';
import { DocHost } from '../../engine/doc/host/DocHost.ts';
import { createEngine, DirectBackend, type Engine, type EngineUser, type PageRecord } from '../../engine/index.ts';
import { wheelPreference } from '../../lib/input-prefs.ts';
import { createEngineCanvas } from './engine-canvas.ts';

export type VersionPreview = {
  engine: Engine;
  canvas: HTMLCanvasElement;
  pages: readonly PageRecord[];
  readonly pageId: string | null;
  setPage(id: string): void;
  // Vuelve a encajar la página y retoma el re-encaje al cambiar de tamaño.
  fit(): void;
  destroy(): void;
};

// Lienzo de solo lectura sobre una copia local del estado de la versión: no se conecta a nadie.
// Cada vista previa crea y quita su propio canvas.
export async function mountVersionPreview(input: {
  container: HTMLElement;
  state: Uint8Array;
  user: EngineUser;
  assets: AssetResolver | null;
  label: string;
  pageId?: string | null;
}): Promise<VersionPreview> {
  // Con las fuentes ya cargadas, los textos tienen su tamaño final antes del primer encuadre.
  await document.fonts.ready;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, input.state);
  const host = new DocHost(doc, null);
  host.readOnly = true;
  const canvas = createEngineCanvas(input.container);
  let engine: Engine;
  try {
    // createEngine deja el encuadre pendiente hasta el primer frame con la página pintada y el tamaño definitivo.
    engine = await createEngine({
      canvas,
      container: input.container,
      backend: new DirectBackend(host),
      user: input.user,
      permissions: { canEdit: false },
      assets: input.assets,
      embedded: true,
      // Dos dedos del touchpad desplazan la vista previa en vez de la página.
      wheel: 'canvas',
      wheelPref: wheelPreference,
      labels: { textEditor: input.label },
      ...(input.pageId ? { pageId: input.pageId } : {}),
    });
  } catch (error) {
    canvas.remove();
    host.destroy();
    doc.destroy();
    throw error;
  }
  const core = engine.core;
  // Mientras nadie mueva la vista, cada cambio de tamaño vuelve a encajar la página.
  const observer = new ResizeObserver(() => core.fitWhenReady());
  observer.observe(input.container);

  const fit = () => {
    core.userMovedCamera = false;
    core.fitWhenReady();
  };

  return {
    engine,
    canvas,
    pages: engine.state.pages.get(),
    get pageId() {
      return core.pageId.get();
    },
    setPage(id) {
      if (id === core.pageId.get()) return;
      core.setPage(id);
      fit();
    },
    fit,
    destroy() {
      observer.disconnect();
      engine.destroy();
      canvas.remove();
      host.destroy();
      doc.destroy();
    },
  };
}
