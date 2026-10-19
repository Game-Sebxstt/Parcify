import type {
  afterStoreDocumentPayload,
  beforeHandleAwarenessPayload,
  beforeHandleMessagePayload,
  connectedPayload,
  Extension,
  Hocuspocus,
  onConfigurePayload,
  onConnectPayload,
  onDisconnectPayload,
  onStatelessPayload,
} from '@hocuspocus/server';
import * as decoding from 'lib0/decoding';
import type { Logger } from 'pino';
import { publishProjectEvent } from '../../core/events.js';
import type { Redis } from '../../core/redis.js';
import { PresenceStateSchema } from '../../shared/document/keys.js';
import { COLLAB_LIMITS, DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import type { CollabMetrics } from '../metrics.js';
import {
  CLOSE,
  closeConnection,
  connectionsOf,
  Rejection,
  sendStateless,
  TokenBucket,
  type CollabConnection,
  type CollabContext,
  type CollabRuntime,
} from '../state.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const PENDING_TTL_MS = 15_000;
const PresencePartialSchema = PresenceStateSchema.partial();

interface PendingConnection {
  documentName: string;
  userId: string | null;
  at: number;
}

export interface GuardOptions {
  maxConnectionsPerDocument: number;
  maxConnectionsPerUser?: number;
}

function messageType(update: Uint8Array): number | null {
  try {
    const decoder = decoding.createDecoder(update);
    decoding.readVarString(decoder);
    return decoding.readVarUint(decoder);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Límites de conexiones, mensajes y Awareness, strikes y paso a solo lectura por tamaño.
export class GuardExtension implements Extension {
  extensionName = 'guard';
  priority = 800;

  private instance: Hocuspocus | null = null;
  private readonly pending = new Map<string, PendingConnection>();
  private readonly updateBuckets = new Map<string, TokenBucket>();
  private readonly awarenessBuckets = new Map<string, TokenBucket>();
  private readonly maxPerUser: number;

  constructor(
    private readonly deps: {
      runtime: CollabRuntime;
      redis: Redis;
      logger: Logger;
      metrics: CollabMetrics;
      options: GuardOptions;
    },
  ) {
    this.maxPerUser = deps.options.maxConnectionsPerUser ?? COLLAB_LIMITS.maxConnectionsPerUserPerDocument;
  }

  async onConfigure({ instance }: onConfigurePayload): Promise<void> {
    this.instance = instance;
  }

  private purgePending(now = Date.now()) {
    for (const [socketId, entry] of this.pending) {
      if (now - entry.at > PENDING_TTL_MS) this.pending.delete(socketId);
    }
  }

  private pendingFor(documentName: string, except?: string): PendingConnection[] {
    return [...this.pending.entries()]
      .filter(([socketId, entry]) => entry.documentName === documentName && socketId !== except)
      .map(([, entry]) => entry);
  }

  async onConnect({ documentName, socketId }: onConnectPayload): Promise<void> {
    this.purgePending();
    const document = this.instance?.documents.get(documentName);
    const open = (document?.connections.size ?? 0) + this.pendingFor(documentName, socketId).length;
    if (open >= this.deps.options.maxConnectionsPerDocument) {
      this.deps.logger.info({ documentName, socketId }, 'Documento lleno');
      this.deps.metrics.rejections.inc({ reason: 'document_full' });
      throw new Rejection('document_full');
    }
    this.pending.set(socketId, { documentName, userId: null, at: Date.now() });
  }

  // La llama AuthExtension cuando ya conoce al usuario, antes de registrar la conexión en Redis.
  admit(documentName: string, socketId: string, userId: string): void {
    const document = this.instance?.documents.get(documentName);
    const open = document ? connectionsOf(document, (connection) => connection.context?.userId === userId).length : 0;
    const waiting = this.pendingFor(documentName, socketId).filter((entry) => entry.userId === userId).length;
    if (open + waiting >= this.maxPerUser) throw new Rejection('too_many_tabs');
    const entry = this.pending.get(socketId);
    if (entry) entry.userId = userId;
    else this.pending.set(socketId, { documentName, userId, at: Date.now() });
  }

  release(socketId: string): void {
    this.pending.delete(socketId);
  }

  async connected({ socketId }: connectedPayload<CollabContext>): Promise<void> {
    this.release(socketId);
  }

  async onDisconnect({ socketId }: onDisconnectPayload): Promise<void> {
    this.pending.delete(socketId);
    this.updateBuckets.delete(socketId);
    this.awarenessBuckets.delete(socketId);
    this.deps.runtime.strikes.forget(socketId);
  }

  async beforeHandleMessage({
    connection,
    update,
    documentName,
    context,
  }: beforeHandleMessagePayload<CollabContext>): Promise<void> {
    if (update.byteLength > DOCUMENT_LIMITS.maxMessageBytes) {
      this.deps.logger.warn({ documentName, userId: context?.userId, socketId: connection.socketId }, 'Mensaje demasiado grande');
      closeConnection(connection, CLOSE.messageTooBig);
      throw new Rejection('unavailable');
    }
    const type = messageType(update);
    if (type === MESSAGE_AWARENESS) return;
    let bucket = this.updateBuckets.get(connection.socketId);
    if (!bucket) {
      bucket = new TokenBucket(COLLAB_LIMITS.updatesPerSecond, COLLAB_LIMITS.updatesBurst);
      this.updateBuckets.set(connection.socketId, bucket);
    }
    if (!bucket.take()) {
      this.deps.logger.warn({ documentName, userId: context?.userId, socketId: connection.socketId }, 'Demasiados mensajes');
      closeConnection(connection, CLOSE.rateLimited);
      throw new Rejection('unavailable');
    }
    if (type === MESSAGE_SYNC && connection.readOnly) {
      this.deps.logger.debug({ documentName, userId: context?.userId, socketId: connection.socketId }, 'Mensaje de sincronización en una conexión de solo lectura');
    }
  }

  async beforeHandleAwareness({
    connection,
    document,
    states,
    removedClients,
    documentName,
  }: beforeHandleAwarenessPayload<CollabContext>): Promise<void> {
    if (!connection) return;
    const context = connection.context;
    const own = document.getClients(connection);

    let bucket = this.awarenessBuckets.get(connection.socketId);
    if (!bucket) {
      bucket = new TokenBucket(COLLAB_LIMITS.awarenessPerSecond, COLLAB_LIMITS.awarenessPerSecond);
      this.awarenessBuckets.set(connection.socketId, bucket);
    }
    if (!bucket.take()) {
      states.clear();
      for (const clientId of removedClients) if (!own.has(clientId)) removedClients.delete(clientId);
      return;
    }

    const others = (document.getConnections() as CollabConnection[]).filter((other) => other !== connection);
    for (const [clientId, state] of states) {
      if (others.some((other) => document.getClients(other).has(clientId))) {
        states.delete(clientId);
        continue;
      }
      const bytes = Buffer.byteLength(JSON.stringify(state));
      if (bytes > DOCUMENT_LIMITS.maxAwarenessBytes) {
        this.deps.logger.debug({ documentName, userId: context?.userId, socketId: connection.socketId, bytes }, 'Awareness descartado por tamaño');
        states.delete(clientId);
        continue;
      }
      const user = isRecord(state.user) ? state.user : {};
      const avatar = typeof user.avatarAssetId === 'string' ? user.avatarAssetId : null;
      state.user = { ...user, id: context.userId, name: context.name, color: context.color, avatarAssetId: avatar };
      if (!PresencePartialSchema.safeParse(state).success) {
        state.user = { id: context.userId, name: context.name, color: context.color, avatarAssetId: null };
        if (!PresencePartialSchema.safeParse(state).success) states.delete(clientId);
      }
    }
    for (const clientId of removedClients) if (!own.has(clientId)) removedClients.delete(clientId);
  }

  async onStateless({ connection, payload, documentName }: onStatelessPayload): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(payload);
    } catch {
      message = null;
    }
    if (isRecord(message) && message.type === 'ping') {
      sendStateless(connection, { type: 'pong' });
      return;
    }
    this.strike(connection as CollabConnection, 1, documentName);
  }

  // Cuenta strikes de una conexión y la cierra con 4400 al llegar al límite.
  strike(connection: CollabConnection, count: number, documentName: string): void {
    if (count <= 0) return;
    this.deps.metrics.strikes.inc(count);
    if (!this.deps.runtime.strikes.add(connection.socketId, count)) return;
    this.deps.logger.warn(
      { documentName, userId: connection.context?.userId, projectId: connection.context?.projectId, socketId: connection.socketId },
      'Demasiados strikes; se cierra la conexión',
    );
    closeConnection(connection, CLOSE.invalidData);
  }

  async afterStoreDocument({ documentName, document }: afterStoreDocumentPayload): Promise<void> {
    const loaded = this.deps.runtime.docs.get(documentName);
    if (!loaded || loaded.discarded) return;
    const size = loaded.lastSizeBytes;
    if (size > DOCUMENT_LIMITS.sizeWarnBytes && !loaded.sizeWarned) {
      loaded.sizeWarned = true;
      for (const connection of connectionsOf(document)) sendStateless(connection, { type: 'limit', what: 'size_warning' });
    }
    if (size <= DOCUMENT_LIMITS.sizeReadOnlyBytes || loaded.readOnlyBySize) return;
    loaded.readOnlyBySize = true;
    this.deps.logger.warn({ documentName, projectId: loaded.projectId, sizeBytes: size }, 'Documento en solo lectura por tamaño');
    for (const connection of connectionsOf(document)) {
      connection.readOnly = true;
      sendStateless(connection, { type: 'limit', what: 'size' });
    }
    await publishProjectEvent(this.deps.redis, loaded.projectId, { type: 'doc.readonly', reason: 'size' }).catch((error: unknown) =>
      this.deps.logger.error({ err: error, documentName }, 'No se pudo publicar doc.readonly'),
    );
  }
}
