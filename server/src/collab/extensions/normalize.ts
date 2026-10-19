import type {
  afterLoadDocumentPayload,
  afterUnloadDocumentPayload,
  Document,
  Extension,
  onLoadDocumentPayload,
} from '@hocuspocus/server';
import { isTransactionOrigin } from '@hocuspocus/server';
import type { Logger } from 'pino';
import type * as Y from 'yjs';
import { initialPageId } from '../../core/document/initial-page.js';
import { initDocument, isDocumentInitialized } from '../../shared/document/init.js';
import { projectIdFromDocumentName, ROOT_KEYS, serverOrigin } from '../../shared/document/keys.js';
import { COLLAB_LIMITS } from '../../shared/document/limits.js';
import { migrate } from '../../shared/document/migrations.js';
import {
  createTouches,
  hasTouches,
  normalizeDocument,
  recordTouches,
  type NormalizeOptions,
  type Touches,
} from '../../shared/document/normalize.js';
import type { CollabMetrics } from '../metrics.js';
import { connectionsOf, sendStateless, type CollabConnection } from '../state.js';
import type { GuardExtension } from './guard.js';

const ROOTS = ['nodes', 'pages', 'texts', 'animations'] as const;

interface Batch {
  document: Document;
  touches: Touches;
  timer: NodeJS.Timeout | null;
}

export { initialPageId };

// Migraciones al cargar y normalización por microlote de lo que llega de conexiones de esta instancia.
export class NormalizeExtension implements Extension {
  extensionName = 'normalize';
  priority = 600;

  private readonly batches = new Map<string, Batch>();
  corrections = 0;

  constructor(
    private readonly deps: {
      logger: Logger;
      metrics: CollabMetrics;
      guard: GuardExtension;
      batchMs?: number;
      options?: NormalizeOptions;
    },
  ) {}

  async onLoadDocument({ document, documentName }: onLoadDocumentPayload): Promise<void> {
    const result = migrate(document);
    if (result.applied.length > 0) this.deps.logger.info({ documentName, ...result }, 'Documento migrado');
  }

  // Después de la extensión Redis, que ya trajo el estado de otras instancias.
  async afterLoadDocument({ document, documentName }: afterLoadDocumentPayload): Promise<void> {
    const projectId = projectIdFromDocumentName(documentName);
    if (projectId && !isDocumentInitialized(document)) initDocument(document, { pageId: initialPageId(projectId) });
    for (const root of ROOTS) {
      const type = document.getMap(ROOT_KEYS[root]) as unknown as Y.AbstractType<unknown>;
      type.observeDeep((events, transaction) => {
        const origin = transaction.origin;
        if (!isTransactionOrigin(origin) || origin.source !== 'connection') return;
        const connection = origin.connection as CollabConnection;
        const batch = this.batchFor(documentName, document);
        recordTouches(batch.touches, root, type, events, {
          actor: connection.socketId,
          userId: connection.context?.userId ?? null,
        });
        this.schedule(documentName, batch);
      });
    }
  }

  private batchFor(documentName: string, document: Document): Batch {
    let batch = this.batches.get(documentName);
    if (!batch || batch.document !== document) {
      if (batch?.timer) clearTimeout(batch.timer);
      batch = { document, touches: createTouches(), timer: null };
      this.batches.set(documentName, batch);
    }
    return batch;
  }

  private schedule(documentName: string, batch: Batch) {
    if (batch.timer) return;
    batch.timer = setTimeout(() => this.flush(documentName, batch), this.deps.batchMs ?? COLLAB_LIMITS.normalizeBatchMs);
  }

  private flush(documentName: string, batch: Batch) {
    batch.timer = null;
    const touches = batch.touches;
    batch.touches = createTouches();
    if (batch.document.isDestroyed || !hasTouches(touches)) return;
    let result;
    try {
      result = normalizeDocument(batch.document, touches, serverOrigin('server-normalize'), this.deps.options);
    } catch (error) {
      this.deps.logger.error({ err: error, documentName }, 'Fallo al normalizar el documento');
      return;
    }
    if (result.corrections.length === 0) return;
    this.corrections += result.corrections.length;
    this.deps.metrics.corrections.inc(result.corrections.length);

    const connections = connectionsOf(batch.document);
    const bySocket = new Map(connections.map((connection) => [connection.socketId, connection]));
    const strikes = new Map<string, number>();
    for (const correction of result.corrections) {
      if (correction.actor) strikes.set(correction.actor, (strikes.get(correction.actor) ?? 0) + 1);
    }
    this.deps.logger.debug({ documentName, corrections: result.corrections.length }, 'Documento normalizado');
    for (const { what, actor } of new Map(result.limits.map((limit) => [`${limit.what}:${limit.actor}`, limit])).values()) {
      const connection = actor ? bySocket.get(actor) : undefined;
      if (connection) sendStateless(connection, { type: 'limit', what });
    }
    for (const [socketId, count] of strikes) {
      const connection = bySocket.get(socketId);
      if (connection) this.deps.guard.strike(connection, count, documentName);
    }
  }

  async afterUnloadDocument({ documentName, instance }: afterUnloadDocumentPayload): Promise<void> {
    if (instance.documents.has(documentName)) return;
    const batch = this.batches.get(documentName);
    if (batch?.timer) clearTimeout(batch.timer);
    this.batches.delete(documentName);
  }
}
