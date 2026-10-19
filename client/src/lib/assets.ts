import {
  AssetSchema,
  CreateUploadResponseSchema,
  MAX_SMALL_UPLOAD_BYTES,
  ResolveAssetsResponseSchema,
  UPLOAD_CONTENT_TYPES,
  type AssetDto,
  type ASSET_VARIANTS,
} from '../shared/api/assets.js';
import { ApiError, apiFetch } from './api.ts';

export type AssetVariant = (typeof ASSET_VARIANTS)[number];

const BATCH_DELAY_MS = 16;
const MAX_BATCH = 200;
// Se renueva antes de caducar para no pintar una URL que el storage ya rechaza.
const EXPIRY_MARGIN_MS = 60_000;

type Waiter = (url: string | null) => void;

const urls = new Map<string, { url: string; expires: number }>();
const queues = new Map<AssetVariant, Map<string, Waiter[]>>();
const timers = new Map<AssetVariant, ReturnType<typeof setTimeout>>();

const key = (id: string, variant: AssetVariant) => `${variant}:${id}`;

async function flush(variant: AssetVariant) {
  timers.delete(variant);
  const queue = queues.get(variant);
  queues.delete(variant);
  if (!queue) return;
  const ids = [...queue.keys()];
  for (let start = 0; start < ids.length; start += MAX_BATCH) {
    const chunk = ids.slice(start, start + MAX_BATCH);
    let assets: Record<string, { url: string; expiresAt: string }>;
    try {
      ({ assets } = await apiFetch('/v1/assets/resolve', {
        method: 'POST',
        body: { ids: chunk, variant },
        schema: ResolveAssetsResponseSchema,
        redirectOn401: false,
      }));
    } catch {
      assets = {};
    }
    for (const id of chunk) {
      const hit = assets[id];
      if (hit) urls.set(key(id, variant), { url: hit.url, expires: Date.parse(hit.expiresAt) - EXPIRY_MARGIN_MS });
      for (const resolve of queue.get(id) ?? []) resolve(hit?.url ?? null);
    }
  }
}

// Las peticiones de un mismo frame se agrupan en una sola llamada a /v1/assets/resolve.
export function assetUrl(id: string, variant: AssetVariant = 'thumb'): Promise<string | null> {
  const hit = urls.get(key(id, variant));
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    let queue = queues.get(variant);
    if (!queue) queues.set(variant, (queue = new Map()));
    const waiters = queue.get(id) ?? [];
    waiters.push(resolve);
    queue.set(id, waiters);
    if (!timers.has(variant)) timers.set(variant, setTimeout(() => void flush(variant), BATCH_DELAY_MS));
  });
}

export function forgetAssetUrls() {
  urls.clear();
}

export type SmallUploadTarget = { purpose: 'avatar' } | { purpose: 'logo'; workspaceSlug: string };

const ACCEPTED = new Set<string>(UPLOAD_CONTENT_TYPES);

export const SMALL_IMAGE_ACCEPT = UPLOAD_CONTENT_TYPES.filter((type) => type !== 'image/svg+xml').join(',');

// Pide la subida, envía el archivo al storage y confirma; el servidor lo procesa al confirmar.
export async function uploadAsset(file: File, target: Record<string, string>): Promise<AssetDto> {
  const created = await apiFetch('/v1/assets/uploads', {
    method: 'POST',
    body: { ...target, fileName: file.name.slice(0, 120) || 'imagen', contentType: file.type, size: file.size },
    schema: CreateUploadResponseSchema,
  });
  let put: Response;
  try {
    put = await fetch(created.upload.url, { method: 'PUT', headers: created.upload.headers, body: file });
  } catch {
    throw new ApiError({ code: 'NETWORK', status: 0 });
  }
  if (!put.ok) throw new ApiError({ code: 'STORAGE_ERROR', status: put.status });
  return apiFetch(`/v1/assets/uploads/${created.assetId}/complete`, { method: 'POST', schema: AssetSchema });
}

export function checkUpload(file: File, maxBytes: number, svg: boolean): void {
  if (!ACCEPTED.has(file.type) || (!svg && file.type === 'image/svg+xml')) throw new ApiError({ code: 'UNSUPPORTED_FILE', status: 0 });
  if (file.size === 0 || file.size > maxBytes) throw new ApiError({ code: 'PAYLOAD_TOO_LARGE', status: 0 });
}

// Avatar o logo, sin SVG y con el tope de 2 MiB.
export async function uploadSmallImage(file: File, target: SmallUploadTarget): Promise<AssetDto> {
  checkUpload(file, MAX_SMALL_UPLOAD_BYTES, false);
  return uploadAsset(file, target);
}