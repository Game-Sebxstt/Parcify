import { INBOX_MAX_DELAY_MS, RemoteInbox } from '../model/RemoteInbox.ts';
import { realTimers, type Timers } from '../presence/throttle.ts';
import type { DocBatch, MainToHost } from './protocol.ts';

export type BackendConsumer = {
  apply(batch: DocBatch): void;
  // Hay lotes esperando: el motor pide un frame.
  wake(): void;
  pong?(): void;
};

// Lo que el motor sabe del documento: manda mensajes al host y aplica sus lotes al principio de su frame. Un backend
// es una generación del documento (un epoch) y admite un solo motor en toda su vida.
export interface DocumentBackend {
  readonly gen: number;
  // El lote full está en la cola; rechaza si el backend muere antes.
  readonly ready: Promise<void>;
  // Sin efecto tras destroy().
  send(message: MainToHost): void;
  attach(consumer: BackendConsumer): () => void;
  // Hay algo que vaciar: los comandos leen a menudo y no deben pagar un drain vacío.
  readonly queued: boolean;
  // Aplica la cola con el consumidor; sin consumidor, 0.
  drain(): number;
  // Tiempo gastado en leer los mensajes recibidos desde la última llamada (el navegador deserializa al leerlos).
  takeReadMs(): number;
  // El motor ya aplicó y pintó lo sincronizado.
  synced(value: boolean): void;
  // El host dejó de responder.
  crash(message: string): void;
  destroy(): void;
}

export type BackendCallbacks = {
  onSynced?: (synced: boolean) => void;
  onCrash?: (message: string) => void;
};

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  // Quien no espere `ready` no debe ver un rechazo sin gestionar.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

// Host en un worker: los lotes llegan por mensajes y se aplican al principio del frame. Devuelve el crédito al
// host después de aplicar cada lote, así que como mucho hay uno en vuelo.
export class LinkBackend implements DocumentBackend {
  readonly ready: Promise<void>;
  private readonly readyControl: ReturnType<typeof deferred>;
  private queue: DocBatch[] = [];
  private consumer: BackendConsumer | null = null;
  private attached = false;
  private timer: unknown = null;
  private readMs = 0;
  private gotFull = false;
  private destroyed = false;

  constructor(
    readonly gen: number,
    private readonly post: (message: MainToHost) => void,
    private readonly callbacks: BackendCallbacks = {},
    private readonly timers: Timers = realTimers,
    private readonly maxDelayMs = INBOX_MAX_DELAY_MS,
  ) {
    this.readyControl = deferred();
    this.ready = this.readyControl.promise;
  }

  // Un lote de otra generación se descarta.
  receive(batch: DocBatch, readMs = 0): void {
    if (this.destroyed || batch.gen !== this.gen) return;
    this.readMs += readMs;
    if (!this.gotFull) {
      if (!batch.full) return;
      this.gotFull = true;
      this.queue.push(batch);
      this.readyControl.resolve();
    } else {
      this.queue.push(batch);
    }
    if (!this.consumer || this.queue.length > 1) return;
    this.consumer.wake();
    this.timer ??= this.timers.setTimeout(() => {
      this.timer = null;
      this.drain();
    }, this.maxDelayMs);
  }

  receivePong(): void {
    this.consumer?.pong?.();
  }

  get queued(): boolean {
    return this.queue.length > 0;
  }

  send(message: MainToHost): void {
    if (!this.destroyed) this.post(message);
  }

  attach(consumer: BackendConsumer): () => void {
    if (this.attached) throw new Error('El backend ya tiene un motor');
    this.attached = true;
    this.consumer = consumer;
    if (this.queue.length) consumer.wake();
    return () => {
      if (this.consumer === consumer) this.consumer = null;
      this.clearTimer();
    };
  }

  drain(): number {
    this.clearTimer();
    const consumer = this.consumer;
    if (!consumer || this.destroyed || this.queue.length === 0) return 0;
    const batches = this.queue;
    this.queue = [];
    for (const batch of batches) {
      consumer.apply(batch);
      this.post({ t: 'consumed' });
    }
    return batches.length;
  }

  takeReadMs(): number {
    const ms = this.readMs;
    this.readMs = 0;
    return ms;
  }

  synced(value: boolean): void {
    if (!this.destroyed) this.callbacks.onSynced?.(value);
  }

  crash(message: string): void {
    if (this.destroyed) return;
    this.readyControl.reject(new Error(message));
    this.callbacks.onCrash?.(message);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimer();
    this.queue = [];
    this.consumer = null;
    this.readyControl.reject(new Error('Backend destruido'));
  }
}

// Lo que DirectBackend necesita del host (DocHost), sin importarlo: así este módulo no arrastra Yjs.
export type DirectHost = {
  handle(message: MainToHost): void;
  take(): DocBatch | null;
  onPending: () => void;
};

// Host en el mismo hilo (sin worker, la landing y las pruebas): los mensajes se procesan en el acto y los lotes se
// piden al vaciar. `inbox` retiene los mensajes del servidor hasta el frame, como hacía el editor sin worker.
export class DirectBackend implements DocumentBackend {
  readonly ready = Promise.resolve();
  readonly inbox: RemoteInbox;
  private consumer: BackendConsumer | null = null;
  private attached = false;
  private detachInbox: () => void = () => {};
  private hostPending = true;
  private destroyed = false;

  constructor(
    private readonly host: DirectHost,
    readonly gen = 1,
    private readonly callbacks: BackendCallbacks = {},
    inbox: RemoteInbox = new RemoteInbox(),
  ) {
    this.inbox = inbox;
    // Un cambio que no pasó por la cola (Awareness, IndexedDB, un update aplicado a mano) también despierta al motor.
    host.onPending = () => {
      this.hostPending = true;
      this.consumer?.wake();
    };
  }

  send(message: MainToHost): void {
    if (!this.destroyed) this.host.handle(message);
  }

  attach(consumer: BackendConsumer): () => void {
    if (this.attached) throw new Error('El backend ya tiene un motor');
    this.attached = true;
    this.consumer = consumer;
    this.detachInbox = this.inbox.attach(() => consumer.wake());
    return () => {
      if (this.consumer !== consumer) return;
      this.consumer = null;
      this.detachInbox();
    };
  }

  get queued(): boolean {
    return this.hostPending || this.inbox.pending > 0;
  }

  drain(): number {
    const consumer = this.consumer;
    if (!consumer || this.destroyed) return 0;
    this.inbox.drain();
    this.hostPending = false;
    const batch = this.host.take();
    if (!batch) return 0;
    consumer.apply(batch);
    return 1;
  }

  takeReadMs(): number {
    return 0;
  }

  synced(value: boolean): void {
    if (!this.destroyed) this.callbacks.onSynced?.(value);
  }

  crash(message: string): void {
    if (!this.destroyed) this.callbacks.onCrash?.(message);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.consumer = null;
    this.detachInbox();
    this.inbox.clear();
    this.host.onPending = () => {};
  }
}
