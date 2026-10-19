import * as Y from 'yjs';
import { acquireCompactLock, liveMembers, releaseCompactLock, renewCompactLock } from '../../collab/registry.js';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import type { Db } from '../db.js';
import { isUuid } from '../ids.js';
import type { LogSink } from '../logger.js';
import type { Redis } from '../redis.js';
import { createRestorePoint } from '../versions.js';

export const COMPACT_REQUESTED_KEY = 'parcify:compact:requested';
export const COMPACT_INTERVAL_MS = 15 * 60_000;
export const COMPACT_MIN_BYTES = 1024 * 1024;
export const COMPACT_IDLE_MS = 10 * 60_000;
export const COMPACT_BATCH = 20;
export const COMPACT_RENEW_MS = 20_000;
// Un documento que no se reduce a la mitad no se vuelve a reconstruir hasta que cambie.
const SEEN_TTL_SECONDS = 7 * 86_400;

export function compactSeenKey(projectId: string): string {
  return `parcify:compact:seen:${projectId}`;
}

export async function requestCompaction(redis: Redis, projectId: string): Promise<void> {
  await redis.sadd(COMPACT_REQUESTED_KEY, projectId);
}

function cloneValue(value: unknown): unknown {
  return value instanceof Y.AbstractType ? (value as Y.AbstractType<unknown> & { clone(): unknown }).clone() : value;
}

// Copia el contenido vivo en un Y.Doc nuevo, sin el historial de ítems sobrescritos.
export function rebuildDocument(state: Uint8Array): Uint8Array {
  const source = new Y.Doc();
  const target = new Y.Doc();
  try {
    Y.applyUpdate(source, state);
    target.transact(() => {
      for (const root of Object.values(ROOT_KEYS)) {
        const into = target.getMap(root);
        source.getMap(root).forEach((value, key) => into.set(key, cloneValue(value)));
      }
    });
    return Y.encodeStateAsUpdate(target);
  } finally {
    source.destroy();
    target.destroy();
  }
}

export interface CompactDeps {
  db: Db;
  redis: Redis;
  logger: LogSink;
  instanceId: string;
  renewMs?: number;
}

export type CompactOutcome =
  | 'compacted'
  // Otra instancia compacta el mismo proyecto.
  | 'locked'
  // Alguna instancia lo tiene cargado o una conexión se está autenticando.
  | 'loaded'
  // La reconstrucción no lo reduce a menos de la mitad.
  | 'not_worth'
  // Un guardado cambió el epoch entre la lectura y la escritura.
  | 'epoch_changed'
  | 'gone';

export async function compactProject(
  deps: CompactDeps,
  projectId: string,
  options: { requested?: boolean } = {},
): Promise<CompactOutcome> {
  const { db, redis, logger, instanceId } = deps;
  if (!(await acquireCompactLock(redis, projectId, instanceId))) return 'locked';
  let lost = false;
  const renew = setInterval(() => {
    renewCompactLock(redis, projectId, instanceId)
      .then((owned) => {
        if (!owned) lost = true;
      })
      .catch(() => undefined);
  }, deps.renewMs ?? COMPACT_RENEW_MS);
  renew.unref();
  try {
    if ((await liveMembers(redis, projectId)).length > 0) return 'loaded';
    const row = await db.projectDocument.findUnique({
      where: { projectId },
      select: {
        state: true,
        epoch: true,
        schemaVersion: true,
        nodeCount: true,
        project: { select: { deletedAt: true } },
      },
    });
    if (!row || row.project.deletedAt) return 'gone';

    const rebuilt = rebuildDocument(row.state);
    if (!options.requested && rebuilt.byteLength * 2 >= row.state.byteLength) return 'not_worth';
    // Sin el bloqueo, una instancia podría haber cargado el documento mientras tanto.
    if (lost || !(await renewCompactLock(redis, projectId, instanceId))) return 'locked';

    const bytes = Buffer.from(rebuilt.buffer, rebuilt.byteOffset, rebuilt.byteLength);
    const saved = await db.$transaction(async (tx) => {
      const affected = await tx.$executeRaw`
        UPDATE "ProjectDocument"
        SET "state" = ${bytes}, "sizeBytes" = ${rebuilt.byteLength}, "epoch" = "epoch" + 1, "updatedAt" = now()
        WHERE "projectId" = ${projectId}::uuid AND "epoch" = ${row.epoch}`;
      if (affected === 0) return false;
      await createRestorePoint(tx, {
        projectId,
        userId: null,
        content: { state: new Uint8Array(row.state), schemaVersion: row.schemaVersion, nodeCount: row.nodeCount },
      });
      return true;
    });
    if (!saved) return 'epoch_changed';
    logger.info(
      { projectId, fromEpoch: row.epoch, toEpoch: row.epoch + 1, beforeBytes: row.state.byteLength, afterBytes: rebuilt.byteLength },
      'Documento compactado',
    );
    return 'compacted';
  } finally {
    clearInterval(renew);
    await releaseCompactLock(redis, projectId, instanceId).catch((error: unknown) =>
      logger.warn({ err: { message: (error as Error).message }, projectId }, 'No se pudo soltar el bloqueo de compactación'),
    );
  }
}

