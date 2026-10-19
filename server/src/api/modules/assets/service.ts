import { Transform, type Readable } from 'node:stream';
import { z } from 'zod';
import type { Db } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { publishProjectEvent } from '../../../core/events.js';
import { sha256Hex, uuidv7 } from '../../../core/ids.js';
import type { Semaphore } from '../../../core/images/semaphore.js';
import {
  detectImageType,
  extensionOf,
  IMAGE_LIMITS,
  processImage,
  ProcessingTimeoutError,
  UnsupportedImageError,
  type EncodedImage,
} from '../../../core/images/process.js';
import type { LogSink } from '../../../core/logger.js';
import { requireProject, requireWorkspace } from '../../../core/permissions.js';
import type { Redis } from '../../../core/redis.js';
import {
  assetKey,
  copyObject,
  isLocalStorage,
  mimeForKey,
  parseKey,
  readAll,
  type StorageDriver,
} from '../../../core/storage/index.js';
import {
  ASSET_VARIANTS,
  AssetVariantSchema,
  MAX_UPLOAD_BYTES,
  type AssetDto,
  type AssetListQuerySchema,
  type CopyAssetsBodySchema,
  type CreateUploadBody,
  type ResolveAssetsBodySchema,
  type UpdateAssetBodySchema,
} from '../../../shared/api/assets.js';
import type { Actor } from '../../types.js';
import { loadVisibleAssets, type AssetRow } from './access.js';

export const UPLOAD_URL_TTL_SECONDS = 600;
export const DOWNLOAD_URL_TTL_SECONDS = 3600;

export interface AssetDeps {
  db: Db;
  redis: Redis;
  storage: StorageDriver;
  semaphore: Semaphore;
  logger: LogSink;
  processingTimeoutMs?: number;
}

type Variant = (typeof ASSET_VARIANTS)[number];
type StoredVariants = Partial<Record<Variant, z.infer<typeof AssetVariantSchema>>>;

const StoredVariantsSchema = z.partialRecord(z.enum(ASSET_VARIANTS), AssetVariantSchema);

export function storedVariants(value: unknown): StoredVariants {
  const parsed = StoredVariantsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

type AssetRecord = Pick<
  AssetRow,
  'id' | 'source' | 'mime' | 'sizeBytes' | 'width' | 'height' | 'name' | 'inGallery' | 'createdAt' | 'variants'
> & { status: 'pending' | 'ready' | 'failed' };

export function toAssetDto(asset: AssetRecord): AssetDto {
  const variants: AssetDto['variants'] = {};
  for (const [name, variant] of Object.entries(storedVariants(asset.variants)) as Array<[Variant, { w: number; h: number }]>) {
    variants[name] = { w: variant.w, h: variant.h };
  }
  return {
    id: asset.id,
    source: asset.source,
    status: asset.status,
    mime: asset.mime,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    name: asset.name,
    inGallery: asset.inGallery,
    variants,
    createdAt: asset.createdAt.toISOString(),
  };
}

async function publishAssetReady(deps: AssetDeps, projectId: string, assetId: string) {
  try {
    await publishProjectEvent(deps.redis, projectId, { type: 'asset.ready', assetId });
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message }, projectId }, 'No se pudo publicar asset.ready');
  }
}

async function deleteObjects(deps: AssetDeps, keys: string[]) {
  if (keys.length === 0) return;
  try {
    await deps.storage.delete(keys);
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message } }, 'No se pudieron borrar objetos del storage');
  }
}

