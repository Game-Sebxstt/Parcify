import { createContext } from 'svelte';
import { RendererUnavailableError, type EngineUser, type PageRecord } from '../../../engine/index.ts';
import { ApiError } from '../../../lib/api.ts';
import { canvasAssets } from '../../../lib/canvas-images.ts';
import { fetchVersionState, restoreVersion } from '../../../lib/versions.ts';
import { m } from '../../../paraglide/messages.js';
import type { VersionDto } from '../../../shared/api/versions.js';
import { showToast } from '../../../ui/toast.svelte.ts';
import type { mountVersionPreview, VersionPreview } from '../version-preview.ts';

type Loaded = { state: Uint8Array; module: { mountVersionPreview: typeof mountVersionPreview } };

export type VersionViewerOptions = {
  projectId: () => string;
  user: () => EngineUser;
  // Página activa del editor: la vista previa empieza en ella si la versión la tiene.
  activePage: () => string | null;
  // Adónde vuelve el foco al cerrar si el botón que abrió la vista previa ya no está.
  fallbackFocus: () => HTMLElement | null;
};

// Dueño de la vista previa de versiones: sobrevive a que se desmonte el panel de versiones y garantiza que como mucho
// hay una vista previa montada (dos contextos WebGL con el editor).
export class VersionViewer {
  viewing = $state.raw<VersionDto | null>(null);
  pageId = $state<string | null>(null);
  pages = $state.raw<readonly PageRecord[]>([]);
  status = $state<'loading' | 'ready' | 'error'>('loading');
  // load: no llegó el estado de la versión; canvas: el navegador no dio otro contexto WebGL; mount: otro fallo al montar.
  failure = $state<'load' | 'canvas' | 'mount'>('load');
  restoreBusy = $state(false);
  // Versión pendiente de confirmar para restaurar (desde la lista o desde la superposición).
  confirming = $state.raw<VersionDto | null>(null);
  // Sube con cada restauración: la lista se recarga.
  restored = $state(0);
  // Cada apertura lo incrementa: lo que llega tarde de una apertura anterior se destruye en el acto.
  previewSeq = 0;
  // Vista previa montada; las pruebas leen su motor y su canvas.
  preview: VersionPreview | null = null;

  #options: VersionViewerOptions;
  #container: HTMLElement | null = null;
  #pending: (() => void) | null = null;
  #returnFocus: HTMLElement | null = null;
  #focusAfterConfirm: HTMLElement | null = null;
  #chain: Promise<void> = Promise.resolve();

  constructor(options: VersionViewerOptions) {
    this.#options = options;
  }

  open(version: VersionDto): void {
    // Abrir otra versión desde la lista cambia adónde vuelve el foco; Reintentar (desde la superposición) lo conserva.
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!this.viewing || (active && !active.closest('[data-own-stage]'))) this.#returnFocus = active;
    this.#teardown();
    const seq = ++this.previewSeq;
    this.viewing = version;
    this.status = 'loading';
    this.pages = [];
    this.pageId = null;
    void this.#load(seq, version);
  }

  retry(): void {
    if (this.viewing) this.open(this.viewing);
  }

  close(focus = false): void {
    const wasOpen = this.viewing !== null;
    const next = this.#focusTarget();
    this.#teardown();
    this.previewSeq++;
    this.viewing = null;
    this.status = 'loading';
    this.pages = [];
    this.pageId = null;
    this.#returnFocus = null;
    if (focus && wasOpen) next?.focus({ preventScroll: true });
  }

  // Al cerrarse, el diálogo de confirmación devuelve el foco a quien lo abrió; si era el «Restaurar» de la
  // superposición, ya no existe y el foco va adonde iría al cerrar la vista previa.
  confirmCloseFocus(event: Event): void {
    const target = this.#focusAfterConfirm;
    this.#focusAfterConfirm = null;
    if (!target?.isConnected) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  }

  #focusTarget(): HTMLElement | null {
    const target = this.#returnFocus;
    return target?.isConnected ? target : this.#options.fallbackFocus();
  }

  setPage(id: string): void {
    if (!this.preview || id === this.pageId) return;
    this.preview.setPage(id);
    this.pageId = this.preview.pageId;
  }

  fit(): void {
    this.preview?.fit();
  }

  // Lo llama la superposición al montarse; devuelve la función que la desconecta.
  attach(container: HTMLElement): () => void {
    this.#container = container;
    const pending = this.#pending;
    this.#pending = null;
    pending?.();
    return () => {
      if (this.#container !== container) return;
      this.#teardown();
      this.#container = null;
      this.#pending = null;
    };
  }

  askRestore(version: VersionDto): void {
    this.confirming = version;
  }

  async restore(version: VersionDto | null = this.confirming): Promise<void> {
    if (!version || this.restoreBusy) return;
    this.restoreBusy = true;
    try {
      await restoreVersion(this.#options.projectId(), version.id);
      if (this.viewing) {
        this.#focusAfterConfirm = this.#focusTarget();
        this.close();
      }
      this.confirming = null;
      showToast({ message: m.editor_versions_restored() });
      this.restored++;
    } catch (error) {
      const message =
        error instanceof ApiError && error.code !== 'COLLAB_UNAVAILABLE' && error.code !== 'INTERNAL'
          ? error.message
          : m.editor_versions_restore_error();
      showToast({ message, tone: 'error' });
    } finally {
      this.restoreBusy = false;
    }
  }

  async #load(seq: number, version: VersionDto): Promise<void> {
    let loaded: Loaded;
    try {
      const [state, module] = await Promise.all([fetchVersionState(this.#options.projectId(), version.id), import('../version-preview.ts')]);
      loaded = { state, module };
    } catch (error) {
      if (seq !== this.previewSeq) return;
      console.warn('[versiones]', version.id, error instanceof ApiError ? error.status : error);
      this.failure = 'load';
      this.status = 'error';
      return;
    }
    if (seq !== this.previewSeq) return;
    if (this.#container) this.#mount(seq, loaded);
    else this.#pending = () => this.#mount(seq, loaded);
  }

  // Los montajes van en fila: uno que aún no terminó se destruye antes de crear el siguiente contexto WebGL.
  #mount(seq: number, loaded: Loaded): void {
    this.#chain = this.#chain.then(() => this.#mountNow(seq, loaded));
  }

  async #mountNow(seq: number, loaded: Loaded): Promise<void> {
    const container = this.#container;
    if (!container || seq !== this.previewSeq) return;
    try {
      const preview = await loaded.module.mountVersionPreview({
        container,
        state: loaded.state,
        user: this.#options.user(),
        assets: canvasAssets,
        label: m.editor_text_label(),
        pageId: this.#options.activePage(),
      });
      if (seq !== this.previewSeq || this.#container !== container) {
        preview.destroy();
        return;
      }
      this.preview = preview;
      this.pages = preview.pages;
      this.pageId = preview.pageId;
      this.status = 'ready';
    } catch (error) {
      if (seq !== this.previewSeq) return;
      console.warn('[versiones] no se pudo montar la vista previa', error);
      this.failure = error instanceof RendererUnavailableError ? 'canvas' : 'mount';
      this.status = 'error';
    }
  }

  #teardown(): void {
    this.#pending = null;
    this.preview?.destroy();
    this.preview = null;
  }
}

export const [getVersionViewer, setVersionViewer] = createContext<VersionViewer>();

export function versionLabel(version: VersionDto): string {
  if (version.name) return version.name;
  if (version.kind === 'auto') return m.editor_versions_kind_auto();
  if (version.kind === 'restore_point') return m.editor_versions_kind_restore_point();
  return m.editor_versions_kind_manual();
}
