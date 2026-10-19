import './worker-violations.ts';
import './zod-jitless.ts';
import type { MainMessage, WorkerMessage } from '../engine/doc/protocol.ts';
import { CollabHost } from './collab-host.ts';

const scope = self as unknown as {
  postMessage(message: MainMessage, options?: { transfer?: Transferable[] }): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerMessage>) => void): void;
  addEventListener(type: 'unhandledrejection', listener: (event: PromiseRejectionEvent) => void): void;
};

const post = (message: MainMessage, transfer: Transferable[] = []) => scope.postMessage(message, { transfer });
const fatal = (error: unknown) => post({ t: 'fatal', message: error instanceof Error ? error.message : String(error) });

const host = new CollabHost({ post });

scope.addEventListener('message', (event) => {
  try {
    host.handle(event.data);
  } catch (error) {
    fatal(error);
  }
});
// Un rechazo suelto (p. ej. de IndexedDB) no tumba el editor: lo que importa ya se gestiona donde ocurre.
scope.addEventListener('unhandledrejection', (event) => {
  console.error('Rechazo sin gestionar en el worker del documento', event.reason instanceof Error ? event.reason.message : event.reason);
});
post({ t: 'booted' });
