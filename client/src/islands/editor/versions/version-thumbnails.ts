import { createContext } from 'svelte';
import type { Renderer } from '../../../engine/render/Renderer.ts';
import { ApiError } from '../../../lib/api.ts';
import { fetchVersionState } from '../../../lib/versions.ts';
import type { VersionDto } from '../../../shared/api/versions.js';

export const THUMB_MAX_BYTES = 4 * 1024 * 1024;
export const THUMB_CACHE_SIZE = 50;
// Se pinta al doble de los 64 × 40 px de la fila, para pantallas de alta densidad.
const THUMB_SIZE = { width: 128, height: 80 } as const;

// image: miniatura lista; empty: la página no pinta nada; large: versión de más de 4 MiB; error: no se pudo hacer.
export type ThumbResult = { kind: 'image'; url: string } | { kind: 'empty' } | { kind: 'large' } | { kind: 'error' };

type Job = {
  version: VersionDto;
  pageId: string | null;
  signal: AbortSignal;
  resolve: (result: ThumbResult | null) => void;
  // El estado ya descargado, para no pedirlo otra vez si hay que repetir la miniatura.
  state?: Uint8Array;
};

// El renderer cambió o perdió el contexto mientras se pintaba: lo pintado no vale y el trabajo vuelve a la cola.
const RETRY = Symbol('retry');

// Miniaturas de la lista de versiones de un proyecto, pintadas de una en una con el renderer del editor. Las
// versiones no cambian, así que lo hecho se guarda (las 50 últimas usadas). Los fallos no se guardan: se reintentan
// al volver a abrir el panel.
export class VersionThumbnails {
  #projectId: () => string;
  #renderer: Renderer | null = null;
  #unsubscribeContext: (() => void) | null = null;
  // Cuenta las pérdidas del contexto WebGL del renderer actual.
  #losses = 0;
  #waiting: Array<() => void> = [];
  #cache = new Map<string, ThumbResult>();
  #queue: Job[] = [];
  #running = false;
  #warned = new Set<string>();
  #destroyed = false;

  constructor(projectId: () => string) {
    this.#projectId = projectId;
  }

  // El editor lo pone al montar su motor y lo quita al destruirlo. Los trabajos esperan a que haya uno con el
  // contexto WebGL en uso.
  setRenderer(renderer: Renderer | null): void {
    this.#unsubscribeContext?.();
    this.#unsubscribeContext = null;
    this.#renderer = renderer;
    if (!renderer) return;
    this.#unsubscribeContext = renderer.contextState.subscribe((state) => {
      if (state !== 'ok') this.#losses++;
      else this.#wake();
    });
  }

  cached(version: VersionDto, pageId: string | null): ThumbResult | null {
    if (version.sizeBytes > THUMB_MAX_BYTES) return { kind: 'large' };
    const key = cacheKey(version.id, pageId);
    const hit = this.#cache.get(key);
    if (!hit) return null;
    this.#cache.delete(key);
    this.#cache.set(key, hit);
    return hit;
  }

  // La imagen guardada ya no carga: se quita para volver a pintarla.
  forget(version: VersionDto, pageId: string | null): void {
    const key = cacheKey(version.id, pageId);
    const hit = this.#cache.get(key);
    if (!hit) return;
    this.#cache.delete(key);
    if (hit.kind === 'image') URL.revokeObjectURL(hit.url);
  }

  // null si se canceló antes de empezar.
  request(version: VersionDto, pageId: string | null, signal: AbortSignal): Promise<ThumbResult | null> {
    const hit = this.cached(version, pageId);
    if (hit) return Promise.resolve(hit);
    if (this.#destroyed || signal.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.#queue.push({ version, pageId, signal, resolve });
      void this.#pump();
    });
  }

  // Al salir del editor: se revocan las URL y lo pendiente se cancela.
  destroy(): void {
    this.#destroyed = true;
    for (const job of this.#queue) job.resolve(null);
    this.#queue = [];
    for (const result of this.#cache.values()) if (result.kind === 'image') URL.revokeObjectURL(result.url);
    this.#cache.clear();
    this.setRenderer(null);
    this.#wake();
  }

  async #pump(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (let job = this.#queue.shift(); job; job = this.#queue.shift()) {
        if (this.#destroyed || job.signal.aborted) {
          job.resolve(null);
          continue;
        }
        const hit = this.cached(job.version, job.pageId);
        if (hit) {
          job.resolve(hit);
          continue;
        }
        const result = await this.#render(job);
        if (result !== RETRY) job.resolve(result);
        else if (this.#destroyed || job.signal.aborted) job.resolve(null);
        else this.#queue.unshift(job);
      }
    } finally {
      this.#running = false;
    }
  }

  async #render(job: Job): Promise<ThumbResult | null | typeof RETRY> {
    const { version, pageId } = job;
    if (!job.state) {
      try {
        job.state = await fetchVersionState(this.#projectId(), version.id, job.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null;
        this.#warn(version.id, error instanceof ApiError ? error.status : error);
        return { kind: 'error' };
      }
    }
    const renderer = await this.#rendererReady();
    if (!renderer || this.#destroyed) return null;
    const losses = this.#losses;
    const stale = () => this.#renderer !== renderer || this.#losses !== losses || !renderer.usable;
    let result: ThumbResult;
    try {
      const { renderVersionThumbnail } = await import('../../../engine/export/thumbnail.ts');
      const blob = await renderVersionThumbnail(job.state, renderer, { ...THUMB_SIZE, pageId });
      if (this.#destroyed) return null;
      if (stale()) return RETRY;
      result = blob ? { kind: 'image', url: URL.createObjectURL(blob) } : { kind: 'empty' };
    } catch (error) {
      if (this.#destroyed) return null;
      if (stale()) return RETRY;
      this.#warn(version.id, error);
      return { kind: 'error' };
    }
    this.#store(cacheKey(version.id, pageId), result);
    return result;
  }

  async #rendererReady(): Promise<Renderer | null> {
    for (;;) {
      if (this.#destroyed) return null;
      const renderer = this.#renderer;
      if (renderer?.usable && renderer.contextState.get() === 'ok') return renderer;
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
  }

  #wake(): void {
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const wake of waiting) wake();
  }

  #store(key: string, result: ThumbResult): void {
    this.#cache.set(key, result);
    while (this.#cache.size > THUMB_CACHE_SIZE) {
      const [oldest, value] = this.#cache.entries().next().value!;
      this.#cache.delete(oldest);
      if (value.kind === 'image') URL.revokeObjectURL(value.url);
    }
  }

  // Un aviso por versión.
  #warn(id: string, detail: unknown): void {
    if (this.#warned.has(id)) return;
    this.#warned.add(id);
    console.warn('[versiones] miniatura', id, detail);
  }
}

function cacheKey(versionId: string, pageId: string | null): string {
  return `${versionId}:${pageId ?? ''}`;
}

export const [getVersionThumbnails, setVersionThumbnails] = createContext<VersionThumbnails>();
