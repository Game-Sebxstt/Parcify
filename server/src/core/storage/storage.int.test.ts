import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/helpers/app.js';
import {
  createTestStorage,
  s3Reachable,
  transfer,
  uploadTo,
  type DriverKind,
  type TestStorage,
} from '../../../test/helpers/storage.js';
import {
  assetKey,
  readAll,
  StorageKeyError,
  StorageNotFoundError,
  type StorageDriver,
} from './index.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

const s3Up = await s3Reachable();
if (!s3Up && process.env.TEST_REQUIRE_S3 === '1') {
  throw new Error('TEST_REQUIRE_S3=1 pero SeaweedFS no responde: docker compose -f compose.test.yml --profile s3 up -d --wait');
}
if (!s3Up) console.warn('SeaweedFS no responde: el contrato solo corre con local (levanta el perfil s3 para cubrir s3).');

const drivers: DriverKind[] = s3Up ? ['local', 's3'] : ['local'];

const TRAVERSAL_KEYS = [
  'a/../../etc/passwd',
  `a/org/../${randomUUID()}/original.png`,
  `a/org/${randomUUID()}/../original.png`,
  '../a/org/x/original.png',
  `a/org/${randomUUID()}/original.png/..`,
  `/a/org/${randomUUID()}/original.png`,
  `a\\org\\${randomUUID()}\\original.png`,
];

function tamper(url: string): string {
  const parsed = new URL(url);
  for (const name of ['sig', 'X-Amz-Signature']) {
    const value = parsed.searchParams.get(name);
    if (value) {
      const flipped = (value[0] === 'a' ? 'b' : 'a') + value.slice(1);
      parsed.searchParams.set(name, flipped);
    }
  }
  return parsed.toString();
}

describe.each(drivers)('contrato de storage (%s)', (kind) => {
  let app: App;
  let testStorage: TestStorage;
  let storage: StorageDriver;
  const scope = `org-${randomUUID().slice(0, 8)}`;
  const key = (variant: 'original' | 'thumb' = 'original', ext: 'png' | 'webp' = 'png') =>
    assetKey(scope, randomUUID(), variant, ext);

  beforeAll(async () => {
    testStorage = await createTestStorage(kind);
    storage = testStorage.storage;
    app = await buildTestApp({}, { storage });
  });

  afterAll(async () => {
    await app.close();
    await testStorage.cleanup();
  });

  it('expone su tipo', () => {
    expect(storage.kind).toBe(kind);
  });

  it('guarda un Buffer y lo devuelve entero y por rangos', async () => {
    const k = key();
    const body = Buffer.from('0123456789abcdef');
    await storage.put(k, body, { contentType: 'image/png', contentLength: body.length });
    expect(await storage.head(k)).toEqual({ size: 16, contentType: 'image/png' });
    expect((await readAll(await storage.getStream(k))).toString()).toBe('0123456789abcdef');
    expect((await readAll(await storage.getStream(k, { start: 2, end: 5 }))).toString()).toBe('2345');
  });

  it('guarda un stream sin longitud conocida', async () => {
    const k = key('thumb', 'webp');
    await storage.put(k, Readable.from([Buffer.from('uno-'), Buffer.from('dos-'), Buffer.from('tres')]), {
      contentType: 'image/webp',
    });
    expect(await storage.head(k)).toEqual({ size: 12, contentType: 'image/webp' });
  });

  it('sobrescribe una clave de forma completa', async () => {
    const k = key();
    await storage.put(k, Buffer.from('primera versión larga'), { contentType: 'image/png' });
    await storage.put(k, Buffer.from('segunda'), { contentType: 'image/png' });
    expect((await readAll(await storage.getStream(k))).toString()).toBe('segunda');
  });

  it('head devuelve null y getStream lanza StorageNotFoundError si no existe', async () => {
    const k = key();
    expect(await storage.head(k)).toBeNull();
    await expect(storage.getStream(k)).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it('borra varias claves, existan o no', async () => {
    const a = key();
    const b = key();
    await storage.put(a, Buffer.from('a'), { contentType: 'image/png' });
    await storage.put(b, Buffer.from('b'), { contentType: 'image/png' });
    await storage.delete([a, b, key()]);
    expect(await storage.head(a)).toBeNull();
    expect(await storage.head(b)).toBeNull();
    await storage.delete([]);
  });

  it('rechaza claves con .. o fuera del formato en todas las operaciones', async () => {
    expect(() => assetKey('../x', randomUUID(), 'original', 'png')).toThrow(StorageKeyError);
    for (const bad of TRAVERSAL_KEYS) {
      await expect(storage.put(bad, Buffer.from('x'), { contentType: 'image/png' }), bad).rejects.toBeInstanceOf(
        StorageKeyError,
      );
      await expect(storage.head(bad), bad).rejects.toBeInstanceOf(StorageKeyError);
      await expect(storage.getStream(bad), bad).rejects.toBeInstanceOf(StorageKeyError);
      await expect(storage.delete([bad]), bad).rejects.toBeInstanceOf(StorageKeyError);
      await expect(storage.createDownloadUrl(bad, { expiresIn: 60 }), bad).rejects.toBeInstanceOf(StorageKeyError);
    }
  });

  it('la URL de descarga sirve el objeto y deja de valer si se altera la firma', async () => {
    const k = key();
    const body = Buffer.from('contenido de imagen');
    await storage.put(k, body, { contentType: 'image/png' });
    const url = await storage.createDownloadUrl(k, { expiresIn: 60 });

    const ok = await transfer(app, url);
    expect(ok.status).toBe(200);
    expect(ok.body.toString()).toBe('contenido de imagen');

    const bad = await transfer(app, tamper(url));
    expect(bad.status).toBe(403);
  });

  it('la URL de descarga caduca', async () => {
    const k = key();
    await storage.put(k, Buffer.from('caduca'), { contentType: 'image/png' });
    const url = await storage.createDownloadUrl(k, { expiresIn: 1 });
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    const expired = await transfer(app, url);
    expect(expired.status).toBe(403);
  });

  it('la URL de subida acepta el PUT firmado y rechaza la firma alterada', async () => {
    const id = randomUUID();
    const k = assetKey(scope, id, 'original', 'png');
    const body = Buffer.from('bytes subidos por el navegador');
    await app.db.asset.create({
      data: { id, ownerId: 'contrato', source: 'upload', storageKey: k, mime: 'image/png', sizeBytes: body.length },
    });
    const target = await storage.createUploadTarget(k, {
      contentType: 'image/png',
      contentLength: body.length,
      expiresIn: 60,
    });
    expect(target.method).toBe('PUT');
    expect(target.headers['content-type']).toBe('image/png');

    const rejected = await uploadTo(app, { ...target, url: tamper(target.url) }, body);
    expect(rejected.status).toBe(403);
    expect(await storage.head(k)).toBeNull();

    const accepted = await uploadTo(app, target, body);
    expect(accepted.status).toBeGreaterThanOrEqual(200);
    expect(accepted.status).toBeLessThan(300);
    expect(await storage.head(k)).toMatchObject({ size: body.length });
    expect((await readAll(await storage.getStream(k))).equals(body)).toBe(true);
  });
});
