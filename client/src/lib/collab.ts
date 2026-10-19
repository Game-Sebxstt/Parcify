import { CollabTokenResponseSchema } from '../shared/api/projects.js';
import { DOCUMENT_SCHEMA_VERSION } from '../shared/document/schema.js';
import type { ProjectRole } from '../shared/permissions.js';
import { DirectBackend, LinkBackend, type BackendCallbacks, type DocumentBackend } from '../engine/doc/backend.ts';
import type { CollabToMain, LocalSnapshotSource, MainMessage, MainToCollab, OpenParams } from '../engine/doc/protocol.ts';
import type { DocumentJson } from '../shared/document/to-json.js';
import { Store } from '../engine/store.ts';
import { ApiError, apiFetch } from './api.ts';
import type { CollabHost } from './collab-host.ts';
import { localCopyEnabled } from './local-copies.ts';

export type CollabToken = {
  token: string;
  url: string;
  documentName: string;
  role: ProjectRole;
  user: { id: string; name: string; color: string };
  epoch: number;
};

export function fetchCollabToken(projectId: string): Promise<CollabToken> {
  return apiFetch(`/v1/projects/${projectId}/collab-token`, { method: 'POST', schema: CollabTokenResponseSchema });
}

// Estados de la cabecera (§5.8) y pantallas que cortan la edición.
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'compacting';

export type CollabFailure =
  | 'no_access'
  | 'project_deleted'
  | 'workspace_deleted'
  | 'client_outdated'
  | 'document_full'
  | 'too_many_tabs'
  | 'session_revoked'
  | 'unavailable'
  | 'engine_crashed';

export type CollabNotice = 'size_warning' | 'size_readonly' | 'node_limit' | 'offline_changes_rejected' | 'local_copy_discarded';

export type CollabState = {
  status: ConnectionStatus;
  failure: CollabFailure | null;
  readOnly: boolean;
  role: ProjectRole | null;
  localCopy: boolean;
  synced: boolean;
  notice: CollabNotice | null;
};

// Motivos de rechazo de onAuthenticate. null = transitorio o gestionado aparte (compacting, epoch_changed).
export function failureFromReason(reason: string): CollabFailure | null {
  switch (reason) {
    case 'no_access':
    case 'not_found':
      return 'no_access';
    case 'client_outdated':
    case 'document_full':
    case 'too_many_tabs':
    case 'session_revoked':
      return reason;
    case 'unavailable':
      return 'project_deleted';
    default:
      return null;
  }
}

// Cierres del servidor: 4410 corta (papelera); 4401 y 4409 reconectan con un token nuevo.
export function failureFromClose(code: number, reason: string): CollabFailure | null {
  if (code !== 4410) return null;
  return reason === 'workspace_deleted' ? 'workspace_deleted' : 'project_deleted';
}

export type EpochDecision = 'keep' | 'recreate' | 'recreate-offer-download';

// Mezclar historiales de dos epoch duplicaría el contenido: si cambia, el Y.Doc y su copia local se descartan.
export function epochDecision(current: number, next: number, hasUnsyncedChanges: boolean): EpochDecision {
  if (current === next) return 'keep';
  return hasUnsyncedChanges ? 'recreate-offer-download' : 'recreate';
}

const COMPACTING_RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
// Sin `booted` en este tiempo, el documento se abre en el hilo principal.
export const WORKER_BOOT_TIMEOUT_MS = 10_000;
// Tras pedir al worker que se cierre, se termina igualmente pasado este tiempo.
const WORKER_DESTROY_TIMEOUT_MS = 1_000;

class EpochChanged extends Error {
  constructor(readonly token: CollabToken) {
    super('epoch_changed');
  }
}

// Canal con el host del documento: un worker o, si no hay, el mismo hilo.
export interface CollabLink {
  // Abre (o reinicia con un epoch nuevo) el documento de una generación y devuelve su backend.
  start(kind: 'open' | 'reset', params: OpenParams, callbacks: BackendCallbacks): Promise<DocumentBackend>;
  send(message: MainToCollab): void;
  onMessage(handler: (message: CollabToMain) => void): void;
  // El host dejó de responder (error del worker o fallo interno).
  onCrash(handler: (message: string) => void): void;
  destroy(): Promise<void>;
}

