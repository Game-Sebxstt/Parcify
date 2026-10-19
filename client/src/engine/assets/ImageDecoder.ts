import { fetchBitmap } from './decodeImage.ts';
import { TextureLoadError } from './TextureManager.ts';

export type DecodeRequest = { kind: 'load'; id: number; url: string } | { kind: 'abort'; id: number };
// `status` 0: error de red o de decodificación.
export type DecodeReply = { id: number; bitmap: ImageBitmap } | { id: number; status: number };

type Pending = { url: string; signal: AbortSignal; resolve: (bitmap: ImageBitmap) => void; reject: (error: unknown) => void };

// Descarga y decodifica las imágenes en un worker. En el hilo principal cada carga esperaba a que acabara el frame
// en curso tres veces (respuesta, cuerpo y bitmap); desde el worker solo una, al recibir el bitmap. Sin workers, o
// si el worker no arranca, se hace en el hilo principal.
export class ImageDecoder {
  private worker: Worker | null | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  decode(url: string, signal: AbortSignal): Promise<ImageBitmap> {
    const worker = this.ensureWorker();
    if (!worker) return fetchBitmap(url, signal);
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const onAbort = () => {
        this.pending.delete(id);
        worker.postMessage({ kind: 'abort', id } satisfies DecodeRequest);
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      const settle = () => signal.removeEventListener('abort', onAbort);
      this.pending.set(id, {
        url,
        signal,
        resolve: (bitmap) => {
          settle();
          resolve(bitmap);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      });
      worker.postMessage({ kind: 'load', id, url } satisfies DecodeRequest);
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    if (typeof Worker === 'undefined') return (this.worker = null);
    try {
      this.worker = new Worker(new URL('./imageDecoder.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return (this.worker = null);
    }
    this.worker.addEventListener('message', this.onMessage);
    this.worker.addEventListener('error', this.onError);
    return this.worker;
  }

  private readonly onMessage = (event: MessageEvent<DecodeReply>) => {
    const message = event.data;
    const pending = this.pending.get(message.id);
    if (!pending) {
      // La carga se canceló mientras el worker terminaba.
      if ('bitmap' in message) message.bitmap.close();
      return;
    }
    this.pending.delete(message.id);
    if ('bitmap' in message) pending.resolve(message.bitmap);
    else if (message.status) pending.reject(new TextureLoadError(message.status));
    else this.retryHere(pending);
  };

  // Sin respuesta HTTP desde el worker (red, CSP o decodificación): se intenta en el hilo principal. Si ahí sí
  // carga, el worker no sirve en esta página y todo pasa al hilo principal.
  private retryHere(pending: Pending): void {
    fetchBitmap(pending.url, pending.signal).then(
      (bitmap) => {
        pending.resolve(bitmap);
        if (this.worker) this.onError();
      },
      pending.reject,
    );
  }

  // El worker no arrancó: lo pendiente y lo que venga se carga en el hilo principal.
  private readonly onError = () => {
    this.stopWorker();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const item of pending) fetchBitmap(item.url, item.signal).then(item.resolve, item.reject);
  };

  private stopWorker(): void {
    if (!this.worker) return;
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.terminate();
    this.worker = null;
  }

  destroy(): void {
    this.stopWorker();
    for (const item of this.pending.values()) item.reject(new Error('Cargador destruido'));
    this.pending.clear();
  }
}