export async function createUpload(deps: AssetDeps, actor: Actor, body: CreateUploadBody) {
  let organizationId: string | null = null;
  let projectId: string | null = null;
  let source: 'upload' | 'preview' | 'avatar' | 'logo' = 'upload';
  let inGallery = false;

  switch (body.purpose) {
    case 'canvas':
    case 'gallery':
    case 'preview': {
      const access = await requireProject(deps.db, actor.userId, body.projectId, 'asset:upload');
      projectId = access.project.id;
      organizationId = access.project.organizationId;
      source = body.purpose === 'preview' ? 'preview' : 'upload';
      inGallery = body.purpose === 'gallery';
      break;
    }
    case 'chat': {
      const access = await requireProject(deps.db, actor.userId, body.projectId, 'chat:write');
      projectId = access.project.id;
      organizationId = access.project.organizationId;
      break;
    }
    case 'avatar':
      source = 'avatar';
      break;
    case 'logo': {
      const access = await requireWorkspace(deps.db, actor.userId, body.workspaceSlug, { minRole: 'admin' });
      organizationId = access.workspace.id;
      source = 'logo';
      break;
    }
  }

  const id = uuidv7();
  const scope = source === 'avatar' ? `u-${actor.userId}` : organizationId!;
  const storageKey = assetKey(scope, id, 'original', extensionOf(body.contentType));
  await deps.db.asset.create({
    data: {
      id,
      organizationId,
      projectId,
      ownerId: actor.userId,
      source,
      status: 'pending',
      storageKey,
      mime: body.contentType,
      sizeBytes: body.size,
      name: body.fileName,
      inGallery,
    },
  });
  const upload = await deps.storage.createUploadTarget(storageKey, {
    contentType: body.contentType,
    contentLength: body.size,
    expiresIn: UPLOAD_URL_TTL_SECONDS,
  });
  return { assetId: id, upload };
}

// Corta el flujo en cuanto pasa del tamaño declarado.
function byteLimit(max: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > max) callback(new AppError('PAYLOAD_TOO_LARGE'));
      else callback(null, chunk);
    },
  });
}

export async function receiveUploadContent(
  deps: AssetDeps,
  assetId: string,
  query: { exp?: unknown; sig?: unknown },
  declaredLength: number | undefined,
  body: Readable,
): Promise<void> {
  const storage = deps.storage;
  if (!isLocalStorage(storage)) throw new AppError('NOT_FOUND');
  const asset = await deps.db.asset.findUnique({
    where: { id: assetId },
    select: { storageKey: true, sizeBytes: true, status: true },
  });
  if (!asset || asset.status !== 'pending') throw new AppError('NOT_FOUND');
  if (!storage.verify('PUT', asset.storageKey, query)) throw new AppError('FORBIDDEN');
  if (declaredLength !== undefined && declaredLength > asset.sizeBytes) throw new AppError('PAYLOAD_TOO_LARGE');
  await storage.put(asset.storageKey, body.pipe(byteLimit(asset.sizeBytes)), {
    contentType: mimeForKey(asset.storageKey),
  });
}

async function markFailed(deps: AssetDeps, assetId: string, keys: string[]) {
  await deleteObjects(deps, keys);
  await deps.db.asset.update({ where: { id: assetId }, data: { status: 'failed' } });
}

