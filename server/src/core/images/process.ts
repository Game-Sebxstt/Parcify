import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp, { type Sharp } from 'sharp';
import type { StorageExtension } from '../storage/types.js';

// Cada llamada usa un solo hilo de libvips; el paralelismo lo controla el semáforo.
sharp.concurrency(1);

export const IMAGE_LIMITS = {
  maxInputPixels: 50_000_000,
  thumb: 256,
  medium: 1024,
  full: 4096,
  svgRaster: 2048,
  quality: 82,
  timeoutMs: 30_000,
  sniffBytes: 4_100,
} as const;

export const RASTER_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;
export type ImageMime = (typeof RASTER_MIMES)[number] | 'image/svg+xml';

export class UnsupportedImageError extends Error {
  constructor(message = 'Imagen no compatible', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UnsupportedImageError';
  }
}

export class ProcessingTimeoutError extends Error {
  constructor() {
    super('El procesado de la imagen superó el tiempo máximo');
    this.name = 'ProcessingTimeoutError';
  }
}

const EXT: Record<ImageMime, StorageExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

export function extensionOf(mime: ImageMime): StorageExtension {
  return EXT[mime];
}

// Quita la declaración XML, comentarios y DOCTYPE y exige que el primer elemento sea <svg>.
function looksLikeSvg(head: Buffer): boolean {
  let text = head.toString('utf8').replace(/^\uFEFF/, '');
  for (;;) {
    text = text.trimStart();
    if (text.startsWith('<?xml')) {
      const end = text.indexOf('?>');
      if (end < 0) return false;
      text = text.slice(end + 2);
    } else if (text.startsWith('<!--')) {
      const end = text.indexOf('-->');
      if (end < 0) return false;
      text = text.slice(end + 3);
    } else if (/^<!DOCTYPE\s+svg/i.test(text)) {
      const end = text.indexOf('>');
      if (end < 0) return false;
      text = text.slice(end + 1);
    } else break;
  }
  return /^<svg[\s>]/i.test(text);
}

export async function detectImageType(head: Buffer): Promise<ImageMime | null> {
  const detected = await fileTypeFromBuffer(head);
  if (detected && (RASTER_MIMES as readonly string[]).includes(detected.mime)) return detected.mime as ImageMime;
  // file-type no distingue SVG: como mucho lo ve como XML.
  if (detected && detected.mime !== 'application/xml') return null;
  return looksLikeSvg(head) ? 'image/svg+xml' : null;
}

export interface EncodedImage {
  buffer: Buffer;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
  ext: 'webp' | 'png';
}

export interface ProcessedImage {
  sha256: string;
  width: number;
  height: number;
  // Solo en SVG: el PNG que sustituye al original subido.
  rasterOriginal: EncodedImage | null;
  variants: { thumb: EncodedImage; medium?: EncodedImage; full: EncodedImage };
}

const decodeOptions = { limitInputPixels: IMAGE_LIMITS.maxInputPixels, failOn: 'error' } as const;

// Tope común a todos los pasos. Cada pipeline lleva el tiempo restante en su propio timeout,
// así libvips aborta el trabajo en vez de seguir ocupando un hilo tras el rechazo.
class Deadline {
  private readonly at: number;

  constructor(ms: number) {
    this.at = Date.now() + ms;
  }

  check(): void {
    if (Date.now() >= this.at) throw new ProcessingTimeoutError();
  }

  bound(pipeline: Sharp): Sharp {
    this.check();
    return pipeline.timeout({ seconds: Math.max(1, Math.ceil((this.at - Date.now()) / 1000)) });
  }
}

async function encode(pipeline: Sharp, opaque: boolean, deadline: Deadline): Promise<EncodedImage> {
  const webp = await deadline
    .bound(pipeline.clone().webp({ quality: IMAGE_LIMITS.quality }))
    .toBuffer({ resolveWithObject: true });
  if (!opaque) {
    // Con transparencia, PNG sin pérdida si no pesa mucho más: conserva los bordes duros.
    const png = await deadline
      .bound(pipeline.clone().png({ compressionLevel: 9 }))
      .toBuffer({ resolveWithObject: true });
    if (png.data.length <= webp.data.length * 2) {
      return { buffer: png.data, width: png.info.width, height: png.info.height, mime: 'image/png', ext: 'png' };
    }
  }
  return { buffer: webp.data, width: webp.info.width, height: webp.info.height, mime: 'image/webp', ext: 'webp' };
}

async function rasterizeSvg(input: Buffer, deadline: Deadline): Promise<EncodedImage> {
  const meta = await sharp(input, decodeOptions).metadata();
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0) || IMAGE_LIMITS.svgRaster;
  const density = Math.min(2400, Math.max(1, Math.round((72 * IMAGE_LIMITS.svgRaster) / longest)));
  const { data, info } = await deadline
    .bound(
      sharp(input, { ...decodeOptions, density })
        .resize({ width: IMAGE_LIMITS.svgRaster, height: IMAGE_LIMITS.svgRaster, fit: 'inside', withoutEnlargement: true })
        .png(),
    )
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, mime: 'image/png', ext: 'png' };
}

async function processBounded(input: Buffer, mime: ImageMime, deadline: Deadline): Promise<ProcessedImage> {
  const sha256 = createHash('sha256').update(input).digest('hex');
  const rasterOriginal = mime === 'image/svg+xml' ? await rasterizeSvg(input, deadline) : null;
  const source = rasterOriginal?.buffer ?? input;

  // Sin withMetadata: la salida no lleva EXIF, GPS ni perfiles. GIF: solo el primer fotograma.
  const base = sharp(source, { ...decodeOptions, pages: 1 }).autoOrient();
  const meta = await base.metadata();
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new UnsupportedImageError('La imagen no tiene dimensiones');
  deadline.check();
  const { isOpaque } = await base.clone().stats();

  const resized = (size: number) =>
    base.clone().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
  const longest = Math.max(width, height);
  // En serie: cada hueco del semáforo es un solo pipeline de sharp a la vez.
  const thumb = await encode(resized(IMAGE_LIMITS.thumb), isOpaque, deadline);
  const medium =
    longest > IMAGE_LIMITS.medium ? await encode(resized(IMAGE_LIMITS.medium), isOpaque, deadline) : undefined;
  const full = await encode(resized(IMAGE_LIMITS.full), isOpaque, deadline);
  return { sha256, width, height, rasterOriginal, variants: { thumb, ...(medium ? { medium } : {}), full } };
}

// libvips informa el corte por timeout() como "timeout: N% complete".
function isVipsTimeout(error: unknown): boolean {
  return error instanceof Error && /^timeout\b/i.test(error.message.trim());
}

// Solo resuelve o rechaza cuando sharp ha terminado: quien la llama dentro del semáforo
// no cede el hueco mientras quede trabajo de libvips en curso.
export async function processImage(
  input: Buffer,
  mime: ImageMime,
  timeoutMs: number = IMAGE_LIMITS.timeoutMs,
): Promise<ProcessedImage> {
  try {
    return await processBounded(input, mime, new Deadline(timeoutMs));
  } catch (error) {
    if (error instanceof UnsupportedImageError || error instanceof ProcessingTimeoutError) throw error;
    if (isVipsTimeout(error)) throw new ProcessingTimeoutError();
    throw new UnsupportedImageError((error as Error).message, { cause: error });
  }
}
