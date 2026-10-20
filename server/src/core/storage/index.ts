import type { Readable } from 'node:stream';
import type { Config } from '../config.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';
import type { StorageDriver } from './types.js';

export { isLocalStorage, LocalStorage } from './local.js';
export { S3Storage } from './s3.js';
export * from './types.js';

export function createStorage(config: Pick<Config, 'storage' | 'apiOrigin'>): StorageDriver {
  const storage = config.storage;
  if (storage.driver === 'local') {
    return new LocalStorage({ root: storage.localPath, urlSecret: storage.urlSecret, apiOrigin: config.apiOrigin });
  }
  return new S3Storage(storage);
}

export async function readAll(stream: Readable, maxBytes = Number.POSITIVE_INFINITY): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error('El objeto supera el tamaño esperado');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function copyObject(storage: StorageDriver, from: string, to: string, contentType: string): Promise<void> {
  const body = await readAll(await storage.getStream(from));
  await storage.put(to, body, { contentType, contentLength: body.length });
}
