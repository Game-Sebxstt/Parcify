import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { assertValidKey, mimeForKey, StorageNotFoundError, type StorageDriver, type UploadTarget } from './types.js';

export interface S3StorageOptions {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

// Cada clave es inmutable: el navegador puede cachear sin revalidar.
const IMMUTABLE = 'private, max-age=31536000, immutable';
const DELETE_CONCURRENCY = 8;

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

export class S3Storage implements StorageDriver {
  readonly kind = 's3' as const;
  readonly client: S3Client;
  readonly bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      // Los compatibles (SeaweedFS, MinIO, R2) no siempre aceptan las sumas CRC por defecto.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, body: Buffer | Readable, opts: { contentType: string; contentLength?: number }): Promise<void> {
    assertValidKey(key);
    const params = { Bucket: this.bucket, Key: key, ContentType: opts.contentType, CacheControl: IMMUTABLE };
    if (Buffer.isBuffer(body)) {
      await this.client.send(new PutObjectCommand({ ...params, Body: body, ContentLength: body.length }));
      return;
    }
    if (opts.contentLength !== undefined) {
      await this.client.send(new PutObjectCommand({ ...params, Body: body, ContentLength: opts.contentLength }));
      return;
    }
    await new Upload({ client: this.client, params: { ...params, Body: body } }).done();
  }

  async getStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    assertValidKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
      );
      if (!result.Body) throw new StorageNotFoundError(key);
      return result.Body as Readable;
    } catch (error) {
      if (isNotFound(error)) throw new StorageNotFoundError(key);
      throw error;
    }
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    assertValidKey(key);
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? mimeForKey(key) };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  // DeleteObject por clave: DeleteObjects exige sumas de control que algunos compatibles rechazan.
  async delete(keys: string[]): Promise<void> {
    for (const key of keys) assertValidKey(key);
    for (let i = 0; i < keys.length; i += DELETE_CONCURRENCY) {
      await Promise.all(
        keys
          .slice(i, i + DELETE_CONCURRENCY)
          .map((key) => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))),
      );
    }
  }

  async createUploadTarget(
    key: string,
    opts: { contentType: string; contentLength: number; expiresIn: number },
  ): Promise<UploadTarget> {
    assertValidKey(key);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: opts.expiresIn,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { method: 'PUT', url, headers: { 'content-type': opts.contentType } };
  }

  async createDownloadUrl(key: string, opts: { expiresIn: number; downloadName?: string }): Promise<string> {
    assertValidKey(key);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(opts.downloadName
        ? { ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}` }
        : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: opts.expiresIn });
  }
}
