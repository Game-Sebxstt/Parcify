import type { connectedPayload, Document, Extension, Hocuspocus, onConfigurePayload } from '@hocuspocus/server';
import type { Logger } from 'pino';
import { EVENT_PATTERNS, parseEvent, type ReceivedEvent } from '../../core/events.js';
import type { Redis } from '../../core/redis.js';
import { documentNameFor } from '../../shared/document/keys.js';
import {
  CLOSE,
  closeConnection,
  connectionsOf,
  sendStateless,
  type CloseInfo,
  type CollabConnection,
  type CollabContext,
  type CollabRuntime,
  type LoadedDocument,
} from '../state.js';

const RECENT_EVENTS_MS = 30_000;

interface RecentEvent {
  at: number;
  projectId: string | null;
  organizationId: string | null;
  // null: afecta a todas las conexiones.
  userId: string | null;
  close: CloseInfo;
}

// Eventos de la API en Redis entregados solo a las conexiones locales de los documentos cargados aquí.
export class EventsExtension implements Extension {
  extensionName = 'events';
  priority = 500;

  private instance: Hocuspocus | null = null;
  private readonly subscriber: Redis;
  private subscribed: Promise<void> | null = null;
  // Eventos de cierre recientes, para las conexiones que se autenticaron justo antes y aún no estaban registradas.
  private recent: RecentEvent[] = [];

  constructor(
    private readonly deps: { redis: Redis; logger: Logger; runtime: CollabRuntime },
  ) {
    this.subscriber = deps.redis.duplicate({ connectionName: 'collab-events' });
    let down = false;
    this.subscriber.on('error', (error: Error) => {
      if (down) return;
      down = true;
      deps.logger.error({ err: { message: error.message } }, 'Redis no responde (eventos)');
    });
    this.subscriber.on('ready', () => {
      if (!down) return;
      down = false;
      deps.logger.info('Redis recuperado (eventos)');
    });
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const event = parseEvent(channel, message);
      if (!event) {
        this.deps.logger.warn({ channel }, 'Evento ignorado: formato desconocido');
        return;
      }
      try {
        this.handle(event);
      } catch (error) {
        this.deps.logger.error({ err: error, channel }, 'Error al entregar un evento');
      }
    });
  }

  async onConfigure({ instance }: onConfigurePayload): Promise<void> {
    this.instance = instance;
  }

  // Se espera desde el arranque del servidor para no perder eventos publicados justo después.
  start(): Promise<void> {
    this.subscribed ??= this.subscriber.psubscribe(...EVENT_PATTERNS).then(() => undefined);
    return this.subscribed;
  }

  async onListen(): Promise<void> {
    await this.start();
  }

  async onDestroy(): Promise<void> {
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }

  private loaded(name: string): { document: Document; state: LoadedDocument | undefined } | null {
    const document = this.instance?.documents.get(name);
    return document ? { document, state: this.deps.runtime.docs.get(name) } : null;
  }

  private documentsOfOrg(organizationId: string): Document[] {
    const result: Document[] = [];
    for (const state of this.deps.runtime.docs.values()) {
      if (state.organizationId !== organizationId) continue;
      const document = this.instance?.documents.get(state.name);
      if (document) result.push(document);
    }
    return result;
  }

  private closeUser(document: Document, userId: string) {
    for (const connection of connectionsOf(document, (c) => c.context?.userId === userId)) {
      closeConnection(connection, CLOSE.accessChanged);
    }
  }

  private forward(document: Document, payload: Record<string, unknown>, filter?: (c: CollabConnection) => boolean) {
    for (const connection of connectionsOf(document, filter)) sendStateless(connection, payload);
  }

  private remember(received: ReceivedEvent) {
    const { event } = received;
    let entry: Omit<RecentEvent, 'at' | 'projectId' | 'organizationId'> | null = null;
    if (event.type === 'access.changed') entry = { userId: event.userId, close: CLOSE.accessChanged };
    else if (event.type === 'project.deleted') entry = { userId: null, close: CLOSE.projectDeleted };
    else if (event.type === 'workspace.deleted') entry = { userId: null, close: CLOSE.workspaceDeleted };
    if (!entry) return;
    const now = Date.now();
    this.recent = this.recent.filter((item) => now - item.at < RECENT_EVENTS_MS);
    this.recent.push({
      ...entry,
      at: now,
      projectId: received.scope === 'project' ? received.projectId : null,
      organizationId: received.scope === 'org' ? received.organizationId : null,
    });
  }

  // La conexión ya está en el documento: se aplica lo que llegó mientras se autenticaba.
  async connected({ connection, documentName }: connectedPayload<CollabContext>): Promise<void> {
    const context = connection.context;
    const state = this.deps.runtime.docs.get(documentName);
    if (state?.discarded) {
      closeConnection(connection, state.discardedWith ?? CLOSE.projectDeleted);
      return;
    }
    const missed = this.recent.find(
      (item) =>
        item.at >= context.authorizedAt &&
        (item.projectId === context.projectId || item.organizationId === context.organizationId) &&
        (item.userId === null || item.userId === context.userId),
    );
    if (missed) {
      closeConnection(connection, missed.close);
      return;
    }
    if (state?.readOnlyBySize && !connection.readOnly) {
      connection.readOnly = true;
      sendStateless(connection, { type: 'limit', what: 'size' });
    }
  }

  private handle(received: ReceivedEvent) {
    this.remember(received);
    if (received.scope === 'org') {
      const { event, organizationId } = received;
      for (const document of this.documentsOfOrg(organizationId)) {
        if (event.type === 'access.changed') this.closeUser(document, event.userId);
        else for (const connection of connectionsOf(document)) closeConnection(connection, CLOSE.workspaceDeleted);
      }
      return;
    }

    const target = this.loaded(documentNameFor(received.projectId));
    if (!target) return;
    const { document, state } = target;
    const { event } = received;
    switch (event.type) {
      case 'access.changed':
        this.closeUser(document, event.userId);
        break;
      case 'project.deleted':
        if (state) {
          state.discarded = true;
          state.discardedWith = CLOSE.projectDeleted;
        }
        for (const connection of connectionsOf(document)) closeConnection(connection, CLOSE.projectDeleted);
        break;
      case 'doc.readonly':
        // La instancia que lo publica ya lo aplicó a sus conexiones.
        if (state?.readOnlyBySize) break;
        if (state) state.readOnlyBySize = true;
        for (const connection of connectionsOf(document)) {
          connection.readOnly = true;
          sendStateless(connection, { type: 'limit', what: 'size' });
        }
        break;
      case 'asset.ready':
      case 'asset.deleted':
      case 'chat.message':
        this.forward(document, event);
        break;
      case 'ai.job':
        this.forward(document, event, (connection) => connection.context?.userId === event.userId);
        break;
    }
  }
}
