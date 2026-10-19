import type { AnimationState, Engine, NodeRecord } from '../../engine/index.ts';
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
  // Posición (traslación de la matriz de mundo) y opacidad con que se pinta la vista de un nodo.
  view(id: string): { x: number; y: number; opacity: number } | null;
};

declare global {
  interface Window {
    __parcifyTest?: ParcifyTestHooks;
  }
}

export function installTestHooks(getEngine: () => Engine | null, getCollab: () => CollabSession | null, container: () => HTMLElement | null): void {
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
      return view ? { x: view.world[4], y: view.world[5], opacity: view.record.opacity } : null;
    },
  };
}
