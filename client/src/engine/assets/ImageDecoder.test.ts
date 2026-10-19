import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageDecoder, type DecodeReply, type DecodeRequest } from './ImageDecoder.ts';
import { TextureLoadError } from './TextureManager.ts';

class FakeWorker extends EventTarget {
  static last: FakeWorker | null = null;
  readonly sent: DecodeRequest[] = [];
  terminated = false;
  constructor() {
    super();
    FakeWorker.last = this;
  }
  postMessage(message: DecodeRequest): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(message: DecodeReply): void {
    this.dispatchEvent(new MessageEvent('message', { data: message }));
  }
}

const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;

describe('ImageDecoder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.last = null;
  });

  it('pide la imagen al worker y devuelve su bitmap o el estado HTTP', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const decoder = new ImageDecoder();
    const ok = decoder.decode('https://cdn/a.png', new AbortController().signal);
    const denied = decoder.decode('https://cdn/b.png', new AbortController().signal);
    const worker = FakeWorker.last!;
    expect(worker.sent).toEqual([
      { kind: 'load', id: 1, url: 'https://cdn/a.png' },
      { kind: 'load', id: 2, url: 'https://cdn/b.png' },
    ]);
    const image = bitmap();
    worker.reply({ id: 1, bitmap: image });
    worker.reply({ id: 2, status: 403 });
    await expect(ok).resolves.toBe(image);
    const error = await denied.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TextureLoadError);
    expect((error as TextureLoadError).status).toBe(403);
  });

  it('una carga cancelada avisa al worker y cierra el bitmap que llegue tarde', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const decoder = new ImageDecoder();
    const controller = new AbortController();
    const load = decoder.decode('https://cdn/a.png', controller.signal);
    controller.abort();
    await expect(load).rejects.toBeDefined();
    const worker = FakeWorker.last!;
    expect(worker.sent.at(-1)).toEqual({ kind: 'abort', id: 1 });
    const late = bitmap();
    worker.reply({ id: 1, bitmap: late });
    expect(late.close).toHaveBeenCalled();
  });

  it('si el worker no consigue la imagen (red o CSP) se intenta en el hilo principal, y si ahí carga se deja el worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const image = bitmap();
    const fetchMock = vi.fn(async () => new Response(new Blob(['x']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => image));
    const decoder = new ImageDecoder();
    const first = decoder.decode('/_astro/a.png', new AbortController().signal);
    const second = decoder.decode('/_astro/b.png', new AbortController().signal);
    const worker = FakeWorker.last!;
    worker.reply({ id: 1, status: 0 });
    await expect(first).resolves.toBe(image);
    await expect(second).resolves.toBe(image);
    expect(worker.terminated).toBe(true);
    await expect(decoder.decode('/_astro/c.png', new AbortController().signal)).resolves.toBe(image);
    expect(worker.sent.filter((message) => message.kind === 'load')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('si el worker no arranca, lo pendiente se carga en el hilo principal', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const image = bitmap();
    const fetchMock = vi.fn(async () => new Response(new Blob(['x']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => image));
    const decoder = new ImageDecoder();
    const load = decoder.decode('https://cdn/a.png', new AbortController().signal);
    const worker = FakeWorker.last!;
    worker.dispatchEvent(new Event('error'));
    await expect(load).resolves.toBe(image);
    expect(worker.terminated).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://cdn/a.png', expect.objectContaining({ credentials: 'omit' }));
  });
});
