import { fetchBitmap } from './decodeImage.ts';
import { TextureLoadError } from './TextureManager.ts';
import type { DecodeReply, DecodeRequest } from './ImageDecoder.ts';

const controllers = new Map<number, AbortController>();

const reply = (message: DecodeReply, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

self.addEventListener('message', (event: MessageEvent<DecodeRequest>) => {
  const message = event.data;
  if (message.kind === 'abort') {
    controllers.get(message.id)?.abort();
    return;
  }
  const { id, url } = message;
  const controller = new AbortController();
  controllers.set(id, controller);
  fetchBitmap(url, controller.signal).then(
    (bitmap) => {
      controllers.delete(id);
      reply({ id, bitmap }, [bitmap]);
    },
    (error: unknown) => {
      controllers.delete(id);
      reply({ id, status: error instanceof TextureLoadError ? error.status : 0 });
    },
  );
});
