import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { signStorageUrl, verifyStorageSignature, type SignedMethod } from './sign.js';
import {
  assertValidKey,
  mimeForKey,
  parseKey,
  StorageKeyError,
  StorageNotFoundError,
  type StorageDriver,
  type UploadTarget,
} from './types.js';

export interface LocalStorageOptions {
  root: string;
  urlSecret: string;
  apiOrigin: string;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export class LocalStorage implements StorageDriver {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(private readonly options: LocalStorageOptions) {
    this.root = resolve(options.root);
  }

  // Defensa adicional: aunque las claves son del servidor, la ruta resuelta no puede salir de la raíz.
  pathFor(key: string): string {
    assertValidKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new StorageKeyError('La clave sale del directorio de storage');
    return full;
  }

  // El tipo se deduce de la extensión de la clave, así que opts no se guarda.
  async put(key: string, body: Buffer | Readable, _opts?: { contentType: string; contentLength?: number }): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      if (Buffer.isBuffer(body)) await writeFile(temp, body, { flag: 'wx' });
      else await pipeline(body, createWriteStream(temp, { flags: 'wx' }));
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async getStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const path = this.pathFor(key);
    try {
      await stat(path);
    } catch (error) {
      if (isMissing(error)) throw new StorageNotFoundError(key);
      throw error;
    }
    return createReadStream(path, range ? { start: range.start, end: range.end } : {});
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      return info.isFile() ? { size: info.size, contentType: mimeForKey(key) } : null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(keys: string[]): Promise<void> {
    const paths = keys.map((key) => this.pathFor(key));
    await Promise.all(paths.map((path) => rm(path, { force: true })));
  }

  private signed(method: SignedMethod, key: string, expiresIn: number, downloadName?: string) {
    const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresIn));
    const sig = signStorageUrl(this.options.urlSecret, method, key, exp, downloadName);
    return { exp: String(exp), sig };
  }

  async createUploadTarget(
    key: string,
    opts: { contentType: string; contentLength: number; expiresIn: number },
  ): Promise<UploadTarget> {
    const { assetId } = parseKey(key);
    const query = new URLSearchParams(this.signed('PUT', key, opts.expiresIn));
    return {
      method: 'PUT',
      url: `${this.options.apiOrigin}/v1/assets/uploads/${assetId}/content?${query}`,
      headers: { 'content-type': opts.contentType },
    };
  }

  async createDownloadUrl(key: string, opts: { expiresIn: number; downloadName?: string }): Promise<string> {
    assertValidKey(key);
    const query = new URLSearchParams(this.signed('GET', key, opts.expiresIn, opts.downloadName));
    if (opts.downloadName) query.set('name', opts.downloadName);
    return `${this.options.apiOrigin}/v1/files/${key}?${query}`;
  }

  verify(method: SignedMethod, key: string, query: { exp?: unknown; sig?: unknown; name?: unknown }): boolean {
    const downloadName = typeof query.name === 'string' ? query.name : undefined;
    return verifyStorageSignature(this.options.urlSecret, { method, key, exp: query.exp, sig: query.sig, downloadName });
  }
}

export function isLocalStorage(storage: StorageDriver): storage is LocalStorage {
  return storage.kind === 'local' && storage instanceof LocalStorage;
}
