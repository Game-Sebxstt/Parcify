// @vitest-environment jsdom
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toasts } from '../ui/toast.svelte.ts';
import { API_ORIGIN, ApiError, apiFetch, browser, cached, safeReturnPath, signInUrl } from './api.ts';

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function apiError(code: string, status: number) {
  return json(status, { error: { code, message: 'mensaje del servidor', details: {}, requestId: 'req-1' } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  toasts.splice(0);
  window.history.replaceState(null, '', '/p/0198c5d2-0000-7000-8000-000000000000?vista=capas');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('safeReturnPath', () => {
  it('acepta rutas internas con query y hash', () => {
    expect(safeReturnPath('/p/abc?x=1#y')).toBe('/p/abc?x=1#y');
    expect(safeReturnPath('/app')).toBe('/app');
  });

  it.each([
    ['//evil.example'],
    ['//evil.example/app'],
    ['/\\evil.example'],
    ['https://evil.example/app'],
    ['javascript:alert(1)'],
    ['app'],
    [''],
    [null],
    ['/app\n//evil'],
    ['/.//evil.example'],
    ['/./\\evil.example'],
    ['/a/..//evil.example'],
    ['/%2e//evil.example'],
  ])('rechaza %j', (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it('signInUrl solo incluye «volver» si es una ruta interna', () => {
    expect(signInUrl('/p/abc')).toBe('/?acceso=entrar&volver=%2Fp%2Fabc');
    expect(signInUrl('//evil.example')).toBe('/?acceso=entrar');
  });
});

describe('apiFetch', () => {
  it('envía la cookie, serializa el cuerpo y valida la respuesta con el esquema', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, extra: 'se descarta' }));
    const result = await apiFetch('/v1/cosas', { method: 'POST', body: { a: 1 }, schema: z.object({ ok: z.literal(true) }) });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API_ORIGIN}/v1/cosas`);
    expect(init?.credentials).toBe('include');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":1}');
  });

  it('convierte el error del servidor en ApiError con el mensaje traducido por código', async () => {
    fetchMock.mockResolvedValue(apiError('PROJECT_NOT_FOUND', 404));
    const error = await apiFetch('/v1/projects/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'PROJECT_NOT_FOUND', status: 404, requestId: 'req-1' });
    expect((error as ApiError).message).toBe('Este proyecto no existe o no tienes acceso.');
  });

  it('un cuerpo de error desconocido se trata como error interno', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }));
    await expect(apiFetch('/v1/x')).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('una respuesta que no cumple el esquema es BAD_RESPONSE', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: 'no' }));
    await expect(apiFetch('/v1/x', { schema: z.object({ ok: z.literal(true) }) })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('un 401 en página privada lleva al overlay con «volver» a la página actual', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(apiError('UNAUTHORIZED', 401));
    await expect(apiFetch('/v1/me')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(assign).toHaveBeenCalledWith(
      `/?acceso=entrar&volver=${encodeURIComponent('/p/0198c5d2-0000-7000-8000-000000000000?vista=capas')}`,
    );
  });

  it('un 401 con redirectOn401: false no navega', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(apiError('UNAUTHORIZED', 401));
    await expect(apiFetch('/v1/me', { redirectOn401: false })).rejects.toMatchObject({ status: 401 });
    expect(assign).not.toHaveBeenCalled();
  });

  it('un 429 muestra un aviso con la espera de Retry-After', async () => {
    fetchMock.mockResolvedValue(
      json(429, { error: { code: 'RATE_LIMITED', message: 'x', details: {}, requestId: 'r' } }, { 'retry-after': '12' }),
    );
    await expect(apiFetch('/v1/x')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(toasts.map((toast) => toast.message)).toEqual(['Demasiadas peticiones seguidas. Espera 12 s y vuelve a probar.']);
  });

  it('sin red avisa «Sin conexión» y ofrece reintentar si hay cómo', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const retry = vi.fn();
    await expect(apiFetch('/v1/x', { onRetry: retry })).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    expect(toasts[0]?.message).toMatch(/^Sin conexión/);
    toasts[0]?.action?.run();
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('cached', () => {
  it('reutiliza la lectura durante 30 s y olvida los errores', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('fallo')).mockResolvedValue('dato');
    await expect(cached('clave-prueba', load)).rejects.toThrow('fallo');
    await expect(cached('clave-prueba', load)).resolves.toBe('dato');
    await expect(cached('clave-prueba', load)).resolves.toBe('dato');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