class WorkerLink implements CollabLink {
  private backend: LinkBackend | null = null;
  private handler: (message: CollabToMain) => void = () => {};
  private crashHandler: (message: string) => void = () => {};
  private destroyed: (() => void) | null = null;

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', this.onWorkerMessage);
    worker.addEventListener('error', this.onWorkerError);
    worker.addEventListener('messageerror', this.onWorkerError);
  }

  private readonly onWorkerMessage = (event: MessageEvent) => {
    // Chromium deserializa al leer event.data: ese tiempo cuenta como aplicar el lote.
    const started = performance.now();
    const message = event.data as MainMessage;
    const readMs = performance.now() - started;
    switch (message.t) {
      case 'batch':
        this.backend?.receive(message, readMs);
        return;
      case 'pong':
        this.backend?.receivePong();
        return;
      case 'destroyed':
        this.destroyed?.();
        return;
      case 'fatal':
        this.crashHandler(message.message);
        return;
      default:
        this.handler(message);
    }
  };

  private readonly onWorkerError = (event: Event) => {
    event.preventDefault();
    this.crashHandler(event instanceof ErrorEvent && event.message ? event.message : 'Error en el worker del documento');
  };

  start(kind: 'open' | 'reset', params: OpenParams, callbacks: BackendCallbacks): Promise<DocumentBackend> {
    this.backend?.destroy();
    const backend = new LinkBackend(params.gen, (message) => this.worker.postMessage(message), callbacks);
    this.backend = backend;
    this.worker.postMessage({ t: kind, ...params } satisfies MainToCollab);
    return Promise.resolve(backend);
  }

  send(message: MainToCollab): void {
    this.worker.postMessage(message);
  }

  onMessage(handler: (message: CollabToMain) => void): void {
    this.handler = handler;
  }

  onCrash(handler: (message: string) => void): void {
    this.crashHandler = handler;
  }

  // El host cierra el proveedor y la copia local antes de que se termine el worker.
  async destroy(): Promise<void> {
    this.backend?.destroy();
    this.backend = null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, WORKER_DESTROY_TIMEOUT_MS);
      this.destroyed = () => {
        clearTimeout(timer);
        resolve();
      };
      this.worker.postMessage({ t: 'destroy' } satisfies MainToCollab);
    });
    this.worker.removeEventListener('message', this.onWorkerMessage);
    this.worker.removeEventListener('error', this.onWorkerError);
    this.worker.removeEventListener('messageerror', this.onWorkerError);
    this.worker.terminate();
  }
}

// Vuelta al hilo principal: el mismo host, con el plano del documento síncrono y el de colaboración en microtareas.
class DirectLink implements CollabLink {
  private handler: (message: CollabToMain) => void = () => {};
  private backend: DirectBackend | null = null;
  private readonly host: CollabHost;

  constructor(create: (post: (message: MainMessage) => void) => CollabHost) {
    this.host = create((message) => queueMicrotask(() => this.dispatch(message)));
  }

  private dispatch(message: MainMessage): void {
    if (message.t === 'batch' || message.t === 'pong' || message.t === 'destroyed') return;
    this.handler(message);
  }

  async start(kind: 'open' | 'reset', params: OpenParams, callbacks: BackendCallbacks): Promise<DocumentBackend> {
    this.backend?.destroy();
    this.backend = null;
    await (kind === 'open' ? this.host.open(params) : this.host.reset(params));
    const docHost = this.host.docHost;
    if (!docHost) throw new Error('El documento no se pudo abrir');
    const backend = new DirectBackend(docHost, params.gen, callbacks);
    this.host.incoming = (task) => backend.inbox.enqueue(task);
    this.backend = backend;
    return backend;
  }

  send(message: MainToCollab): void {
    queueMicrotask(() => this.host.handle(message));
  }

  onMessage(handler: (message: CollabToMain) => void): void {
    this.handler = handler;
  }

  onCrash(): void {}

  async destroy(): Promise<void> {
    this.backend?.destroy();
    this.backend = null;
    this.host.destroy();
  }
}

