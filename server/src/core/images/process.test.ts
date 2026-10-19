import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  decompressionBomb,
  gif,
  htmlPretendingToBePng,
  jpegWithGps,
  png,
  svg,
} from '../../../test/fixtures/images/index.js';
import { detectImageType, processImage, ProcessingTimeoutError, UnsupportedImageError } from './process.js';
import { Semaphore } from './semaphore.js';

describe('detectImageType', () => {
  it('reconoce las imágenes por su contenido y no por lo que se declara', async () => {
    expect(await detectImageType(await png())).toBe('image/png');
    expect(await detectImageType(await jpegWithGps())).toBe('image/jpeg');
    expect(await detectImageType(await gif())).toBe('image/gif');
    expect(await detectImageType(svg())).toBe('image/svg+xml');
    expect(await detectImageType(htmlPretendingToBePng())).toBeNull();
    expect(await detectImageType(Buffer.from('%PDF-1.7\n'))).toBeNull();
  });
});

describe('processImage', () => {
  it('genera thumb y full, y medium solo si el original pasa de 1024 px', async () => {
    const small = await processImage(await png(300, 200), 'image/png');
    expect(small.variants.thumb).toMatchObject({ width: 256, height: 171 });
    expect(small.variants.medium).toBeUndefined();
    expect(small.variants.full).toMatchObject({ width: 300, height: 200 });
    expect(small.sha256).toMatch(/^[0-9a-f]{64}$/);

    const large = await processImage(await png(2000, 1000), 'image/png');
    expect(large.variants.medium).toMatchObject({ width: 1024, height: 512 });
    expect(large.variants.full).toMatchObject({ width: 2000, height: 1000 });
  });

  it('quita el EXIF y el GPS de un JPEG', async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const result = await processImage(input, 'image/jpeg');
    for (const variant of [result.variants.thumb, result.variants.full]) {
      const meta = await sharp(variant.buffer).metadata();
      expect(meta.exif).toBeUndefined();
      expect(variant.buffer.includes(Buffer.from('Exif'))).toBe(false);
    }
  });

  it('rasteriza el SVG a PNG de 2048 px como máximo', async () => {
    const result = await processImage(svg(), 'image/svg+xml');
    expect(result.rasterOriginal).toMatchObject({ mime: 'image/png', width: 2048, height: 1024 });
    expect(result.width).toBe(2048);
  });

  it('rechaza una bomba de descompresión por limitInputPixels', async () => {
    await expect(processImage(decompressionBomb(), 'image/png')).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it('corta por tiempo', async () => {
    await expect(processImage(await png(3000, 3000), 'image/png', 1)).rejects.toBeInstanceOf(ProcessingTimeoutError);
  });

  it('tras un corte por tiempo no queda trabajo de sharp fuera del semáforo', async () => {
    const semaphore = new Semaphore(2);
    const input = await png(3000, 3000);
    const inFlight = () => sharp.counters().queue + sharp.counters().process;
    const samples: number[] = [];
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        semaphore.run(async () => {
          try {
            return await processImage(input, 'image/png', 1);
          } finally {
            // Solo puede seguir activo el pipeline del otro hueco.
            samples.push(inFlight());
            expect(semaphore.running).toBeLessThanOrEqual(2);
          }
        }),
      ),
    );
    for (const result of results) {
      expect(result.status).toBe('rejected');
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ProcessingTimeoutError);
    }
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(inFlight()).toBe(0);
    expect(semaphore.running).toBe(0);
  });

  it('usa PNG con transparencia si no pesa mucho más que WebP', async () => {
    const result = await processImage(await png(64, 64, { alpha: true }), 'image/png');
    expect(['image/png', 'image/webp']).toContain(result.variants.full.mime);
    const opaque = await processImage(await png(64, 64), 'image/png');
    expect(opaque.variants.full.mime).toBe('image/webp');
  });
});