export interface CompactionSummary {
  checked: number;
  compacted: number;
}

// Primero los pedidos con «Recompactar» y después los grandes que llevan un rato sin cambios.
export async function runCompaction(
  deps: CompactDeps,
  signal?: AbortSignal,
  now = new Date(),
): Promise<CompactionSummary> {
  const { db, redis, logger } = deps;
  const summary: CompactionSummary = { checked: 0, compacted: 0 };

  const requested = await redis.smembers(COMPACT_REQUESTED_KEY);
  for (const projectId of requested) {
    if (signal?.aborted) return summary;
    if (!isUuid(projectId)) {
      await redis.srem(COMPACT_REQUESTED_KEY, projectId);
      continue;
    }
    summary.checked++;
    try {
      const outcome = await compactProject(deps, projectId, { requested: true });
      if (outcome === 'compacted') summary.compacted++;
      // Los que siguen abiertos esperan a la siguiente ejecución.
      if (outcome === 'compacted' || outcome === 'gone') await redis.srem(COMPACT_REQUESTED_KEY, projectId);
    } catch (error) {
      logger.error({ err: error, projectId }, 'No se pudo compactar el documento');
    }
  }

  const idleSince = new Date(now.getTime() - COMPACT_IDLE_MS);
  let cursor: string | null = null;
  for (;;) {
    if (signal?.aborted) return summary;
    const batch: Array<{ projectId: string; updatedAt: Date }> = await db.projectDocument.findMany({
      where: { sizeBytes: { gt: COMPACT_MIN_BYTES }, updatedAt: { lt: idleSince }, project: { deletedAt: null } },
      orderBy: { projectId: 'asc' },
      take: COMPACT_BATCH,
      ...(cursor ? { cursor: { projectId: cursor }, skip: 1 } : {}),
      select: { projectId: true, updatedAt: true },
    });
    if (batch.length === 0) return summary;
    cursor = batch.at(-1)!.projectId;
    const seen = await redis.mget(...batch.map((row) => compactSeenKey(row.projectId)));
    for (const [index, row] of batch.entries()) {
      if (signal?.aborted) return summary;
      const version = String(row.updatedAt.getTime());
      if (seen[index] === version) continue;
      summary.checked++;
      try {
        const outcome = await compactProject(deps, row.projectId);
        if (outcome === 'compacted') summary.compacted++;
        if (outcome === 'not_worth') await redis.set(compactSeenKey(row.projectId), version, 'EX', SEEN_TTL_SECONDS);
      } catch (error) {
        logger.error({ err: error, projectId: row.projectId }, 'No se pudo compactar el documento');
      }
    }
    if (batch.length < COMPACT_BATCH) return summary;
  }
}
