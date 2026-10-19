import { describe, expect, it, vi } from 'vitest';
import { AI_DOWNLOAD_MAX_BYTES, DownloadNotAllowedError, downloadProviderImage } from './download.js';

const IMAGE_URL = 'https://images.example-ai.com/out/1.png';

function fakeFetch(body: Uint8Array, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(async () => new Response(body as ConstructorParameters<typeof Response>[0], { status: 200, headers }));
}

describe('downloadProviderImage', () => {
  it('con AI_IMAGE_DOWNLOAD_HOSTS vacío no descarga nada', async () => {
    const fetchImpl = fakeFetch(new Uint8Array([1]));
    await expect(downloadProviderImage(IMAGE_URL, [], fetchImpl)).rejects.toBeInstanceOf(DownloadNotAllowedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rechaza hosts fuera de la lista, http, puertos, credenciales y direcciones internas', async () => {
    const fetchImpl = fakeFetch(new Uint8Array([1]));
    const allowed = ['images.example-ai.com'];
    for (const url of [
      'https://evil.example.com/x.png',
      'https://images.example-ai.com.evil.com/x.png',
      'http://images.example-ai.com/x.png',
      'https://images.example-ai.com:8443/x.png',
      'https://user:pass@images.example-ai.com/x.png',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x.png',
      'file:///etc/passwd',
      'no es una url',
    ]) {
      await expect(downloadProviderImage(url, allowed, fetchImpl), url).rejects.toBeInstanceOf(DownloadNotAllowedError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('descarga de un host permitido sin seguir redirecciones', async () => {
    const fetchImpl = fakeFetch(new Uint8Array([1, 2, 3]));
    const bytes = await downloadProviderImage(IMAGE_URL, ['images.example-ai.com'], fetchImpl);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });

  it('corta por encima de 20 MiB', async () => {
    const declared = fakeFetch(new Uint8Array([1]), { 'content-length': String(AI_DOWNLOAD_MAX_BYTES + 1) });
    await expect(downloadProviderImage(IMAGE_URL, ['images.example-ai.com'], declared)).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
    });
    const streamed = fakeFetch(new Uint8Array(AI_DOWNLOAD_MAX_BYTES + 1));
    await expect(downloadProviderImage(IMAGE_URL, ['images.example-ai.com'], streamed)).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
    });
  });
});
