import type { DirectConnection, Document, Extension, Hocuspocus, onConfigurePayload } from '@hocuspocus/server';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import { recordActivity } from '../../core/activity.js';
import type { Db } from '../../core/db.js';
import type { Redis } from '../../core/redis.js';
import {
  acquireRestoreLock,
  claimRequest,
  publishReply,
  releaseRestoreLock,
  RPC_CHANNEL,
  RESTORE_SETTLE_MS,
  RPC_FALLBACK_MS,
  RPC_TIMEOUT_MS,
  RpcRequestSchema,
  type RpcReply,
  type RpcRequest,
} from '../../core/rpc.js';
import { contentOf, createManualVersion, createRestorePoint, storedContent } from '../../core/versions.js';
import { documentNameFor, ROOT_KEYS, serverOrigin } from '../../shared/document/keys.js';
import type { CollabRuntime } from '../state.js';
import type { PersistenceExtension } from './database.js';

// Raíces que sustituye una restauración; `meta` se conserva.
const RESTORED_ROOTS = [ROOT_KEYS.pages, ROOT_KEYS.nodes, ROOT_KEYS.texts, ROOT_KEYS.animations] as const;

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, index) => sameValue(item, other[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => key in right && sameValue(left[key], right[key]));
}

function sameText(a: Y.Text, b: Y.Text): boolean {
  return sameValue(a.toDelta(), b.toDelta());
}

function cloneValue(value: unknown): unknown {
  return value instanceof Y.AbstractType ? (value as Y.AbstractType<unknown> & { clone(): unknown }).clone() : value;
}

// Deja `target` igual que `source`: borra lo que sobra y escribe solo lo que falta o difiere.
function syncMap(target: Y.Map<unknown>, source: Y.Map<unknown>): void {
  for (const key of [...target.keys()]) if (!source.has(key)) target.delete(key);
  source.forEach((value, key) => {
    const current = target.get(key);
    if (value instanceof Y.Map) {
      if (current instanceof Y.Map) syncMap(current, value);
      else target.set(key, value.clone());
    } else if (value instanceof Y.Text) {
      if (current instanceof Y.Text) {
        // Un Y.Text distinto se borra y se escribe entero.
        if (!sameText(current, value)) {
          current.delete(0, current.length);
          current.applyDelta(value.toDelta());
        }
      } else {
        target.set(key, value.clone());
      }
    } else if (value instanceof Y.Array) {
      if (!(current instanceof Y.Array) || !sameValue(current.toJSON(), value.toJSON())) target.set(key, value.clone());
    } else if (current instanceof Y.AbstractType || !sameValue(current, value)) {
      target.set(key, cloneValue(value));
    }
  });
}

// Sustituye el contenido del documento por el de una versión en una sola transacción con origen `restore`.
export function replaceContent(document: Y.Doc, version: Uint8Array): void {
  const source = new Y.Doc();
  try {
    Y.applyUpdate(source, version);
    document.transact(() => {
      for (const root of RESTORED_ROOTS) syncMap(document.getMap(root), source.getMap(root));
    }, serverOrigin('restore'));
  } finally {
    source.destroy();
  }
}

export interface RpcDeps {
  db: Db;
  redis: Redis;
  logger: Logger;
  runtime: CollabRuntime;
  persistence: PersistenceExtension;
  instanceId: string;
  // Espera de una instancia sin el documento antes de reclamar una restauración.
  restoreDelayMs?: number;
}

// Peticiones de la API por `parcify:rpc:collab`: crear una versión con el estado vivo, restaurar una versión y
// guardar el estado vivo antes de exportar.
export class RpcExtension implements Extension {
  extensionName = 'rpc';
  priority = 400;

  private instance: Hocuspocus | null = null;
  private readonly subscriber: Redis;
  private subscribed: Promise<void> | null = null;

