import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { DocHost } from '../engine/doc/host/DocHost.ts';
import type { MainMessage, OpenParams, WorkerMessage } from '../engine/doc/protocol.ts';
import { documentToJson, type DocumentJson } from '../shared/document/to-json.js';
import { deleteLocalCopy, listLocalCopies, localCopyName, parseLocalCopyName } from './local-copies.ts';

const UNSYNCED_KEY = 'unsyncedChanges';
// Pintar desde la copia local antes de que llegue el servidor, sin esperarla más de esto.
const LOCAL_COPY_WAIT_MS = 1_000;

type Logger = Pick<Console, 'warn' | 'error' | 'debug'>;

export type CollabHostOptions = {
  post: (message: MainMessage, transfer?: Transferable[]) => void;
  // Modo directo: DirectBackend pide los lotes al DocHost; si no, el DocHost los manda con crédito.
  direct?: boolean;
  logger?: Logger;
};

// El documento, su copia local, el proveedor y su Awareness: lo que corre en el worker del proyecto (o en el hilo
// principal si no hay worker). Habla con CollabSession por mensajes y nunca registra el token.
export class CollabHost {
  doc: Y.Doc | null = null;
  docHost: DocHost | null = null;
  // Por dónde pasa cada mensaje del WebSocket antes de aplicarse (en modo directo, la cola del frame).
  incoming: (task: () => void) => void = (task) => task();
  private provider: HocuspocusProvider | null = null;
  private persistence: IndexeddbPersistence | null = null;
  private params: OpenParams | null = null;
  private nextTokenId = 0;
  private readonly tokens = new Map<number, { resolve: (token: string) => void; reject: (error: Error) => void }>();
  // open y reset se hacen en orden aunque lleguen seguidos.
  private queue: Promise<void> = Promise.resolve();
  // Último documento descartado con cambios sin enviar (epoch nuevo), para «Descargar tu copia local».
  private discarded: DocumentJson | null = null;
  private destroyed = false;
  private readonly logger: Logger;

  constructor(private readonly options: CollabHostOptions) {
    this.logger = options.logger ?? console;
  }

