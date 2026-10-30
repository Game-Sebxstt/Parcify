import type { AnimationState, Engine, NodeRecord } from '../../engine/index.ts';
import type { OverlayModel } from '../../engine/render/sink.ts';
import type { Animation } from '../../shared/document/schema.js';
import type { CollabSession } from '../../lib/collab.ts';

// Solo se carga en builds con PUBLIC_TEST_HOOKS=1: los e2e leen el documento y la cámara sin tocar el lienzo.
export type ParcifyTestHooks = {
  status(): string;
  synced(): boolean;
  readOnly(): boolean;
  nodes(): NodeRecord[];
  selection(): readonly string[];
  // Contenido de texts[id] de cada nodo con texto.
  texts(): Record<string, string>;
  // Nodo cuyo texto se está editando aquí.
  editing(): string | null;
  // Presencia de los demás: nombre, cursor y selección.
  remote(): Array<{ name: string; cursor: { x: number; y: number } | null; selection: readonly string[] }>;
  // Punto de mundo → coordenadas de la página.
  toPage(x: number, y: number): { x: number; y: number };
  // Estado de la textura de cada imagen: ready, loading o broken.
  images(): Record<string, string>;
  // Animaciones del documento por nodo y estado del reproductor local.
  animations(): Record<string, Animation>;
  player(): AnimationState | null;
  // Posición (traslación de la matriz de mundo), opacidad y, en los textos, color con que se pinta la vista de un nodo.
  view(id: string): { x: number; y: number; opacity: number; color?: string } | null;
  // Último modelo del overlay dibujado (selección, tiradores, guías).
  overlayModel(): OverlayModel | null;
  // Tamaño en CSS px con que trabaja la cámara.
  cameraSize(): { width: number; height: number } | null;
  // RGBA del búfer de dibujo del canvas en un punto de la página (CSS px × resolución del renderer).
  // Vuelve a presentar el escenario tal cual está y lee ese búfer, así que refleja el tamaño real del canvas y su contexto,
  // pero no lo que lo tapa en el DOM: para eso hace falta una captura de pantalla.
  // null sin motor, con un renderer que no es WebGL, con el contexto perdido, con el canvas fuera del DOM o con el punto fuera del búfer.
  pixelAt(x: number, y: number): [number, number, number, number] | null;
  // Contenedores que ahora se pintan desde su textura cacheada.
  cachedContainers(): number;
  // Cámara del editor o de la vista previa de versión abierta (null si no hay).
  camera(target?: 'editor' | 'preview'): { x: number; y: number; zoom: number } | null;
  // Como pixelAt, sobre el canvas de la vista previa de versión.
  previewPixelAt(x: number, y: number): [number, number, number, number] | null;
  // Caja del contenido de la página de la vista previa, en coordenadas de la página web.
  previewPageRect(): { left: number; top: number; right: number; bottom: number } | null;
  // Reabre el documento como un cambio de epoch: el editor desmonta y vuelve a montar el motor.
  forceCollabReset(): Promise<void>;
};

declare global {
  interface Window {
    __parcifyTest?: ParcifyTestHooks;
  }
}

function readPixel(engine: Engine | null, x: number, y: number): [number, number, number, number] | null {
  if (!engine) return null;
  const pixi = engine.renderer.app.renderer;
  const canvas = engine.renderer.app.canvas;
  if (!('gl' in pixi) || !canvas.isConnected) return null;
  const gl = pixi.gl;
  if (gl.isContextLost()) return null;
  const rect = canvas.getBoundingClientRect();
  const px = Math.floor((x - rect.left) * pixi.resolution);
  const py = gl.drawingBufferHeight - 1 - Math.floor((y - rect.top) * pixi.resolution);
  if (px < 0 || py < 0 || px >= gl.drawingBufferWidth || py >= gl.drawingBufferHeight) return null;
  try {
    // Sin preserveDrawingBuffer el búfer solo es legible en el mismo turno en que se pinta.
    pixi.render(engine.renderer.app.stage);
    const pixel = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
  } catch {
    return null;
  }
}

