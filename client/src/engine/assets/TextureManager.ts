import type { AssetVariant } from './AssetResolver.ts';

// Lado mayor de cada variante que genera el servidor; `full` llega hasta 4096 px.
export const VARIANT_SIDE: Record<AssetVariant, number> = { thumb: 256, medium: 1024, full: 4096 };
const ORDER: readonly AssetVariant[] = ['thumb', 'medium', 'full'];

export const MAX_CONCURRENT_LOADS = 6;
export const RELEASES_PER_FRAME = 5;
export const BUDGET_BYTES = 384 * 1024 * 1024;
export const LOW_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;
// RGBA más un tercio para los mipmaps.
export const BYTES_PER_PIXEL = 4 * 1.33;

// Lo mínimo que el gestor necesita de una textura cargada.
export interface LoadedTexture {
  readonly width: number;
  readonly height: number;
  destroy(): void;
}

// Error de la descarga con su estado HTTP (403 si la URL firmada caducó).
export class TextureLoadError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export type TextureSource<T extends LoadedTexture> = {
  // URL firmada de la variante, o null si el asset no existe o no se puede leer.
  url(assetId: string, variant: AssetVariant): Promise<string | null>;
  invalidateUrl(assetId: string, variant: AssetVariant): void;
  load(url: string, signal: AbortSignal): Promise<T>;
};

export type TextureManagerOptions<T extends LoadedTexture> = TextureSource<T> & {
  budgetBytes?: number;
  now?: () => number;
  // Cambió lo que hay que pintar para este asset (llegó una textura o falló).
  onChange?: (assetId: string) => void;
  // Quedan liberaciones o cargas pendientes: hace falta otro frame.
  onNeedsFrame?: () => void;
  // Texturas recién cargadas, para subirlas a la GPU antes de pintarlas.
  onLoaded?: (textures: T[]) => void;
};

export type TextureState<T> = { kind: 'ready'; texture: T; variant: AssetVariant } | { kind: 'loading' } | { kind: 'broken' };

type EntryState = 'idle' | 'loading' | 'ready' | 'failed' | 'missing';

type Entry<T> = {
  key: string;
  assetId: string;
  variant: AssetVariant;
  state: EntryState;
  texture: T | null;
  bytes: number;
  refs: Set<string>;
  lastUsed: number;
  controller: AbortController | null;
  retried: boolean;
};

type ViewUse = { assetId: string; wanted: AssetVariant; priority: number; screenPx: number; refs: Set<string>; cap: AssetVariant | null };

// Presupuesto según la memoria del equipo: 256 MB con 4 GB o menos.
export function defaultBudget(deviceMemory: number | undefined): number {
  return deviceMemory !== undefined && deviceMemory <= 4 ? LOW_MEMORY_BUDGET_BYTES : BUDGET_BYTES;
}

// La menor variante cuyo lado mayor cubre el tamaño en pantalla (ya multiplicado por la densidad).
export function chooseVariant(screenPx: number, cap: AssetVariant | null = null): AssetVariant {
  let choice: AssetVariant = 'full';
  for (const variant of ORDER) {
    if (VARIANT_SIDE[variant] >= screenPx) {
      choice = variant;
      break;
    }
  }
  if (cap && ORDER.indexOf(choice) > ORDER.indexOf(cap)) return cap;
  return choice;
}

export function textureBytes(width: number, height: number): number {
  return Math.ceil(width * height * BYTES_PER_PIXEL);
}