  handle(message: WorkerMessage): void {
    if (this.destroyed) return;
    switch (message.t) {
      case 'open':
        this.enqueue(() => this.open(message));
        return;
      case 'reset':
        this.enqueue(() => this.reset(message));
        return;
      case 'token': {
        const pending = this.tokens.get(message.id);
        this.tokens.delete(message.id);
        if (!pending) return;
        if ('token' in message) pending.resolve(message.token);
        else pending.reject(new Error(message.error));
        return;
      }
      case 'reconnect':
        this.stopProvider();
        this.connect();
        return;
      case 'stop':
        this.stopProvider();
        return;
      case 'pagehide':
        this.provider?.pageHide();
        return;
      case 'local-snapshot': {
        const data = message.source === 'discarded' ? this.discarded : this.doc ? documentToJson(this.doc) : null;
        this.options.post({ t: 'local-snapshot', id: message.id, data });
        return;
      }
      case 'destroy':
        this.destroy();
        this.options.post({ t: 'destroyed' });
        return;
      default:
        this.docHost?.handle(message);
    }
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      this.options.post({ t: 'fatal', message: error instanceof Error ? error.message : 'No se pudo abrir el documento' });
    });
  }

  // Bases de epoch anteriores de este proyecto: se borran; avisa si tenían cambios sin enviar.
  async open(params: OpenParams): Promise<void> {
    this.params = params;
    const lost = await this.discardStaleCopies(params);
    await this.createDocument(params, lost);
    this.connect();
  }

  // Epoch nuevo: se descartan el Y.Doc y su copia local y se conecta con un documento vacío.
  async reset(params: OpenParams): Promise<void> {
    this.stopProvider();
    if (params.keepDiscarded && this.doc) this.discarded = documentToJson(this.doc);
    const persistence = this.persistence;
    this.persistence = null;
    if (persistence) await persistence.clearData().catch(() => {});
    this.docHost?.destroy();
    this.docHost = null;
    this.doc?.destroy();
    this.doc = null;
    if (this.destroyed) return;
    this.params = params;
    await this.createDocument(params, false);
    this.connect();
  }

  private async discardStaleCopies(params: OpenParams): Promise<boolean> {
    let lost = false;
    for (const name of await listLocalCopies()) {
      const parsed = parseLocalCopyName(name);
      if (!parsed || parsed.userId !== params.userId || parsed.projectId !== params.projectId || parsed.epoch === params.epoch) continue;
      if (await this.keepIfUnsynced(name)) lost = true;
      await deleteLocalCopy(name);
    }
    return lost;
  }

  // Si la base tenía cambios sin enviar, su contenido queda en `discarded` antes de borrarla.
  private async keepIfUnsynced(name: string): Promise<boolean> {
    const doc = new Y.Doc();
    const probe = new IndexeddbPersistence(name, doc);
    try {
      if (!(Number(await probe.get(UNSYNCED_KEY)) > 0)) return false;
      try {
        await probe.whenSynced;
        this.discarded = documentToJson(doc);
      } catch (error) {
        this.logger.warn('No se pudo leer la copia local descartada.', error instanceof Error ? error.message : error);
      }
      return true;
    } catch {
      return false;
    } finally {
      await probe.destroy();
      doc.destroy();
    }
  }

  private async createDocument(params: OpenParams, lostUnsynced: boolean): Promise<void> {
    const doc = new Y.Doc();
    this.doc = doc;
    let enabled = false;
    if (params.useLocal && typeof indexedDB !== 'undefined') {
      try {
        const persistence = new IndexeddbPersistence(localCopyName(params.userId, params.projectId, params.epoch), doc);
        this.persistence = persistence;
        await Promise.race([persistence.whenSynced, new Promise((resolve) => setTimeout(resolve, LOCAL_COPY_WAIT_MS))]);
        enabled = true;
      } catch (error) {
        this.logger.warn('Sin copia local: IndexedDB no está disponible.', error instanceof Error ? error.message : error);
        this.persistence = null;
      }
    }
    if (this.destroyed || this.doc !== doc) return;
    this.options.post({ t: 'local-copy', gen: params.gen, enabled, lostUnsynced });
    const post = this.options.post;
    this.docHost = new DocHost(doc, null, {
      gen: params.gen,
      logger: this.logger,
      reply: (message) => post(message),
      ...(this.options.direct ? {} : { post: (batch, transfer) => post(batch, transfer) }),
    });
    this.docHost.readOnly = params.role === 'viewer';
  }

  private requestToken(): Promise<string> {
    const id = ++this.nextTokenId;
    return new Promise((resolve, reject) => {
      this.tokens.set(id, { resolve, reject });
      this.options.post({ t: 'token-request', id });
    });
  }

  private connect(): void {
    const params = this.params;
    const doc = this.doc;
    const host = this.docHost;
    if (!params || !doc || !host || this.destroyed) return;
    const post = this.options.post;
    const provider = new HocuspocusProvider({
      url: params.url,
      name: params.documentName,
      document: doc,
      token: () => this.requestToken(),
      onAuthenticated: ({ scope }) => {
        host.readOnly = params.role === 'viewer' || scope === 'readonly';
        post({ t: 'authenticated', scope, unsynced: provider.unsyncedChanges });
      },
      onAuthenticationFailed: ({ reason }) => post({ t: 'auth-failed', reason }),
      onSynced: ({ state }) => host.setSynced(state),
      onStatus: ({ status }) => post({ t: 'status', status }),
      onClose: ({ event }) => post({ t: 'close', code: event.code, reason: event.reason }),
      onStateless: ({ payload }) => post({ t: 'stateless', payload }),
      onUnsyncedChanges: ({ number }) => {
        void this.persistence?.set(UNSYNCED_KEY, number).catch(() => {});
        post({ t: 'unsynced', number });
      },
    });
    this.provider = provider;
    // Cada mensaje del WebSocket pasa por `incoming`: en modo directo se aplica en el frame que lo pinta.
    const receive = provider.onMessage.bind(provider);
    provider.onMessage = (event: MessageEvent) => this.incoming(() => receive(event));
    host.setAwareness(provider.awareness);
  }

  private stopProvider(): void {
    const provider = this.provider;
    this.provider = null;
    this.docHost?.setAwareness(null);
    provider?.destroy();
    // Las peticiones de token del proveedor destruido ya no le sirven a nadie: rechazarlas lo haría avisar de un
    // fallo de autenticación.
    this.tokens.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopProvider();
    void this.persistence?.destroy();
    this.persistence = null;
    this.docHost?.destroy();
    this.docHost = null;
    this.doc?.destroy();
    this.doc = null;
  }
}
