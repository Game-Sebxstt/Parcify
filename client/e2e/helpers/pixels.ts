import type { Page } from '@playwright/test';

export type Rgba = [number, number, number, number];

// Lo que de verdad se ve en un punto: una captura de 1×1 px decodificada en la página (sin dependencias de PNG en Node).
export async function screenPixel(page: Page, point: { x: number; y: number }): Promise<Rgba> {
  const shot = await page.screenshot({ clip: { x: Math.floor(point.x), y: Math.floor(point.y), width: 1, height: 1 } });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0]!, data[1]!, data[2]!, data[3]!] as Rgba;
  }, shot.toString('base64'));
}

export const samePixel = (a: readonly number[] | null, b: readonly number[] | null, tolerance = 2) =>
  a !== null && b !== null && a.slice(0, 3).every((channel, i) => Math.abs(channel - b[i]!) <= tolerance);
