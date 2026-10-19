import { AppError } from '../errors.js';

export const AI_DOWNLOAD_TIMEOUT_MS = 30_000;
export const AI_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

export class DownloadNotAllowedError extends Error {
  constructor(reason: string) {
    super(`Descarga de imagen rechazada: ${reason}`);
    this.name = 'DownloadNotAllowedError';
  }
}

// Solo https, puerto por defecto, sin credenciales y con el host exacto en la lista.
export function assertDownloadAllowed(rawUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DownloadNotAllowedError('URL no válida');
  }
  if (url.protocol !== 'https:') throw new DownloadNotAllowedError('solo https');
  if (url.username || url.password) throw new DownloadNotAllowedError('URL con credenciales');
  if (url.port) throw new DownloadNotAllowedError('puerto no estándar');
  if (!allowedHosts.includes(url.hostname.toLowerCase())) throw new DownloadNotAllowedError('host no permitido');
  return url;
}

// Para proveedores que devuelven una URL en vez de los bytes de la imagen.
export async function downloadProviderImage(
  rawUrl: string,
  allowedHosts: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const url = assertDownloadAllowed(rawUrl, allowedHosts);
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(AI_DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new AppError('AI_PROVIDER_ERROR', { cause: error });
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new AppError('AI_PROVIDER_ERROR', { details: { status: response.status } });
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > AI_DOWNLOAD_MAX_BYTES) {
    await response.body.cancel();
    throw new AppError('AI_PROVIDER_ERROR');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AI_DOWNLOAD_MAX_BYTES) {
        await reader.cancel();
        throw new AppError('AI_PROVIDER_ERROR');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('AI_PROVIDER_ERROR', { cause: error });
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
