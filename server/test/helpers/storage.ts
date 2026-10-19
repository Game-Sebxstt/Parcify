import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { LocalStorage, S3Storage, type StorageDriver, type UploadTarget } from '../../src/core/storage/index.js';
import type { buildTestApp } from './app.js';
import { TEST_SECRET_C } from './env.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

export const TEST_API_ORIGIN = 'http://localhost:3000';

// Credenciales solo de pruebas, las mismas de test/seaweedfs/s3.json.
export const S3_TEST_OPTIONS = {
  endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:58334',
  region: 'us-east-1',
  bucket: process.env.TEST_S3_BUCKET ?? 'parcify-test',
  accessKeyId: 'parcify_test_key',
  secretAccessKey: 'parcify_test_secret_0123456789',
  forcePathStyle: true,
};

export type DriverKind = 'local' | 's3';

export function driverUnderTest(): DriverKind {
  return process.env.TEST_STORAGE_DRIVER === 's3' ? 's3' : 'local';
}

async function ensureBucket(storage: S3Storage): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
      return;
    } catch {
      try {
        await storage.client.send(new CreateBucketCommand({ Bucket: storage.bucket }));
        return;
      } catch (error) {
        lastError = error;
        const name = (error as { name?: string }).name;
        if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`SeaweedFS no responde en ${S3_TEST_OPTIONS.endpoint}: ${(lastError as Error)?.message}`);
}

// Comprueba si el SeaweedFS del perfil s3 está levantado (sin esperar).
export async function s3Reachable(): Promise<boolean> {
  try {
    const response = await fetch(S3_TEST_OPTIONS.endpoint, { signal: AbortSignal.timeout(1_500) });
    return response.status > 0;
  } catch {
    return false;
  }
}

export interface TestStorage {
  storage: StorageDriver;
  cleanup: () => Promise<void>;
}

export async function createTestStorage(kind: DriverKind): Promise<TestStorage> {
  if (kind === 's3') {
    const storage = new S3Storage(S3_TEST_OPTIONS);
    await ensureBucket(storage);
    return { storage, cleanup: async () => storage.client.destroy() };
  }
  const root = await mkdtemp(join(tmpdir(), 'parcify-storage-'));
  const storage = new LocalStorage({ root, urlSecret: TEST_SECRET_C, apiOrigin: TEST_API_ORIGIN });
  return { storage, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export interface TransferResult {
  status: number;
  body: Buffer;
  headers: Record<string, string>;
}

function fromInject(response: LightMyRequestResponse): TransferResult {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return { status: response.statusCode, body: response.rawPayload, headers };
}

// Las URLs de la API se resuelven con inject; las de S3 van por la red, igual que desde el navegador.
export async function transfer(
  app: App,
  url: string,
  init: { method: 'GET' | 'PUT'; headers?: Record<string, string>; body?: Buffer } = { method: 'GET' },
): Promise<TransferResult> {
  if (url.startsWith(TEST_API_ORIGIN)) {
    const response = await app.inject({
      method: init.method,
      url: url.slice(TEST_API_ORIGIN.length),
      headers: init.headers,
      ...(init.body ? { payload: init.body } : {}),
    });
    return fromInject(response);
  }
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body ? { body: new Uint8Array(init.body) } : {}),
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers };
}

export function uploadTo(app: App, target: UploadTarget, body: Buffer) {
  return transfer(app, target.url, { method: 'PUT', headers: target.headers, body });
}
