import { Database } from '@hocuspocus/extension-database';
import type {
  afterStoreDocumentPayload,
  afterUnloadDocumentPayload,
  Document,
  fetchPayload,
  Hocuspocus,
  onConfigurePayload,
  storePayload,
} from '@hocuspocus/server';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import type { Db } from '../../core/db.js';
import { collectAssetRefs } from '../../core/document/remap-assets.js';
import { isUuid } from '../../core/ids.js';
import type { Redis } from '../../core/redis.js';
import { captureError } from '../../core/sentry.js';
import { createAutoVersion, type VersionContent } from '../../core/versions.js';
import { projectIdFromDocumentName, ROOT_KEYS } from '../../shared/document/keys.js';
import { documentSchemaVersion } from '../../shared/document/migrations.js';
import { DOCUMENT_SCHEMA_VERSION } from '../../shared/document/schema.js';
import type { CollabMetrics } from '../metrics.js';
import { HEARTBEAT_MS, heartbeat, registerInstance, unregister, waitForCompaction } from '../registry.js';
import {
  CLOSE,
  closeConnection,
  connectionsOf,
  Rejection,
  type CloseInfo,
  type CollabRuntime,
  type LoadedDocument,
} from '../state.js';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
export const AUTO_VERSION_MS = 30 * 60_000;

export function autoVersionKey(projectId: string): string {
  return `parcify:autover:${projectId}`;
}

export interface PersistenceDeps {
  db: Db;
  redis: Redis;
  logger: Logger;
  metrics: CollabMetrics;
  runtime: CollabRuntime;
  instanceId: string;
  retryDelaysMs?: readonly number[];
  autoVersionMs?: number;
}

function documentStats(document: Y.Doc) {
  const byType: Record<string, number> = {};
  let nodeCount = 0;
  document.getMap(ROOT_KEYS.nodes).forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    nodeCount++;
    const type = value.get('type');
    const key = typeof type === 'string' ? type : 'unknown';
    byType[key] = (byType[key] ?? 0) + 1;
  });
  return {
    nodeCount,
    nodeCountByType: byType,
    schemaVersion: documentSchemaVersion(document) ?? DOCUMENT_SCHEMA_VERSION,
    // La columna es uuid[]: un assetId mal formado de un cliente no puede romper el guardado.
    assetRefs: collectAssetRefs(document).filter(isUuid),
  };
}

// Persistencia en ProjectDocument. Corre antes que la normalización para que las migraciones vean el estado guardado.
export class PersistenceExtension extends Database {
  extensionName = 'persistence';
  priority = 700;

  private instance: Hocuspocus | null = null;
  // Lo último que guardó cada documento, hasta que lo recoge afterStoreDocument.
  private readonly stored = new Map<string, { projectId: string; content: VersionContent }>();

  constructor(private readonly deps: PersistenceDeps) {
    super({});
    this.configuration = {
      fetch: (payload) => this.load(payload),
      store: (payload) => this.save(payload),
    };
  }

  async onConfigure({ instance }: onConfigurePayload): Promise<void> {
    this.instance = instance;
  }

  private isActive(name: string): boolean {
    return Boolean(this.instance?.documents.has(name) || this.instance?.loadingDocuments.has(name));
  }

  private startHeartbeat(loaded: LoadedDocument) {
    loaded.heartbeat = setInterval(() => {
      if (this.deps.runtime.docs.get(loaded.name) !== loaded) {
        // Otra carga del mismo documento ya tiene su propio registro.
        if (loaded.heartbeat) clearInterval(loaded.heartbeat);
        loaded.heartbeat = null;
        return;
      }
      if (!this.isActive(loaded.name)) {
        void this.forget(loaded);
        return;
      }
      heartbeat(this.deps.redis, loaded.projectId, this.deps.instanceId).catch((error: unknown) =>
        this.deps.logger.warn({ err: error, documentName: loaded.name }, 'No se pudo renovar el registro del documento'),
      );
    }, HEARTBEAT_MS);
    loaded.heartbeat.unref();
  }

  private async forget(loaded: LoadedDocument) {
    if (loaded.heartbeat) clearInterval(loaded.heartbeat);
    loaded.heartbeat = null;
    if (this.deps.runtime.docs.get(loaded.name) === loaded) this.deps.runtime.docs.delete(loaded.name);
    await unregister(this.deps.redis, loaded.projectId, this.deps.instanceId).catch((error: unknown) =>
      this.deps.logger.warn({ err: error, documentName: loaded.name }, 'No se pudo borrar el registro del documento'),
    );
  }