// Carga, comparte y libera las texturas de las imágenes. Cada vista visible referencia la variante que quiere y
// la que está pintando; 50 nodos con el mismo asset comparten una textura. Las texturas sin referencias quedan en
// una LRU y se liberan, de 5 en 5 por frame, cuando se supera el presupuesto.
export class TextureManager<T extends LoadedTexture> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly views = new Map<string, ViewUse>();
  private readonly options: TextureManagerOptions<T>;
  private readonly now: () => number;
  readonly budget: number;
  private totalBytes = 0;
  private loading = 0;
  private loadedBatch: T[] = [];
  private readonly prefetched = new Set<string>();
  private destroyed = false;
  // Contadores para el benchmark y las pruebas.
  readonly counters = { loads: 0, aborted: 0, released: 0, retried: 0, failed: 0 };

  constructor(options: TextureManagerOptions<T>) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.budget = options.budgetBytes ?? BUDGET_BYTES;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get pending(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.refs.size && (entry.state === 'idle' || entry.state === 'loading')) count++;
    return count;
  }

  private entry(assetId: string, variant: AssetVariant): Entry<T> {
    const key = `${assetId}:${variant}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, assetId, variant, state: 'idle', texture: null, bytes: 0, refs: new Set(), lastUsed: this.now(), controller: null, retried: false };
      this.entries.set(key, entry);
    }
    return entry;
  }

  // Una vista pinta `assetId` a `screenPx` píxeles de lado mayor. `priority`: menor = antes (distancia al centro).
  use(viewId: string, assetId: string, screenPx: number, priority: number): void {
    let view = this.views.get(viewId);
    if (view && view.assetId !== assetId) {
      this.release(viewId);
      view = undefined;
    }
    if (!view) {
      view = { assetId, wanted: 'thumb', priority, screenPx, refs: new Set(), cap: null };
      this.views.set(viewId, view);
    }
    view.priority = priority;
    view.screenPx = screenPx;
    // Con holgura de memoria, una vista que se bajó de variante vuelve a pedir la que le toca.
    if (view.cap && this.totalBytes < this.budget * 0.8) view.cap = null;
    view.wanted = chooseVariant(screenPx, view.cap);
    this.refresh(viewId, view);
    this.options.onNeedsFrame?.();
  }

  // Referencias de la vista: la variante que quiere, la que pinta mientras tanto y la miniatura si no hay nada.
  private refresh(viewId: string, view: ViewUse): void {
    const next = new Set<string>();
    const wanted = this.entry(view.assetId, view.wanted);
    next.add(wanted.key);
    if (wanted.state !== 'ready') {
      const shown = this.bestReady(view.assetId);
      if (shown) next.add(shown.key);
      else if (view.wanted !== 'thumb') {
        const thumb = this.entry(view.assetId, 'thumb');
        if (thumb.state !== 'failed' && thumb.state !== 'missing') next.add(thumb.key);
      }
    }
    for (const key of view.refs) if (!next.has(key)) this.unref(key, viewId);
    for (const key of next) {
      const entry = this.entries.get(key)!;
      entry.refs.add(viewId);
      entry.lastUsed = this.now();
    }
    view.refs = next;
  }

  private bestReady(assetId: string): Entry<T> | null {
    for (let i = ORDER.length - 1; i >= 0; i--) {
      const entry = this.entries.get(`${assetId}:${ORDER[i]}`);
      if (entry?.state === 'ready') return entry;
    }
    return null;
  }

  private unref(key: string, viewId: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs.delete(viewId);
    if (entry.refs.size) return;
    entry.lastUsed = this.now();
    // Una carga que ya nadie necesita se cancela.
    if (entry.state === 'loading' && entry.controller) {
      entry.controller.abort();
      this.counters.aborted++;
    } else if (entry.state === 'idle') {
      this.entries.delete(key);
      this.prefetched.delete(key);
    }
  }

  // La vista sale del viewport o desaparece: sus texturas pasan a la LRU.
  release(viewId: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.views.delete(viewId);
    for (const key of view.refs) this.unref(key, viewId);
  }

  // Qué pintar ahora en la vista. Solo texturas que la vista referencia: las demás pueden liberarse en cualquier frame.
  stateFor(viewId: string): TextureState<T> {
    const view = this.views.get(viewId);
    if (!view) return { kind: 'loading' };
    const wanted = this.entries.get(`${view.assetId}:${view.wanted}`);
    if (wanted?.state === 'ready' && wanted.texture) return { kind: 'ready', texture: wanted.texture, variant: wanted.variant };
    for (let i = ORDER.length - 1; i >= 0; i--) {
      const key = `${view.assetId}:${ORDER[i]}`;
      if (!view.refs.has(key)) continue;
      const shown = this.entries.get(key);
      if (shown?.state === 'ready' && shown.texture) return { kind: 'ready', texture: shown.texture, variant: shown.variant };
    }
    const thumb = this.entries.get(`${view.assetId}:thumb`);
    const dead = (entry: Entry<T> | undefined) => entry?.state === 'failed' || entry?.state === 'missing';
    if (dead(wanted) && (view.wanted === 'thumb' || dead(thumb) || !thumb)) return { kind: 'broken' };
    return { kind: 'loading' };
  }

  // Trabajo por frame: arranca cargas (seis a la vez, por prioridad) y libera hasta cinco texturas si sobra memoria.
  frame(): void {
    if (this.destroyed) return;
    this.startLoads();
    const more = this.evict();
    if (more) this.options.onNeedsFrame?.();
  }

  private priorityOf(entry: Entry<T>): number {
    let best = Infinity;
    for (const viewId of entry.refs) {
      const view = this.views.get(viewId);
      if (view && view.priority < best) best = view.priority;
    }
    // La miniatura va antes que una variante mejor del mismo asset.
    return entry.variant === 'thumb' ? best - 1e9 : best;
  }

  private startLoads(): void {
    if (this.loading >= MAX_CONCURRENT_LOADS) return;
    const waiting: Entry<T>[] = [];
    for (const entry of this.entries.values()) if (entry.state === 'idle' && entry.refs.size) waiting.push(entry);
    if (!waiting.length) return;
    // Las URLs de todo lo que espera se piden ya, en un mismo lote: cuando le toque cargar, estará resuelta.
    for (const entry of waiting) {
      if (this.prefetched.has(entry.key)) continue;
      this.prefetched.add(entry.key);
      void this.options.url(entry.assetId, entry.variant).catch(() => null);
    }
    waiting.sort((a, b) => this.priorityOf(a) - this.priorityOf(b));
    for (const entry of waiting) {
      if (this.loading >= MAX_CONCURRENT_LOADS) break;
      void this.load(entry);
    }
  }

  private async load(entry: Entry<T>): Promise<void> {
    entry.state = 'loading';
    this.prefetched.delete(entry.key);
    const controller = new AbortController();
    entry.controller = controller;
    this.loading++;
    this.counters.loads++;
    let texture: T | null = null;
    let failure: 'failed' | 'missing' | 'aborted' | 'retry' | null = null;
    try {
      const url = await this.options.url(entry.assetId, entry.variant);
      if (controller.signal.aborted) failure = 'aborted';
      else if (!url) failure = 'missing';
      else texture = await this.options.load(url, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) failure = 'aborted';
      else if (error instanceof TextureLoadError && error.status === 403 && !entry.retried) failure = 'retry';
      else failure = 'failed';
    }
    this.loading--;
    entry.controller = null;
    if (this.destroyed || this.entries.get(entry.key) !== entry) {
      texture?.destroy();
      return;
    }
    if (texture && controller.signal.aborted) {
      texture.destroy();
      failure = 'aborted';
    }
    if (failure === 'aborted') {
      entry.state = 'idle';
      if (!entry.refs.size) this.entries.delete(entry.key);
    } else if (failure === 'retry') {
      // La URL firmada caducó: se pide otra una sola vez.
      entry.retried = true;
      entry.state = 'idle';
      this.counters.retried++;
      this.options.invalidateUrl(entry.assetId, entry.variant);
    } else if (failure) {
      entry.state = failure;
      this.counters.failed++;
      this.options.onChange?.(entry.assetId);
    } else if (texture) {
      entry.state = 'ready';
      entry.texture = texture;
      entry.bytes = textureBytes(texture.width, texture.height);
      entry.lastUsed = this.now();
      this.totalBytes += entry.bytes;
      this.loadedBatch.push(texture);
      // Las vistas que pintaban otra variante sueltan la que ya no necesitan.
      for (const viewId of [...entry.refs]) {
        const view = this.views.get(viewId);
        if (view) this.refresh(viewId, view);
      }
      this.options.onChange?.(entry.assetId);
    }
    if (this.loading === 0 || this.loadedBatch.length >= MAX_CONCURRENT_LOADS) this.flushLoaded();
    // El hueco que queda libre se ocupa ya, sin esperar al frame siguiente.
    this.startLoads();
    this.options.onNeedsFrame?.();
  }

  private flushLoaded(): void {
    if (!this.loadedBatch.length) return;
    const batch = this.loadedBatch;
    this.loadedBatch = [];
    this.options.onLoaded?.(batch);
  }

  // Devuelve si queda trabajo para el frame siguiente.
  private evict(): boolean {
    if (this.totalBytes <= this.budget) return false;
    const free: Entry<T>[] = [];
    for (const entry of this.entries.values()) if (entry.state === 'ready' && entry.refs.size === 0) free.push(entry);
    free.sort((a, b) => a.lastUsed - b.lastUsed);
    let released = 0;
    for (const entry of free) {
      if (this.totalBytes <= this.budget || released >= RELEASES_PER_FRAME) break;
      this.destroyEntry(entry);
      released++;
    }
    if (this.totalBytes <= this.budget) return false;
    if (released < free.length) return true;
    // Nada más que liberar: las imágenes visibles más pequeñas en pantalla bajan de variante.
    return this.downgrade();
  }

  // Baja de variante las vistas justas para caber, de la más pequeña en pantalla a la más grande. Mientras la
  // variante menor de una bajada anterior siga en camino, se espera: la memoria se libera cuando llegue. Si falló,
  // no hay nada que esperar.
  private downgrade(): boolean {
    for (const view of this.views.values()) {
      if (!view.cap) continue;
      const state = this.entries.get(`${view.assetId}:${view.wanted}`)?.state;
      if (state === 'idle' || state === 'loading') return true;
    }
    const candidates = [...this.views.entries()].filter(([, view]) => view.wanted !== 'thumb').sort((a, b) => a[1].screenPx - b[1].screenPx);
    let excess = this.totalBytes - this.budget;
    let count = 0;
    for (const [viewId, view] of candidates) {
      if (excess <= 0 || count >= RELEASES_PER_FRAME) break;
      const current = this.entries.get(`${view.assetId}:${view.wanted}`);
      // Solo cuenta lo que deja de usar esta vista; una textura compartida con otras vistas no se libera.
      if (current && current.refs.size <= 1) excess -= current.bytes;
      view.cap = ORDER[ORDER.indexOf(view.wanted) - 1]!;
      view.wanted = view.cap;
      this.refresh(viewId, view);
      this.options.onChange?.(view.assetId);
      count++;
    }
    return count > 0;
  }

  private destroyEntry(entry: Entry<T>): void {
    entry.texture?.destroy();
    this.totalBytes -= entry.bytes;
    this.entries.delete(entry.key);
    this.counters.released++;
    this.options.onChange?.(entry.assetId);
  }

  // El asset ya se puede leer (asset.ready): lo que falló se vuelve a intentar.
  retryAsset(assetId: string): void {
    let changed = false;
    for (const entry of this.entries.values()) {
      if (entry.assetId !== assetId || (entry.state !== 'failed' && entry.state !== 'missing')) continue;
      entry.state = 'idle';
      entry.retried = false;
      changed = true;
    }
    for (const [viewId, view] of this.views) if (view.assetId === assetId) this.refresh(viewId, view);
    if (changed) {
      this.options.onChange?.(assetId);
      this.options.onNeedsFrame?.();
    }
  }

  // El asset se borró: se sueltan sus texturas y sus vistas pintan el marcador de imagen rota. Las entradas nuevas
  // nacen como «no existe», así que ni una carga en curso ni la vista vuelven a pedirlo.
  dropAsset(assetId: string): void {
    let changed = false;
    for (const entry of [...this.entries.values()]) {
      if (entry.assetId !== assetId) continue;
      changed = true;
      entry.controller?.abort();
      entry.controller = null;
      entry.texture?.destroy();
      this.totalBytes -= entry.bytes;
      this.prefetched.delete(entry.key);
      this.entries.delete(entry.key);
    }
    for (const [viewId, view] of this.views) {
      if (view.assetId !== assetId) continue;
      changed = true;
      for (const variant of new Set<AssetVariant>([view.wanted, 'thumb'])) {
        const entry = this.entry(assetId, variant);
        entry.state = 'missing';
        entry.retried = true;
      }
      this.refresh(viewId, view);
    }
    if (changed) {
      this.options.onChange?.(assetId);
      this.options.onNeedsFrame?.();
    }
  }

  // Tras perder el contexto de la GPU: se descartan todas las texturas y se vuelven a cargar las que se ven.
  invalidateAll(): void {
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
      entry.texture?.destroy();
    }
    this.entries.clear();
    this.totalBytes = 0;
    this.loadedBatch = [];
    for (const [viewId, view] of this.views) {
      view.refs = new Set();
      view.cap = null;
      view.wanted = chooseVariant(view.screenPx);
      this.refresh(viewId, view);
    }
    for (const view of this.views.values()) this.options.onChange?.(view.assetId);
    this.options.onNeedsFrame?.();
  }

  destroy(): void {
    this.destroyed = true;
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
      entry.texture?.destroy();
    }
    this.entries.clear();
    this.views.clear();
    this.totalBytes = 0;
  }
}
