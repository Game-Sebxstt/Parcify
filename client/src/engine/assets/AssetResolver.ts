export const ASSET_VARIANT_NAMES = ['thumb', 'medium', 'full'] as const;
export type AssetVariant = (typeof ASSET_VARIANT_NAMES)[number];

export type ResolvedUrl = { url: string; expiresAt: string };
// Pide al servidor las URLs firmadas de hasta 200 assets de una variante. Los ids sin acceso no vuelven.
export type ResolveBatch = (ids: string[], variant: AssetVariant) => Promise<Record<string, ResolvedUrl>>;

export const RESOLVE_BATCH_MAX = 200;
export const RESOLVE_DELAY_MS = 16;
// Una URL se deja de usar 5 minutos antes de que caduque.
export const URL_EXPIRY_MARGIN_MS = 5 * 60_000;
// Tras un error pasajero (red, 429, 5xx) el lote se repite a 1 s, 2 s, 4 s… hasta un máximo de 30 s entre intentos.
export const RESOLVE_RETRY_BASE_MS = 1000;
export const RESOLVE_RETRY_MAX_MS = 30_000;

type Waiter = (url: string | null) => void;

export type AssetResolverOptions = {
  // Si el error de un lote es pasajero y merece otro intento. Por defecto, todos.
  isTransient?: (error: unknown) => boolean;
};

// Resuelve assetId → URL firmada. Las peticiones de 16 ms se agrupan en lotes de 200 por variante; las URLs se
// guardan hasta 5 minutos antes de caducar. Un id sin URL no se guarda: puede estar procesándose todavía. Un lote
// que falla por un error pasajero se repite con espera creciente en vez de dar las imágenes por rotas.
export class AssetResolver {
  private readonly cache = new Map<string, { url: string; expires: number }>();
  private readonly queues = new Map<AssetVariant, Map<string, Waiter[]>>();
  private readonly isTransient: (error: unknown) => boolean;

  constructor(
    private readonly resolveBatch: ResolveBatch,
    options: AssetResolverOptions = {},
  ) {
    this.isTransient = options.isTransient ?? (() => true);
  }

  url(id: string, variant: AssetVariant): Promise<string | null> {
    const hit = this.cache.get(`${variant}:${id}`);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit.url);
    return new Promise((resolve) => {
      let queue = this.queues.get(variant);
      if (!queue) {
        this.queues.set(variant, (queue = new Map()));
        setTimeout(() => void this.flush(variant), RESOLVE_DELAY_MS);
      }
      queue.set(id, [...(queue.get(id) ?? []), resolve]);
    });
  }

  // La URL guardada ya no vale (el storage respondió 403, o el asset acaba de procesarse): se pedirá otra.
  invalidate(id: string, variant?: AssetVariant): void {
    for (const name of variant ? [variant] : ASSET_VARIANT_NAMES) this.cache.delete(`${name}:${id}`);
  }

  clear(): void {
    this.cache.clear();
  }

  private async flush(variant: AssetVariant): Promise<void> {
    const queue = this.queues.get(variant)!;
    this.queues.delete(variant);
    const ids = [...queue.keys()];
    for (let start = 0; start < ids.length; start += RESOLVE_BATCH_MAX) {
      const chunk = ids.slice(start, start + RESOLVE_BATCH_MAX);
      const assets = await this.resolveChunk(chunk, variant);
      for (const id of chunk) {
        const hit = assets[id];
        if (hit) this.cache.set(`${variant}:${id}`, { url: hit.url, expires: Date.parse(hit.expiresAt) - URL_EXPIRY_MARGIN_MS });
        for (const resolve of queue.get(id)!) resolve(hit?.url ?? null);
      }
    }
  }

  private async resolveChunk(ids: string[], variant: AssetVariant): Promise<Record<string, ResolvedUrl>> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.resolveBatch(ids, variant);
      } catch (error) {
        if (!this.isTransient(error)) return {};
        const delay = Math.min(RESOLVE_RETRY_MAX_MS, RESOLVE_RETRY_BASE_MS * 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
