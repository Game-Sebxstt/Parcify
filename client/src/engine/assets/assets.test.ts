import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetResolver, RESOLVE_BATCH_MAX, RESOLVE_DELAY_MS, RESOLVE_RETRY_BASE_MS, URL_EXPIRY_MARGIN_MS } from './AssetResolver.ts';
import {
  chooseVariant,
  defaultBudget,
  LOW_MEMORY_BUDGET_BYTES,
  BUDGET_BYTES,
  MAX_CONCURRENT_LOADS,
  RELEASES_PER_FRAME,
  TextureLoadError,
  TextureManager,
  textureBytes,
  type LoadedTexture,
} from './TextureManager.ts';

class FakeTexture implements LoadedTexture {
  destroyed = false;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly url: string,
  ) {}
  destroy(): void {
    this.destroyed = true;
  }
}

const SIDES: Record<string, [number, number]> = { thumb: [256, 192], medium: [1024, 768], full: [1600, 1200] };

// Cargas controladas a mano: cada una se resuelve o falla cuando el test lo decide.
function harness(options: { budgetBytes?: number; urls?: (assetId: string, variant: string) => string | null; onNeedsFrame?: () => void } = {}) {
  const pending = new Map<string, { resolve: (t: FakeTexture) => void; reject: (e: unknown) => void; signal: AbortSignal }>();
  const invalidated: string[] = [];
  const changes: string[] = [];
  let clock = 0;
  const manager = new TextureManager<FakeTexture>({
    url: async (assetId, variant) => (options.urls ? options.urls(assetId, variant) : `${assetId}/${variant}`),
    invalidateUrl: (assetId, variant) => invalidated.push(`${assetId}/${variant}`),
    load: (url, signal) =>
      new Promise<FakeTexture>((resolve, reject) => {
        pending.set(url, { resolve, reject, signal });
        signal.addEventListener('abort', () => reject(new DOMException('abortado', 'AbortError')));
      }),
    budgetBytes: options.budgetBytes ?? BUDGET_BYTES,
    now: () => clock,
    onChange: (assetId) => changes.push(assetId),
    ...(options.onNeedsFrame ? { onNeedsFrame: options.onNeedsFrame } : {}),
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const finish = async (url: string) => {
    await flush();
    const load = pending.get(url);
    if (!load) throw new Error(`sin carga para ${url}`);
    pending.delete(url);
    const variant = url.split('/')[1]!;
    const [w, h] = SIDES[variant] ?? [100, 100];
    load.resolve(new FakeTexture(w, h, url));
    await flush();
  };
  const fail = async (url: string, error: unknown) => {
    await flush();
    const load = pending.get(url)!;
    pending.delete(url);
    load.reject(error);
    await flush();
  };
  return { manager, pending, invalidated, changes, finish, fail, flush, tick: (ms: number) => (clock += ms) };
}

describe('nivel de detalle', () => {
  it('elige la menor variante que cubre el tamaño en pantalla', () => {
    expect(chooseVariant(40)).toBe('thumb');
    expect(chooseVariant(256)).toBe('thumb');
    expect(chooseVariant(257)).toBe('medium');
    expect(chooseVariant(1024)).toBe('medium');
    expect(chooseVariant(1500)).toBe('full');
    expect(chooseVariant(9000)).toBe('full');
    expect(chooseVariant(1500, 'medium')).toBe('medium');
  });

  it('presupuesto de 384 MB, o 256 MB con 4 GB de memoria o menos', () => {
    expect(defaultBudget(undefined)).toBe(BUDGET_BYTES);
    expect(defaultBudget(8)).toBe(384 * 1024 * 1024);
    expect(defaultBudget(4)).toBe(LOW_MEMORY_BUDGET_BYTES);
    expect(textureBytes(1000, 1000)).toBe(5_320_000);
  });
});

describe('TextureManager', () => {
  it('pinta la miniatura mientras llega la variante buena y después suelta la miniatura', async () => {
    const h = harness();
    h.manager.use('v1', 'a', 900, 0);
    h.manager.frame();
    await h.flush();
    expect([...h.pending.keys()].sort()).toEqual(['a/medium', 'a/thumb']);
    expect(h.manager.stateFor('v1').kind).toBe('loading');
    await h.finish('a/thumb');
    expect(h.manager.stateFor('v1')).toMatchObject({ kind: 'ready', variant: 'thumb' });
    await h.finish('a/medium');
    expect(h.manager.stateFor('v1')).toMatchObject({ kind: 'ready', variant: 'medium' });
    expect(h.changes).toEqual(['a', 'a']);
  });

  it('50 vistas del mismo asset comparten una sola textura', async () => {
    const h = harness();
    for (let i = 0; i < 50; i++) h.manager.use(`v${i}`, 'a', 100, i);
    h.manager.frame();
    await h.flush();
    expect([...h.pending.keys()]).toEqual(['a/thumb']);
    await h.finish('a/thumb');
    const textures = new Set(Array.from({ length: 50 }, (_, i) => (h.manager.stateFor(`v${i}`) as { texture: FakeTexture }).texture));
    expect(textures.size).toBe(1);
    expect(h.manager.counters.loads).toBe(1);
  });

  it('seis cargas a la vez, por prioridad, y la que sale antes de empezar no se pide', async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) h.manager.use(`v${i}`, `asset${i}`, 100, 10 - i);
    h.manager.release('v9');
    h.manager.frame();
    await h.flush();
    expect(h.pending.size).toBe(MAX_CONCURRENT_LOADS);
    // Prioridad: menor distancia al centro primero (v9 se fue; luego v8, v7…).
    expect([...h.pending.keys()].sort()).toEqual(['asset3/thumb', 'asset4/thumb', 'asset5/thumb', 'asset6/thumb', 'asset7/thumb', 'asset8/thumb']);
  });

  it('una carga cuya vista sale del viewport se cancela con AbortController', async () => {
    const h = harness();
    h.manager.use('v1', 'a', 100, 0);
    h.manager.frame();
    await h.flush();
    const load = h.pending.get('a/thumb')!;
    h.manager.release('v1');
    expect(load.signal.aborted).toBe(true);
    await h.flush();
    expect(h.manager.counters.aborted).toBe(1);
    expect(h.manager.bytes).toBe(0);
  });

  it('LRU: sin referencias quedan en memoria hasta pasar el presupuesto y se liberan de 5 en 5 por frame', async () => {
    const thumb = textureBytes(256, 192);
    const h = harness({ budgetBytes: thumb * 4 });
    for (let i = 0; i < 12; i++) {
      h.manager.use(`v${i}`, `asset${i}`, 100, i);
      h.manager.frame();
      await h.finish(`asset${i}/thumb`);
      h.tick(10);
    }
    expect(h.manager.bytes).toBe(thumb * 12);
    for (let i = 0; i < 12; i++) h.manager.release(`v${i}`);
    h.manager.frame();
    expect(h.manager.counters.released).toBe(RELEASES_PER_FRAME);
    h.manager.frame();
    expect(h.manager.bytes).toBe(thumb * 4);
    h.manager.frame();
    // Ya cabe: las cuatro más recientes siguen en la LRU por si vuelven.
    expect(h.manager.bytes).toBe(thumb * 4);
    expect(h.manager.counters.released).toBe(8);
    h.manager.use('v11', 'asset11', 100, 0);
    expect(h.manager.stateFor('v11').kind).toBe('ready');
    h.manager.use('v0', 'asset0', 100, 0);
    expect(h.manager.stateFor('v0').kind).toBe('loading');
  });

  it('sin nada que liberar baja de variante a las imágenes visibles más pequeñas', async () => {
    const medium = textureBytes(1024, 768);
    const h = harness({ budgetBytes: medium * 1.5 });
    h.manager.use('small', 'a', 600, 0);
    h.manager.use('big', 'b', 1000, 1);
    h.manager.frame();
    for (const url of ['a/thumb', 'b/thumb', 'a/medium', 'b/medium']) await h.finish(url);
    // Se liberan las miniaturas sin uso; aun así no cabe y la imagen más pequeña baja a la miniatura.
    h.manager.frame();
    expect(h.manager.stateFor('small')).toMatchObject({ kind: 'ready', variant: 'medium' });
    h.manager.frame();
    await h.finish('a/thumb');
    expect(h.manager.stateFor('small')).toMatchObject({ kind: 'ready', variant: 'thumb' });
    h.manager.frame();
    expect(h.manager.bytes).toBeLessThanOrEqual(medium * 1.5);
    expect(h.manager.stateFor('big')).toMatchObject({ kind: 'ready', variant: 'medium' });
  });

  it('dos vistas del mismo asset: una no pinta la variante que solo referencia la otra, y la LRU no la deja sin textura', async () => {
    const full = textureBytes(1600, 1200);
    const h = harness({ budgetBytes: full });
    h.manager.use('a', 'x', 900, 0);
    h.manager.use('c', 'x', 2000, 1);
    h.manager.frame();
    await h.finish('x/thumb');
    await h.finish('x/full');
    // A sigue esperando su `medium` y pinta la miniatura, que es lo que referencia.
    expect(h.manager.stateFor('a')).toMatchObject({ kind: 'ready', variant: 'thumb' });
    expect(h.manager.stateFor('c')).toMatchObject({ kind: 'ready', variant: 'full' });
    const changes = h.changes.length;
    h.manager.release('c');
    h.manager.frame();
    // `full` se queda sin referencias, se libera por el presupuesto y se avisa.
    expect(h.manager.counters.released).toBe(1);
    expect(h.changes.length).toBeGreaterThan(changes);
    const shown = h.manager.stateFor('a') as { kind: string; texture: FakeTexture };
    expect(shown.kind).toBe('ready');
    expect(shown.texture.destroyed).toBe(false);
  });

  it('si la variante menor de una bajada falla, no se queda esperándola cada frame', async () => {
    const medium = textureBytes(1024, 768);
    const needs: number[] = [];
    let thumbUrl = true;
    const h = harness({
      budgetBytes: medium * 0.5,
      urls: (assetId, variant) => (variant === 'thumb' && !thumbUrl ? null : `${assetId}/${variant}`),
      onNeedsFrame: () => needs.push(1),
    });
    h.manager.use('v', 'a', 600, 0);
    h.manager.frame();
    await h.finish('a/thumb');
    await h.finish('a/medium');
    thumbUrl = false;
    // La miniatura liberada no cabe con la media: baja a la miniatura, que ya no tiene URL.
    for (let i = 0; i < 3; i++) {
      h.manager.frame();
      await h.flush();
      await h.flush();
    }
    needs.length = 0;
    h.manager.frame();
    h.manager.frame();
    expect(needs).toEqual([]);
    expect(h.manager.stateFor('v')).toMatchObject({ kind: 'ready', variant: 'medium' });
  });

  it('con 403 pide otra URL una sola vez; si vuelve a fallar, marcador de imagen rota', async () => {
    const h = harness();
    h.manager.use('v1', 'a', 100, 0);
    h.manager.frame();
    await h.fail('a/thumb', new TextureLoadError(403));
    expect(h.invalidated).toEqual(['a/thumb']);
    h.manager.frame();
    await h.fail('a/thumb', new TextureLoadError(403));
    expect(h.manager.counters.retried).toBe(1);
    expect(h.manager.stateFor('v1').kind).toBe('broken');
    // asset.ready: se intenta de nuevo.
    h.manager.retryAsset('a');
    h.manager.frame();
    await h.finish('a/thumb');
    expect(h.manager.stateFor('v1').kind).toBe('ready');
  });

  it('un asset sin URL (sin acceso o borrado) se pinta como imagen rota', async () => {
    const h = harness({ urls: () => null });
    h.manager.use('v1', 'a', 100, 0);
    h.manager.frame();
    await h.flush();
    await h.flush();
    expect(h.manager.stateFor('v1').kind).toBe('broken');
  });

  it('un asset borrado suelta sus texturas, cancela lo que cargaba y sus vistas pasan a imagen rota', async () => {
    const h = harness();
    h.manager.use('v1', 'a', 100, 0);
    h.manager.use('v2', 'a', 900, 1);
    h.manager.use('v3', 'b', 100, 2);
    h.manager.frame();
    await h.finish('a/thumb');
    await h.finish('b/thumb');
    const medium = h.pending.get('a/medium')!;
    const shown = h.manager.stateFor('v1') as { texture: FakeTexture };
    h.manager.dropAsset('a');
    expect(shown.texture.destroyed).toBe(true);
    expect(medium.signal.aborted).toBe(true);
    h.pending.delete('a/medium');
    expect(h.manager.stateFor('v1').kind).toBe('broken');
    expect(h.manager.stateFor('v2').kind).toBe('broken');
    expect(h.manager.stateFor('v3').kind).toBe('ready');
    h.manager.frame();
    await h.flush();
    // Nada vuelve a pedirse.
    expect([...h.pending.keys()]).toEqual([]);
    expect(h.manager.stateFor('v2').kind).toBe('broken');
    expect(h.manager.bytes).toBe(textureBytes(256, 192));
  });

  it('al perder el contexto descarta todas las texturas y vuelve a cargar las que se ven', async () => {
    const h = harness();
    h.manager.use('v1', 'a', 100, 0);
    h.manager.frame();
    await h.finish('a/thumb');
    const before = h.manager.stateFor('v1') as { texture: FakeTexture };
    h.manager.invalidateAll();
    expect(before.texture.destroyed).toBe(true);
    expect(h.manager.bytes).toBe(0);
    h.manager.frame();
    await h.finish('a/thumb');
    expect(h.manager.stateFor('v1').kind).toBe('ready');
  });
});