  constructor(private readonly deps: RpcDeps) {
    this.subscriber = deps.redis.duplicate({ connectionName: 'collab-rpc' });
    let down = false;
    this.subscriber.on('error', (error: Error) => {
      if (down) return;
      down = true;
      deps.logger.error({ err: { message: error.message } }, 'Redis no responde (rpc)');
    });
    this.subscriber.on('ready', () => {
      if (!down) return;
      down = false;
      deps.logger.info('Redis recuperado (rpc)');
    });
    this.subscriber.on('message', (_channel: string, message: string) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        payload = null;
      }
      const parsed = RpcRequestSchema.safeParse(payload);
      if (!parsed.success) {
        this.deps.logger.warn('Petición rpc ignorada: formato desconocido');
        return;
      }
      void this.handle(parsed.data);
    });
  }

  async onConfigure({ instance }: onConfigurePayload): Promise<void> {
    this.instance = instance;
  }

  start(): Promise<void> {
    this.subscribed ??= this.subscriber.subscribe(RPC_CHANNEL).then(() => undefined);
    return this.subscribed;
  }

  async onListen(): Promise<void> {
    await this.start();
  }

  async onDestroy(): Promise<void> {
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }

  // Cargado aquí y utilizable: no descartado por un cambio de epoch o un borrado.
  private loaded(documentName: string): Document | null {
    const document = this.instance?.documents.get(documentName);
    const state = this.deps.runtime.docs.get(documentName);
    return document && state && !state.discarded ? document : null;
  }

  private async handle(request: RpcRequest): Promise<void> {
    const { redis, instanceId, logger } = this.deps;
    const documentName = documentNameFor(request.projectId);
    const log = logger.child({ requestId: request.requestId, projectId: request.projectId, rpc: request.type });
    try {
      if (!this.loaded(documentName)) {
        // Crear una versión o exportar sin el documento lo hace la API con lo guardado.
        if (request.type !== 'version.restore') return;
        await new Promise((resolve) => setTimeout(resolve, this.deps.restoreDelayMs ?? RPC_FALLBACK_MS));
      }
      if (!(await claimRequest(redis, request.requestId, instanceId))) return;
      const reply =
        request.type === 'version.create'
          ? await this.createVersion(request)
          : request.type === 'document.flush'
            ? await this.flush(request)
            : await this.restore(request);
      await publishReply(redis, request.requestId, reply);
    } catch (error) {
      log.error({ err: error }, 'Fallo al atender la petición rpc');
      await publishReply(redis, request.requestId, { ok: false, error: 'failed' }).catch(() => undefined);
    }
  }

  private async createVersion(request: Extract<RpcRequest, { type: 'version.create' }>): Promise<RpcReply> {
    const documentName = documentNameFor(request.projectId);
    const document = this.loaded(documentName);
    let content;
    if (document) {
      const result = await this.deps.persistence.storeNow(documentName, document);
      if (result.status === 'epoch_changed') return { ok: false, error: 'epoch_changed' };
      // Se descargó entre el reclamo y ahora: lo guardado ya es lo último.
      content = result.status === 'stored' ? result.content : await storedContent(this.deps.db, request.projectId);
    } else {
      content = await storedContent(this.deps.db, request.projectId);
    }
    const versionId = await createManualVersion(this.deps.db, {
      projectId: request.projectId,
      userId: request.userId,
      name: request.name,
      content,
    });
    return { ok: true, versionId };
  }

  private async flush(request: Extract<RpcRequest, { type: 'document.flush' }>): Promise<RpcReply> {
    const documentName = documentNameFor(request.projectId);
    const document = this.loaded(documentName);
    // Descargado entre el reclamo y ahora: lo guardado ya es lo último.
    if (!document) return { ok: true, flushed: true };
    const result = await this.deps.persistence.storeNow(documentName, document);
    if (result.status === 'epoch_changed') return { ok: false, error: 'epoch_changed' };
    return { ok: true, flushed: true };
  }

  private async restore(request: Extract<RpcRequest, { type: 'version.restore' }>): Promise<RpcReply> {
    const { db, redis, logger } = this.deps;
    const { projectId, requestId } = request;
    if (!(await acquireRestoreLock(redis, projectId, requestId))) return { ok: false, error: 'restore_in_progress' };
    const started = Date.now();
    let direct: DirectConnection | null = null;
    let replaced = false;
    try {
      const version = await db.projectVersion.findFirst({
        where: { id: request.versionId, projectId },
        select: { id: true, state: true },
      });
      if (!version) return { ok: false, error: 'not_found' };

      const documentName = documentNameFor(projectId);
      let document = this.loaded(documentName);
      if (!document) {
        // Sus cambios llegan a las demás instancias por la extensión Redis.
        direct = await this.instance!.openDirectConnection(documentName, { userId: request.userId });
        document = this.loaded(documentName);
      }
      if (!document) return { ok: false, error: 'epoch_changed' };

      const restorePointId = await createRestorePoint(db, { projectId, userId: request.userId, content: contentOf(document) });
      replaceContent(document, new Uint8Array(version.state));
      replaced = true;
      const elapsedMs = Date.now() - started;
      if (elapsedMs > RPC_TIMEOUT_MS) {
        logger.warn({ requestId, projectId, versionId: version.id, elapsedMs }, 'Restauración aplicada después del plazo de la API');
      }
      await recordActivity(db, {
        type: 'version.restored',
        actorId: request.userId,
        projectId,
        data: { versionId: version.id, restorePointId },
      });
      return { ok: true, versionId: version.id, restorePointId };
    } finally {
      if (direct) await direct.disconnect().catch((error: unknown) => logger.warn({ err: error, projectId }, 'No se pudo cerrar la conexión directa'));
      await releaseRestoreLock(redis, projectId, requestId, replaced ? RESTORE_SETTLE_MS : 0).catch(() => undefined);
    }
  }
}
