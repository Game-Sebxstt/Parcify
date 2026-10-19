import { PDFDocument } from 'pdf-lib';
import type { Renderer } from '../render/Renderer.ts';
import { renderRaster, type ExportScene } from './raster.ts';

// El contenido de cada página es un PNG a 2×: el PDF vectorial queda fuera de v1.
export const PDF_RASTER_SCALE = 2;

// Una página por escena (un frame o la página entera), con el tamaño en puntos igual al de la escena.
export async function renderPdf(renderer: Renderer, scenes: readonly ExportScene[], options: { title: string; signal?: AbortSignal }): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(options.title);
  pdf.setCreator('Parcify');
  for (const scene of scenes) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const raster = await renderRaster(renderer, scene, {
      scale: PDF_RASTER_SCALE,
      format: 'png',
      transparent: false,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const image = await pdf.embedPng(await raster.blob.arrayBuffer());
    const { w, h } = scene.bounds;
    const page = pdf.addPage([Math.max(1, w), Math.max(1, h)]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  const bytes = await pdf.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
