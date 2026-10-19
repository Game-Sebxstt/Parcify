import { TextureLoadError } from './TextureManager.ts';

// Descarga una variante y la decodifica con createImageBitmap. Lo usan el worker de decodificación y, si no hay
// workers, el hilo principal.
export async function fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { credentials: 'omit', signal });
  if (!response.ok) throw new TextureLoadError(response.status);
  const blob = await response.blob();
  return createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
}