export async function completeUpload(deps: AssetDeps, actor: Actor, assetId: string): Promise<AssetDto> {
  const asset = await deps.db.asset.findFirst({ where: { id: assetId, ownerId: actor.userId, deletedAt: null } });
  if (!asset) throw new AppError('ASSET_NOT_FOUND');
  if (asset.status === 'ready') return toAssetDto(asset);
  if (asset.status === 'failed') throw new AppError('UNSUPPORTED_FILE');

  const head = await deps.storage.head(asset.storageKey);
  if (!head) throw new AppError('VALIDATION_FAILED', { details: { reason: 'not_uploaded' } });
  if (head.size !== asset.sizeBytes) {
    await markFailed(deps, asset.id, [asset.storageKey]);
    throw new AppError('VALIDATION_FAILED', { details: { reason: 'size_mismatch' } });
  }

  const sniff = await readAll(
    await deps.storage.getStream(asset.storageKey, { start: 0, end: Math.min(head.size, IMAGE_LIMITS.sniffBytes) - 1 }),
  );
  const mime = await detectImageType(sniff);
  if (!mime) {
    await markFailed(deps, asset.id, [asset.storageKey]);
    throw new AppError('UNSUPPORTED_FILE');
  }

  // El original solo se carga en memoria con un hueco del semáforo, y un duplicado se
  // detecta por su hash antes de pagar el procesado.
  const outcome = await deps.semaphore.run(async () => {
    const input = await readAll(await deps.storage.getStream(asset.storageKey), asset.sizeBytes);
    if (asset.projectId) {
      const existing = await deps.db.asset.findFirst({
        where: {
          projectId: asset.projectId,
          source: asset.source,
          sha256: sha256Hex(input),
          status: 'ready',
          deletedAt: null,
          id: { not: asset.id },
        },
      });
      if (existing) return { kind: 'duplicate', existing } as const;
    }
    try {
      return { kind: 'processed', processed: await processImage(input, mime, deps.processingTimeoutMs) } as const;
    } catch (error) {
      return { kind: 'failed', error } as const;
    }
  });

  if (outcome.kind === 'duplicate') {
    await deleteObjects(deps, [asset.storageKey]);
    await deps.db.asset.delete({ where: { id: asset.id } });
    return toAssetDto(outcome.existing);
  }
  if (outcome.kind === 'failed') {
    await markFailed(deps, asset.id, [asset.storageKey]);
    if (outcome.error instanceof ProcessingTimeoutError) throw new AppError('PROCESSING_TIMEOUT');
    if (outcome.error instanceof UnsupportedImageError) throw new AppError('UNSUPPORTED_FILE');
    throw outcome.error;
  }
  const { processed } = outcome;

  const { scope } = parseKey(asset.storageKey);
  const written: string[] = [];
  const put = async (variant: Variant | 'original', image: EncodedImage) => {
    const key = assetKey(scope, asset.id, variant, image.ext);
    await deps.storage.put(key, image.buffer, { contentType: image.mime, contentLength: image.buffer.length });
    written.push(key);
    return key;
  };

  let storageKey = asset.storageKey;
  let finalMime: string = mime;
  let sizeBytes = asset.sizeBytes;
  const variants: StoredVariants = {};
  try {
    for (const name of ASSET_VARIANTS) {
      const image = processed.variants[name];
      if (image) variants[name] = { key: await put(name, image), w: image.width, h: image.height };
    }
    if (processed.rasterOriginal) {
      // El SVG no se conserva: se sustituye por su versión rasterizada.
      storageKey = await put('original', processed.rasterOriginal);
      finalMime = processed.rasterOriginal.mime;
      sizeBytes = processed.rasterOriginal.buffer.length;
    }
  } catch (error) {
    await markFailed(deps, asset.id, [asset.storageKey, ...written]);
    throw new AppError('STORAGE_ERROR', { cause: error });
  }
  if (storageKey !== asset.storageKey) await deleteObjects(deps, [asset.storageKey]);

  const ready = await deps.db.asset.update({
    where: { id: asset.id },
    data: {
      status: 'ready',
      storageKey,
      mime: finalMime,
      sizeBytes,
      width: processed.width,
      height: processed.height,
      sha256: processed.sha256,
      variants,
    },
  });
  if (ready.projectId) await publishAssetReady(deps, ready.projectId, ready.id);
  return toAssetDto(ready);
}

export interface GeneratedImageInput {
  bytes: Buffer;
  projectId: string;
  organizationId: string;
  ownerId: string;
  prompt: string;
}

// Imagen que devuelve el proveedor: mismo procesado que una subida (tipo por bytes, sharp y variantes) y queda
// lista en la galería con source 'ai'. Si el proyecto ya tiene esa misma imagen generada, se reutiliza.
export async function storeGeneratedImage(deps: AssetDeps, input: GeneratedImageInput): Promise<AssetDto> {
  const { asset, created } = await storeImageBytes(deps, {
    ...input,
    source: 'ai',
    name: input.prompt.trim().slice(0, 120) || null,
    aiPrompt: input.prompt.slice(0, 2_000),
    inGallery: true,
  });
  if (created) await publishAssetReady(deps, input.projectId, asset.id);
  return asset;
}