  private async load({ documentName }: fetchPayload): Promise<Uint8Array | null> {
    const projectId = projectIdFromDocumentName(documentName);
    if (!projectId || !isUuid(projectId)) throw new Rejection('not_found');
    const { redis, db, instanceId, runtime } = this.deps;

    await registerInstance(redis, projectId, instanceId);
    try {
      if (!(await waitForCompaction(redis, projectId))) throw new Rejection('compacting');
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { organizationId: true, deletedAt: true, document: { select: { state: true, epoch: true } } },
      });
      if (!project || project.deletedAt) throw new Rejection('not_found');

      const previous = runtime.docs.get(documentName);
      if (previous?.heartbeat) clearInterval(previous.heartbeat);
      const loaded: LoadedDocument = {
        name: documentName,
        projectId,
        organizationId: project.organizationId,
        epoch: project.document?.epoch ?? 1,
        discarded: false,
        discardedWith: null,
        readOnlyBySize: false,
        sizeWarned: false,
        lastSizeBytes: project.document?.state.byteLength ?? 0,
        heartbeat: null,
      };
      runtime.docs.set(documentName, loaded);
      this.startHeartbeat(loaded);
      return project.document ? new Uint8Array(project.document.state) : null;
    } catch (error) {
      await unregister(redis, projectId, instanceId).catch(() => undefined);
      throw error;
    }
  }

  private async write(
    loaded: LoadedDocument,
    state: Uint8Array,
    stats: ReturnType<typeof documentStats>,
    editorId: string | null,
  ): Promise<number> {
    const bytes = Buffer.from(state.buffer, state.byteOffset, state.byteLength);
    const timer = this.deps.metrics.storeDuration.startTimer();
    try {
      // El UPDATE solo escribe si el epoch sigue siendo el cargado; es la invariante frente a la compactación.
      return await this.deps.db.$executeRaw`
        WITH saved AS (
          INSERT INTO "ProjectDocument"
            ("projectId", "state", "schemaVersion", "epoch", "sizeBytes", "nodeCount", "nodeCountByType", "assetRefs", "updatedAt")
          VALUES (
            ${loaded.projectId}::uuid, ${bytes}, ${stats.schemaVersion}, ${loaded.epoch}, ${state.byteLength},
            ${stats.nodeCount}, ${JSON.stringify(stats.nodeCountByType)}::jsonb, ${stats.assetRefs}::uuid[], now()
          )
          ON CONFLICT ("projectId") DO UPDATE SET
            "state" = EXCLUDED."state",
            "schemaVersion" = EXCLUDED."schemaVersion",
            "sizeBytes" = EXCLUDED."sizeBytes",
            "nodeCount" = EXCLUDED."nodeCount",
            "nodeCountByType" = EXCLUDED."nodeCountByType",
            "assetRefs" = EXCLUDED."assetRefs",
            "updatedAt" = now()
          WHERE "ProjectDocument"."epoch" = ${loaded.epoch}
          RETURNING "projectId"
        )
        UPDATE "Project" SET "lastEditedAt" = now(), "lastEditedById" = COALESCE(${editorId}::text, "lastEditedById")
        WHERE "id" IN (SELECT "projectId" FROM saved)`;
    } finally {
      timer();
    }
  }

  private discard(loaded: LoadedDocument, document: Document, close: CloseInfo) {
    loaded.discarded = true;
    loaded.discardedWith = close;
    for (const connection of connectionsOf(document)) closeConnection(connection, close);
  }

  // Un intento de guardado; si el epoch cambió o el proyecto se borró, descarta el documento.
  private async attempt(
    loaded: LoadedDocument,
    document: Document,
    state: Uint8Array,
    editorId: string | null,
  ): Promise<ReturnType<typeof documentStats> | null> {
    const { logger, metrics, db } = this.deps;
    const stats = documentStats(document);
    const affected = await this.write(loaded, state, stats, editorId);
    if (affected > 0) {
      loaded.lastSizeBytes = state.byteLength;
      metrics.documentSize.observe(state.byteLength);
      return stats;
    }
    const row = await db.projectDocument.findUnique({ where: { projectId: loaded.projectId }, select: { epoch: true } });
    const project = await db.project.findUnique({ where: { id: loaded.projectId }, select: { deletedAt: true } });
    if (!project || project.deletedAt) {
      logger.info({ documentName: loaded.name, projectId: loaded.projectId }, 'Proyecto borrado; se descarta el documento');
      this.discard(loaded, document, CLOSE.projectDeleted);
      return null;
    }
    logger.error(
      { documentName: loaded.name, projectId: loaded.projectId, loadedEpoch: loaded.epoch, storedEpoch: row?.epoch ?? null },
      'El epoch del documento cambió; no se sobrescribe',
    );
    this.discard(loaded, document, CLOSE.epochChanged);
    return null;
  }

  // Guardado inmediato fuera del debounce (crear una versión): devuelve lo que se guardó.
  async storeNow(
    documentName: string,
    document: Document,
  ): Promise<{ status: 'stored'; content: VersionContent } | { status: 'epoch_changed' | 'gone' }> {
    const loaded = this.deps.runtime.docs.get(documentName);
    if (!loaded || document.isDestroyed) return { status: 'gone' };
    if (loaded.discarded) return { status: loaded.discardedWith === CLOSE.epochChanged ? 'epoch_changed' : 'gone' };
    const state = Y.encodeStateAsUpdate(document);
    const stats = await this.attempt(loaded, document, state, null);
    if (stats) return { status: 'stored', content: { state, schemaVersion: stats.schemaVersion, nodeCount: stats.nodeCount } };
    return { status: loaded.discardedWith === CLOSE.epochChanged ? 'epoch_changed' : 'gone' };
  }

  private async save({ documentName, document, state, lastContext }: storePayload): Promise<void> {
    const { runtime, logger, metrics } = this.deps;
    // Contexto de la última conexión que cambió el documento; los guardados del servidor no lo tienen.
    const editorId = typeof (lastContext as { userId?: unknown } | undefined)?.userId === 'string'
      ? (lastContext as { userId: string }).userId
      : null;
    const delays = this.deps.retryDelaysMs ?? RETRY_DELAYS_MS;
    let current: Uint8Array = state;
    for (let attempt = 0; ; attempt++) {
      const loaded = runtime.docs.get(documentName);
      if (!loaded || loaded.discarded || document.isDestroyed) return;
      try {
        const stats = await this.attempt(loaded, document, current, editorId);
        if (stats) {
          this.stored.set(documentName, {
            projectId: loaded.projectId,
            content: { state: current, schemaVersion: stats.schemaVersion, nodeCount: stats.nodeCount },
          });
        }
        return;
      } catch (error) {
        metrics.storeErrors.inc();
        const delay = delays[Math.min(attempt, delays.length - 1)]!;
        logger.error({ err: error, documentName, attempt: attempt + 1, retryInMs: delay }, 'No se pudo guardar el documento');
        // Una vez por racha de fallos: los reintentos no deben inundar Sentry.
        if (attempt === 0) captureError(error, { documentName });
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (document.isDestroyed) return;
        current = Y.encodeStateAsUpdate(document);
      }
    }
  }

  // Versión automática como mucho cada 30 min por proyecto; la clave de Redis evita que dos instancias la dupliquen.
  async afterStoreDocument({ documentName }: afterStoreDocumentPayload): Promise<void> {
    const stored = this.stored.get(documentName);
    if (!stored) return;
    this.stored.delete(documentName);
    const { db, redis, logger, instanceId } = this.deps;
    const intervalMs = this.deps.autoVersionMs ?? AUTO_VERSION_MS;
    try {
      const claimed = await redis.set(autoVersionKey(stored.projectId), instanceId, 'PX', intervalMs, 'NX');
      if (claimed !== 'OK') return;
      const last = await db.projectVersion.findFirst({
        where: { projectId: stored.projectId, kind: 'auto' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (last && Date.now() - last.createdAt.getTime() < intervalMs) return;
      await createAutoVersion(db, stored.projectId, stored.content);
    } catch (error) {
      logger.error({ err: error, documentName }, 'No se pudo crear la versión automática');
    }
  }

  async afterUnloadDocument({ documentName }: afterUnloadDocumentPayload): Promise<void> {
    this.stored.delete(documentName);
    if (this.isActive(documentName)) return;
    const loaded = this.deps.runtime.docs.get(documentName);
    if (loaded) await this.forget(loaded);
  }
}