export function installTestHooks(
  getEngine: () => Engine | null,
  getCollab: () => CollabSession | null,
  container: () => HTMLElement | null,
  getPreview: () => Engine | null,
): void {
  window.__parcifyTest = {
    status: () => getCollab()?.state.get().status ?? 'connecting',
    synced: () => getCollab()?.state.get().synced ?? false,
    readOnly: () => getEngine()?.state.readOnly.get() ?? true,
    nodes: () => {
      const engine = getEngine();
      if (!engine) return [];
      engine.core.syncModel();
      return [...engine.core.store.all()].map((record) => ({ ...record }));
    },
    selection: () => getEngine()?.state.selection.get() ?? [],
    texts: () => {
      const engine = getEngine();
      if (!engine) return {};
      engine.core.syncModel();
      const texts: Record<string, string> = {};
      for (const record of engine.core.store.all()) {
        const content = engine.core.store.text(record.id);
        if (content) texts[record.id] = content;
      }
      return texts;
    },
    editing: () => getEngine()?.state.editingText.get()?.id ?? null,
    remote: () =>
      [...(getEngine()?.core.presence.remote().values() ?? [])].map((state) => ({
        name: state.user.name,
        cursor: state.cursor,
        selection: state.selection,
      })),
    toPage: (x, y) => {
      const engine = getEngine();
      const rect = container()?.getBoundingClientRect();
      if (!engine || !rect) return { x: 0, y: 0 };
      const point = engine.core.worldToScreen(x, y);
      return { x: rect.left + point.x, y: rect.top + point.y };
    },
    images: () => {
      const engine = getEngine();
      if (!engine) return {};
      const states: Record<string, string> = {};
      for (const record of engine.core.store.all()) {
        if (record.type === 'image') states[record.id] = engine.renderer.textures.stateFor(record.id).kind;
      }
      return states;
    },
    animations: () => {
      const engine = getEngine();
      if (!engine) return {};
      engine.core.syncModel();
      return Object.fromEntries(engine.core.store.animations());
    },
    player: () => getEngine()?.anim.state.get() ?? null,
    view: (id) => {
      const view = getEngine()?.renderer.viewOf(id);
      if (!view) return null;
      const color = view.record.type === 'text' ? view.record.color : undefined;
      return { x: view.world[4], y: view.world[5], opacity: view.record.opacity, ...(color ? { color } : {}) };
    },
    overlayModel: () => getEngine()?.renderer.lastOverlay ?? null,
    cameraSize: () => {
      const camera = getEngine()?.core.camera;
      return camera ? { width: camera.width, height: camera.height } : null;
    },
    pixelAt: (x, y) => readPixel(getEngine(), x, y),
    cachedContainers: () => getEngine()?.renderer.cachedContainers ?? 0,
    camera: (target = 'editor') => {
      const engine = target === 'preview' ? getPreview() : getEngine();
      if (!engine) return null;
      const camera = engine.camera();
      return { x: camera.x, y: camera.y, zoom: camera.zoom };
    },
    previewPixelAt: (x, y) => readPixel(getPreview(), x, y),
    previewPageRect: () => {
      const engine = getPreview();
      const canvas = engine?.renderer.app.canvas;
      if (!engine || !canvas?.isConnected) return null;
      engine.core.syncModel();
      const bounds = engine.core.pageBounds();
      if (!bounds) return null;
      const rect = canvas.getBoundingClientRect();
      const min = engine.core.worldToScreen(bounds.minX, bounds.minY);
      const max = engine.core.worldToScreen(bounds.maxX, bounds.maxY);
      return { left: rect.left + min.x, top: rect.top + min.y, right: rect.left + max.x, bottom: rect.top + max.y };
    },
    forceCollabReset: async () => {
      const reset = getCollab()?.testReset;
      if (!reset) throw new Error('La sesión no admite reinicios de prueba');
      await reset();
    },
  };
}
