import type { Readable } from 'node:stream';

export interface UploadTarget {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
}

export interface StorageDriver {
  readonly kind: 's3' | 'local';
  put(key: string, body: Buffer | Readable, opts: { contentType: string; contentLength?: number }): Promise<void>;
  getStream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  delete(keys: string[]): Promise<void>;
  createUploadTarget(
    key: string,
    opts: { contentType: string; contentLength: number; expiresIn: number },
  ): Promise<UploadTarget>;
  createDownloadUrl(key: string, opts: { expiresIn: number; downloadName?: string }): Promise<string>;
}

export const STORAGE_VARIANTS = ['original', 'thumb', 'medium', 'full'] as const;
export type StorageVariant = (typeof STORAGE_VARIANTS)[number];

export const EXTENSION_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
} as const;

export type StorageExtension = keyof typeof EXTENSION_MIME;

const MIME_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSION_MIME).map(([ext, mime]) => [mime, ext]),
) as Record<string, StorageExtension>;

export function extensionForMime(mime: string): StorageExtension {
  const ext = MIME_EXTENSION[mime];
  if (!ext) throw new StorageKeyError(`Tipo sin extensión conocida: ${mime}`);
  return ext;
}

export function mimeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1) as StorageExtension;
  return EXTENSION_MIME[ext] ?? 'application/octet-stream';
}

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageKeyError';
  }
}

export class StorageNotFoundError extends Error {
  constructor(readonly key: string) {
    super('El objeto no existe');
    this.name = 'StorageNotFoundError';
  }
}

const SCOPE = /^(?:u-)?[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^a\/((?:u-)?[A-Za-z0-9_-]{1,64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(original|thumb|medium|full)\.(png|jpg|webp|gif|avif|svg)$/;

// Formato único a/{scope}/{assetId}/{variant}.{ext}; nunca lleva texto del usuario.
export function assetKey(scope: string, assetId: string, variant: StorageVariant, ext: StorageExtension): string {
  if (!SCOPE.test(scope)) throw new StorageKeyError('Ámbito de clave inválido');
  if (!UUID.test(assetId)) throw new StorageKeyError('Id de asset inválido');
  if (!(STORAGE_VARIANTS as readonly string[]).includes(variant)) throw new StorageKeyError('Variante inválida');
  if (!(ext in EXTENSION_MIME)) throw new StorageKeyError('Extensión inválida');
  return `a/${scope}/${assetId}/${variant}.${ext}`;
}

export function assertValidKey(key: string): void {
  if (typeof key !== 'string' || !KEY.test(key)) throw new StorageKeyError('Clave de storage inválida');
}

export function parseKey(key: string): { scope: string; assetId: string; variant: StorageVariant; ext: StorageExtension } {
  const match = KEY.exec(key);
  if (!match) throw new StorageKeyError('Clave de storage inválida');
  return {
    scope: match[1]!,
    assetId: match[2]!,
    variant: match[3] as StorageVariant,
    ext: match[4] as StorageExtension,
  };
}