// Imagen de un .parcify: el mismo pipeline que una subida, con source 'import'.
export async function storeImportedImage(
  deps: AssetDeps,
  input: { bytes: Buffer; projectId: string; organizationId: string; ownerId: string },
): Promise<AssetDto> {
  return (await storeImageBytes(deps, { ...input, source: 'import', name: null, aiPrompt: null, inGallery: false })).asset;
}

async function storeImageBytes(
  deps: AssetDeps,
  input: {
    bytes: Buffer;
    projectId: string;
    organizationId: string;
    ownerId: string;
    source: 'ai' | 'import';
    name: string | null;
    aiPrompt: string | null;
    inGallery: boolean;
  },
): Promise<{ asset: AssetDto; created: boolean }> {
  if (input.bytes.length === 0 || input.bytes.length > MAX_UPLOAD_BYTES) throw new AppError('UNSUPPORTED_FILE');
  const mime = await detectImageType(input.bytes.subarray(0, IMAGE_LIMITS.sniffBytes));
  // Solo se aceptan mapas de bits.
  if (!mime || mime === 'image/svg+xml') throw new AppError('UNSUPPORTED_FILE');

  const outcome = await deps.semaphore.run(async () => {
    const existing = await deps.db.asset.findFirst({
      where: { projectId: input.projectId, source: input.source, sha256: sha256Hex(input.bytes), status: 'ready', deletedAt: null },
    });
    if (existing) return { kind: 'duplicate', existing } as const;
    try {
      return { kind: 'processed', processed: await processImage(input.bytes, mime, deps.processingTimeoutMs) } as const;
    } catch (error) {
      return { kind: 'failed', error } as const;
    }
  });
  if (outcome.kind === 'duplicate') return { asset: toAssetDto(outcome.existing), created: false };
  if (outcome.kind === 'failed') {
    if (outcome.error instanceof ProcessingTimeoutError) throw new AppError('PROCESSING_TIMEOUT');
    throw new AppError('UNSUPPORTED_FILE', { cause: outcome.error });
  }
  const { processed } = outcome;

  const id = uuidv7();
  const written: string[] = [];
  const put = async (variant: Variant | 'original', buffer: Buffer, ext: ReturnType<typeof extensionOf>, contentType: string) => {
    const key = assetKey(input.organizationId, id, variant, ext);
    await deps.storage.put(key, buffer, { contentType, contentLength: buffer.length });
    written.push(key);
    return key;
  };
  const variants: StoredVariants = {};
  let storageKey: string;
  try {
    storageKey = await put('original', input.bytes, extensionOf(mime), mime);
    for (const name of ASSET_VARIANTS) {
      const image = processed.variants[name];
      if (image) variants[name] = { key: await put(name, image.buffer, image.ext, image.mime), w: image.width, h: image.height };
    }
  } catch (error) {
    await deleteObjects(deps, written);
    throw new AppError('STORAGE_ERROR', { cause: error });
  }

  let asset;
  try {
    asset = await deps.db.asset.create({
      data: {
        id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        ownerId: input.ownerId,
        source: input.source,
        status: 'ready',
        storageKey,
        mime,
        sizeBytes: input.bytes.length,
        width: processed.width,
        height: processed.height,
        sha256: processed.sha256,
        variants,
        name: input.name,
        aiPrompt: input.aiPrompt,
        inGallery: input.inGallery,
      },
    });
  } catch (error) {
    await deleteObjects(deps, written);
    throw error;
  }
  return { asset: toAssetDto(asset), created: true };
}

