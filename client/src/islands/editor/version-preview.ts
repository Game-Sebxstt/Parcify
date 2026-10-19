import * as Y from 'yjs';
import type { AssetResolver } from '../../engine/assets/AssetResolver.ts';
import { DocHost } from '../../engine/doc/host/DocHost.ts';
import { createEngine, DirectBackend, type EngineUser } from '../../engine/index.ts';

export type VersionPreview = { destroy(): void };

// Lienzo de solo lectura sobre una copia local del estado de la versión: no se conecta a nadie.
export async function mountVersionPreview(input: {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  state: Uint8Array;
  user: EngineUser;
  assets: AssetResolver | null;
  label: string;
}): Promise<VersionPreview> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, input.state);
  const host = new DocHost(doc, null);
  host.readOnly = true;
  let engine;
  try {
    engine = await createEngine({
      canvas: input.canvas,
      container: input.container,
      backend: new DirectBackend(host),
      user: input.user,
      permissions: { canEdit: false },
      assets: input.assets,
      embedded: true,
      labels: { textEditor: input.label },
    });
  } catch (error) {
    host.destroy();
    doc.destroy();
    throw error;
  }
  engine.commands.fitAll();
  return {
    destroy() {
      engine.destroy();
      host.destroy();
      doc.destroy();
    },
  };
}