describe('AssetResolver', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('agrupa las peticiones de 16 ms en lotes de 200 por variante', async () => {
    const calls: Array<{ ids: string[]; variant: string }> = [];
    const resolver = new AssetResolver(async (ids, variant) => {
      calls.push({ ids, variant });
      return Object.fromEntries(ids.map((id) => [id, { url: `https://s/${variant}/${id}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }]));
    });
    const thumbs = Array.from({ length: 450 }, (_, i) => resolver.url(`id${i}`, 'thumb'));
    const medium = resolver.url('id0', 'medium');
    await vi.advanceTimersByTimeAsync(15);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((call) => `${call.variant}:${call.ids.length}`).sort()).toEqual(['medium:1', `thumb:${RESOLVE_BATCH_MAX}`, `thumb:${RESOLVE_BATCH_MAX}`, 'thumb:50']);
    expect(await thumbs[449]).toBe('https://s/thumb/id449');
    expect(await medium).toBe('https://s/medium/id0');
  });

  it('un error pasajero repite el lote con espera creciente; uno definitivo deja los ids sin URL', async () => {
    let failures = 2;
    const resolve = vi.fn(async (ids: string[]) => {
      if (ids.includes('denied')) throw new Error('definitivo');
      if (failures-- > 0) throw new Error('sin red');
      return Object.fromEntries(ids.map((id) => [id, { url: `u-${id}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }]));
    });
    const resolver = new AssetResolver(resolve, { isTransient: (error) => error instanceof Error && error.message === 'sin red' });
    const url = resolver.url('a', 'thumb');
    await vi.advanceTimersByTimeAsync(RESOLVE_DELAY_MS);
    expect(resolve).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RESOLVE_RETRY_BASE_MS);
    expect(resolve).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RESOLVE_RETRY_BASE_MS * 2 - 1);
    expect(resolve).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await url).toBe('u-a');
    const denied = resolver.url('denied', 'medium');
    await vi.advanceTimersByTimeAsync(RESOLVE_DELAY_MS);
    expect(await denied).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(4);
  });

  it('guarda la URL hasta 5 minutos antes de que caduque y no guarda los ids sin URL', async () => {
    const resolve = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.filter((id) => id !== 'nope').map((id) => [id, { url: `u-${id}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }])),
    );
    const resolver = new AssetResolver(resolve);
    const first = resolver.url('a', 'thumb');
    const missing = resolver.url('nope', 'thumb');
    await vi.advanceTimersByTimeAsync(16);
    expect(await first).toBe('u-a');
    expect(await missing).toBeNull();
    expect(await resolver.url('a', 'thumb')).toBe('u-a');
    expect(resolve).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 10 * 60_000 - URL_EXPIRY_MARGIN_MS + 1);
    const renewed = resolver.url('a', 'thumb');
    await vi.advanceTimersByTimeAsync(16);
    expect(await renewed).toBe('u-a');
    expect(resolve).toHaveBeenCalledTimes(2);
    resolver.invalidate('a');
    const again = resolver.url('a', 'thumb');
    await vi.advanceTimersByTimeAsync(16);
    await again;
    expect(resolve).toHaveBeenCalledTimes(3);
  });
});