export async function resolveAssets(
  deps: AssetDeps,
  actor: Actor,
  body: z.infer<typeof ResolveAssetsBodySchema>,
): Promise<{ assets: Record<string, { url: string; expiresAt: string }> }> {
  const rows = await loadVisibleAssets(deps.db, actor.userId, [...new Set(body.ids)]);
  const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString();
  const assets: Record<string, { url: string; expiresAt: string }> = {};
  await Promise.all(
    rows.map(async (row) => {
      const variants = storedVariants(row.variants);
      // medium solo existe si el original es grande; si falta, sirve full.
      const variant = variants[body.variant] ?? variants.full ?? variants.thumb;
      if (!variant) return;
      assets[row.id] = {
        url: await deps.storage.createDownloadUrl(variant.key, { expiresIn: DOWNLOAD_URL_TTL_SECONDS }),
        expiresAt,
      };
    }),
  );
  return { assets };
}

const listableSources = ['upload', 'ai'] as const;

export async function listProjectAssets(
  deps: AssetDeps,
  actor: Actor,
  projectId: string,
  query: z.infer<typeof AssetListQuerySchema>,
) {
  await requireProject(deps.db, actor.userId, projectId);
  const rows = await deps.db.asset.findMany({
    where: {
      projectId,
      inGallery: true,
      status: 'ready',
      deletedAt: null,
      source: { in: query.source ? [query.source] : [...listableSources] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return {
    items: page.map(toAssetDto),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

async function requireEditableAsset(deps: AssetDeps, actor: Actor, assetId: string) {
  const asset = await deps.db.asset.findUnique({ where: { id: assetId } });
  if (!asset || !asset.projectId || asset.deletedAt) throw new AppError('ASSET_NOT_FOUND');
  try {
    await requireProject(deps.db, actor.userId, asset.projectId, 'asset:edit');
  } catch (error) {
    if (error instanceof AppError && error.code === 'PROJECT_NOT_FOUND') throw new AppError('ASSET_NOT_FOUND');
    throw error;
  }
  return asset;
}

export async function updateAsset(
  deps: AssetDeps,
  actor: Actor,
  assetId: string,
  body: z.infer<typeof UpdateAssetBodySchema>,
): Promise<AssetDto> {
  await requireEditableAsset(deps, actor, assetId);
  const updated = await deps.db.asset.update({
    where: { id: assetId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.inGallery !== undefined ? { inGallery: body.inGallery } : {}),
    },
  });
  return toAssetDto(updated);
}

// Los demás clientes del proyecto pintan el marcador de imagen rota en cuanto se borra.
export async function deleteAsset(deps: AssetDeps, actor: Actor, assetId: string): Promise<void> {
  const asset = await requireEditableAsset(deps, actor, assetId);
  await deps.db.asset.update({ where: { id: assetId }, data: { deletedAt: new Date() } });
  try {
    await publishProjectEvent(deps.redis, asset.projectId!, { type: 'asset.deleted', assetId });
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message }, projectId: asset.projectId }, 'No se pudo publicar asset.deleted');
  }
}

const UNSAFE_NAME = /["\\/:*?<>|]+/g;

const isControl = (char: string) => {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};

// Nombre del archivo descargado: el del asset sin su extensión, con la de la variante que se sirve.
export function downloadFileName(name: string | null, ext: string): string {
  const base = [...(name ?? '')]
    .map((char) => (isControl(char) ? ' ' : char))
    .join('')
    .replace(UNSAFE_NAME, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .trim()
    .slice(0, 100);
  return `${base || 'imagen'}.${ext}`;
}

export async function downloadAsset(deps: AssetDeps, actor: Actor, assetId: string): Promise<{ url: string; expiresAt: string }> {
  const [row] = await loadVisibleAssets(deps.db, actor.userId, [assetId]);
  const variants = row ? storedVariants(row.variants) : {};
  const variant = variants.full ?? variants.medium ?? variants.thumb;
  if (!row || !variant) throw new AppError('ASSET_NOT_FOUND');
  const url = await deps.storage.createDownloadUrl(variant.key, {
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    downloadName: downloadFileName(row.name, parseKey(variant.key).ext),
  });
  return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
}

export async function setProjectPreview(deps: AssetDeps, actor: Actor, projectId: string, assetId: string): Promise<void> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'project:edit');
  const asset = await deps.db.asset.findFirst({
    where: { id: assetId, projectId, source: 'preview', status: 'ready', deletedAt: null },
    select: { id: true },
  });
  if (!asset) throw new AppError('INVALID_ASSET');
  const previous = access.project.previewAssetId;
  await deps.db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { previewAssetId: asset.id } });
    if (previous && previous !== asset.id) {
      await tx.asset.updateMany({
        where: { id: previous, projectId, source: 'preview', deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
  });
}

export interface AssetCopyTarget {
  organizationId: string;
  ownerId: string;
  projectId: string | null;
  templateId?: string | null;
  // Sin indicarlo se conserva el del origen, salvo avatar, logo y template, que pasan a upload.
  source?: AssetRow['source'];
}

export type CopySource = Pick<
  AssetRow,
  'id' | 'source' | 'storageKey' | 'variants' | 'mime' | 'sizeBytes' | 'width' | 'height' | 'sha256' | 'name' | 'inGallery'
>;

// Copia el original y las variantes a claves nuevas y crea la fila. Si algo falla, borra lo ya escrito y relanza.
export async function copyAsset(
  deps: Pick<AssetDeps, 'db' | 'storage'>,
  source: CopySource,
  target: AssetCopyTarget,
): Promise<{ id: string; keys: string[] }> {
  const id = uuidv7();
  const written: string[] = [];
  try {
    const copyTo = async (key: string, variant: Variant | 'original') => {
      const to = assetKey(target.organizationId, id, variant, parseKey(key).ext);
      written.push(to);
      await copyObject(deps.storage, key, to, mimeForKey(key));
      return to;
    };
    const storageKey = await copyTo(source.storageKey, 'original');
    const variants: StoredVariants = {};
    for (const [name, variant] of Object.entries(storedVariants(source.variants)) as Array<
      [Variant, { key: string; w: number; h: number }]
    >) {
      variants[name] = { key: await copyTo(variant.key, name), w: variant.w, h: variant.h };
    }
    await deps.db.asset.create({
      data: {
        id,
        organizationId: target.organizationId,
        projectId: target.projectId,
        templateId: target.templateId ?? null,
        ownerId: target.ownerId,
        source:
          target.source ??
          (source.source === 'avatar' || source.source === 'logo' || source.source === 'template' ? 'upload' : source.source),
        status: 'ready',
        storageKey,
        mime: source.mime,
        sizeBytes: source.sizeBytes,
        width: source.width,
        height: source.height,
        sha256: source.sha256,
        variants,
        name: source.name,
        inGallery: source.inGallery,
      },
    });
    return { id, keys: written };
  } catch (error) {
    if (written.length > 0) await deps.storage.delete(written).catch(() => undefined);
    throw error;
  }
}

// Copia objetos y filas con ids nuevos; las que fallan se omiten del mapa.
export async function cloneAssets(
  deps: Pick<AssetDeps, 'db' | 'storage' | 'logger'>,
  sources: AssetRow[],
  target: { projectId: string; organizationId: string; ownerId: string },
): Promise<Map<string, string>> {
  const remap = new Map<string, string>();
  for (const source of sources) {
    try {
      remap.set(source.id, (await copyAsset(deps, source, target)).id);
    } catch (error) {
      deps.logger.error({ err: { message: (error as Error).message }, assetId: source.id }, 'No se pudo copiar el asset');
    }
  }
  return remap;
}

export async function copyAssets(
  deps: AssetDeps,
  actor: Actor,
  body: z.infer<typeof CopyAssetsBodySchema>,
): Promise<{ ids: Record<string, string> }> {
  const target = await requireProject(deps.db, actor.userId, body.targetProjectId, 'asset:upload');
  const visible = await loadVisibleAssets(deps.db, actor.userId, [...new Set(body.ids)]);
  const sources = visible.filter((row) => row.projectId !== null && row.source !== 'preview');
  const remap = await cloneAssets(deps, sources, {
    projectId: target.project.id,
    organizationId: target.project.organizationId,
    ownerId: actor.userId,
  });
  return { ids: Object.fromEntries(remap) };
}