async function bootWorker(): Promise<Worker | string> {
  if (typeof Worker !== 'function') return 'el navegador no tiene Worker';
  let worker: Worker;
  try {
    worker = new Worker(new URL('./collab.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    return error instanceof Error ? error.message : 'no se pudo crear';
  }
  const failure = await new Promise<string | null>((resolve) => {
    const finish = (result: string | null) => {
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if ((event.data as MainMessage | undefined)?.t === 'booted') finish(null);
    };
    const onError = (event: Event) => {
      event.preventDefault();
      finish(event instanceof ErrorEvent && event.message ? event.message : 'no arrancó');
    };
    const timer = setTimeout(() => finish('no respondió a tiempo'), WORKER_BOOT_TIMEOUT_MS);
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
  });
  if (failure === null) return worker;
  worker.terminate();
  return failure;
}

let warnedDirect = false;

// El documento en un worker; sin Worker, o si no arranca, en el hilo principal con el mismo código.
export async function openCollabLink(): Promise<CollabLink> {
  const worker = await bootWorker();
  if (typeof worker !== 'string') return new WorkerLink(worker);
  if (!warnedDirect) {
    warnedDirect = true;
    console.warn(`El editor trabaja sin worker: ${worker}.`);
  }
  const { CollabHost } = await import('./collab-host.ts');
  return new DirectLink((post) => new CollabHost({ post, direct: true }));
}

export type CollabEvents = {
  // El documento se ha sustituido (epoch nuevo): hay que volver a montar el motor sobre el backend nuevo.
  reset: (backend: DocumentBackend) => void;
  stateless: (message: Record<string, unknown>) => void;
};

export type CollabOpenOptions = {
  link?: () => Promise<CollabLink>;
  fetchToken?: (projectId: string) => Promise<CollabToken>;
};

export class CollabSession {
  readonly state: Store<CollabState>;
  // Documento de la generación actual: no cambia dentro de una generación.
  backend!: DocumentBackend;
  private token: CollabToken;
  private epoch: number;
  private gen = 0;
  private unsynced = 0;
  private pendingToken: CollabToken | null;
  private tokenError: unknown = null;
  private destroyed = false;
  private everConnected = false;
  private compactingAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private nextSnapshotId = 0;
  private readonly snapshots = new Map<number, (data: DocumentJson | null) => void>();
  private readonly fetchToken: (projectId: string) => Promise<CollabToken>;
  private readonly listeners: { [K in keyof CollabEvents]: Set<CollabEvents[K]> } = { reset: new Set(), stateless: new Set() };

  private constructor(
    readonly projectId: string,
    token: CollabToken,
    private readonly link: CollabLink,
    fetchToken: (projectId: string) => Promise<CollabToken>,
  ) {
    this.token = token;
    this.epoch = token.epoch;
    this.pendingToken = token;
    this.fetchToken = fetchToken;
    this.state = new Store<CollabState>({
      status: 'connecting',
      failure: null,
      readOnly: token.role === 'viewer',
      role: token.role,
      localCopy: false,
      synced: false,
      notice: null,
    });
    link.onMessage((message) => this.handleMessage(message));
    link.onCrash((message) => this.crashed(message));
  }

  // Pide el primer token (rol, usuario y epoch), arranca el host y abre el documento. No resuelve hasta que el
  // worker arrancó o se volvió al hilo principal.
  static async open(projectId: string, options: CollabOpenOptions = {}): Promise<CollabSession> {
    const fetchToken = options.fetchToken ?? fetchCollabToken;
    const token = await fetchToken(projectId);
    const link = await (options.link ?? openCollabLink)();
    const session = new CollabSession(projectId, token, link, fetchToken);
    try {
      session.backend = await link.start('open', session.openParams(), session.callbacks());
    } catch (error) {
      await link.destroy();
      throw error;
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', session.handleNetwork);
      window.addEventListener('offline', session.handleNetwork);
      window.addEventListener('pagehide', session.handlePageHide);
    }
    return session;
  }

  get user(): CollabToken['user'] {
    return this.token.user;
  }

  get role(): ProjectRole {
    return this.token.role;
  }

  on<K extends keyof CollabEvents>(event: K, listener: CollabEvents[K]): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  private patch(state: Partial<CollabState>): void {
    this.state.set({ ...this.state.get(), ...state });
  }

  dismissNotice(): void {
    this.patch({ notice: null });
  }

  // Contenido de la copia local como document.json: el documento abierto (permiso perdido) o el descartado por
  // un epoch nuevo. null si ya no existe.
  localSnapshot(source: LocalSnapshotSource): Promise<DocumentJson | null> {
    if (this.destroyed) return Promise.resolve(null);
    const id = ++this.nextSnapshotId;
    return new Promise((resolve) => {
      this.snapshots.set(id, resolve);
      this.link.send({ t: 'local-snapshot', id, source });
    });
  }

  private openParams(keepDiscarded = false): OpenParams {
    const base = this.token.url.replace(/\/+$/, '');
    return {
      ...(keepDiscarded ? { keepDiscarded } : {}),
      gen: ++this.gen,
      url: `${base}/?schemaVersion=${DOCUMENT_SCHEMA_VERSION}`,
      documentName: this.token.documentName,
      userId: this.token.user.id,
      projectId: this.projectId,
      epoch: this.epoch,
      role: this.token.role,
      useLocal: this.token.role !== 'viewer' && localCopyEnabled(),
    };
  }

  private callbacks(): BackendCallbacks {
    return {
      onSynced: (synced) => this.patch({ synced }),
      onCrash: (message) => this.crashed(message),
    };
  }

  private handleMessage(message: CollabToMain): void {
    if (this.destroyed) return;
    switch (message.t) {
      case 'token-request':
        void this.answerToken(message.id);
        return;
      case 'authenticated': {
        this.everConnected = true;
        this.compactingAttempt = 0;
        this.unsynced = message.unsynced;
        const readOnly = message.scope === 'readonly';
        this.patch({
          status: 'connected',
          readOnly,
          failure: null,
          ...(readOnly && this.state.get().role !== 'viewer' && message.unsynced > 0 ? { notice: 'offline_changes_rejected' as const } : {}),
        });
        return;
      }
      case 'auth-failed':
        this.handleRejection(message.reason);
        return;
      case 'status':
        this.handleStatus(message.status);
        return;
      case 'close':
        this.handleClose(message.code, message.reason);
        return;
      case 'stateless':
        this.handleStateless(message.payload);
        return;
      case 'unsynced':
        this.unsynced = message.number;
        return;
      case 'local-copy':
        if (message.gen !== this.gen) return;
        this.patch({ localCopy: message.enabled, ...(message.lostUnsynced ? { notice: 'local_copy_discarded' as const } : {}) });
        return;
      case 'local-snapshot':
        this.snapshots.get(message.id)?.(message.data);
        this.snapshots.delete(message.id);
        return;
      case 'booted':
      case 'destroyed':
        return;
      case 'fatal':
        this.crashed(message.message);
        return;
      default:
        console.warn(`Mensaje desconocido del documento: ${(message as { t?: unknown }).t}`);
    }
  }

  // Toda petición de token recibe respuesta: el token, o el error que el proveedor convierte en un rechazo.
  private async answerToken(id: number): Promise<void> {
    try {
      const token = await this.nextToken();
      if (!this.destroyed) this.link.send({ t: 'token', id, token });
    } catch (error) {
      if (!this.destroyed) this.link.send({ t: 'token', id, error: error instanceof EpochChanged ? 'epoch_changed' : 'fetch_failed' });
    }
  }

  // El primer token ya se pidió en open(); cada reconexión pide uno nuevo y compara su epoch.
  private async nextToken(): Promise<string> {
    let token = this.pendingToken;
    this.pendingToken = null;
    this.tokenError = null;
    if (!token) {
      try {
        token = await this.fetchToken(this.projectId);
      } catch (error) {
        this.tokenError = error;
        throw error;
      }
    }
    if (epochDecision(this.epoch, token.epoch, false) !== 'keep') throw new EpochChanged(token);
    this.token = token;
    return token.token;
  }

  private handleRejection(reason: string): void {
    if (this.destroyed) return;
    // El proveedor convierte el error del token en un rechazo con este texto.
    if (reason.includes('epoch_changed')) {
      void this.resetDocument();
      return;
    }
    if (reason === 'compacting') {
      this.patch({ status: 'compacting' });
      this.retryLater();
      return;
    }
    if (reason.includes('Failed to get token')) {
      const error = this.tokenError;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) this.fail('no_access');
      else this.retryLater();
      return;
    }
    const failure = failureFromReason(reason);
    if (failure) this.fail(failure);
    else this.retryLater();
  }

  private handleClose(code: number, reason: string): void {
    const failure = failureFromClose(code, reason);
    if (failure) this.fail(failure);
  }

  private handleStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    if (this.destroyed || this.state.get().failure) return;
    if (status === 'connected') return;
    if (status === 'disconnected') {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.patch({ status: offline ? 'offline' : this.everConnected ? 'reconnecting' : 'connecting' });
    } else if (this.state.get().status !== 'compacting') {
      this.patch({ status: this.everConnected ? 'reconnecting' : 'connecting' });
    }
  }

  // El proveedor tarda en notar que no hay red; el navegador lo avisa antes.
  private readonly handleNetwork = () => {
    if (this.state.get().failure) return;
    if (navigator.onLine === false) this.patch({ status: 'offline' });
    else if (this.state.get().status === 'offline') this.patch({ status: 'reconnecting' });
  };

  // El worker no ve la ventana: la presencia propia se retira al cerrar la pestaña.
  private readonly handlePageHide = () => {
    this.link.send({ t: 'pagehide' });
  };

  private handleStateless(payload: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === 'limit') {
      if (message.what === 'size') this.patch({ readOnly: true, notice: 'size_readonly' });
      else if (message.what === 'size_warning') this.patch({ notice: 'size_warning' });
      else this.patch({ notice: 'node_limit' });
    }
    for (const listener of this.listeners.stateless) listener(message);
  }

  private fail(failure: CollabFailure): void {
    this.patch({ failure, status: 'offline' });
    this.link.send({ t: 'stop' });
  }

  // Lo que no se llegó a enviar sigue en la copia local, si está activa.
  private crashed(message: string): void {
    if (this.destroyed || this.state.get().failure === 'engine_crashed') return;
    console.error(`El editor dejó de responder: ${message}`);
    this.fail('engine_crashed');
  }

  // Rechazos transitorios: se vuelve a intentar con un proveedor nuevo y espera creciente.
  private retryLater(): void {
    if (this.retryTimer || this.destroyed) return;
    const delay = COMPACTING_RETRY_MS[Math.min(this.compactingAttempt++, COMPACTING_RETRY_MS.length - 1)]!;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.destroyed || this.state.get().failure) return;
      this.link.send({ t: 'reconnect' });
    }, delay);
  }

  // Epoch nuevo: el host descarta el Y.Doc y su copia local y conecta con un documento vacío, en una generación
  // nueva con su propio backend.
  private async resetDocument(): Promise<void> {
    if (this.destroyed) return;
    const token = await this.fetchToken(this.projectId).catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) this.fail('no_access');
      else this.retryLater();
      return null;
    });
    if (!token || this.destroyed) return;
    const decision = epochDecision(this.epoch, token.epoch, this.unsynced > 0);
    this.backend.destroy();
    this.token = token;
    this.epoch = token.epoch;
    this.pendingToken = token;
    this.everConnected = false;
    this.unsynced = 0;
    if (decision === 'recreate-offer-download') this.patch({ notice: 'local_copy_discarded' });
    let backend: DocumentBackend;
    try {
      backend = await this.link.start('reset', this.openParams(decision === 'recreate-offer-download'), this.callbacks());
    } catch (error) {
      this.crashed(error instanceof Error ? error.message : 'No se pudo reiniciar el documento');
      return;
    }
    if (this.destroyed) return;
    this.backend = backend;
    for (const listener of this.listeners.reset) listener(backend);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleNetwork);
      window.removeEventListener('offline', this.handleNetwork);
      window.removeEventListener('pagehide', this.handlePageHide);
    }
    this.backend?.destroy();
    void this.link.destroy();
    for (const set of Object.values(this.listeners)) set.clear();
    for (const resolve of this.snapshots.values()) resolve(null);
    this.snapshots.clear();
  }
}
