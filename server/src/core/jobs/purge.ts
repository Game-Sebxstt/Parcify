import type { Db } from '../db.js';
import type { LogSink } from '../logger.js';
import type { StorageDriver } from '../storage/index.js';

export const TRASH_RETENTION_MS = 30 * 86_400_000;
export const PENDING_MAX_AGE_MS = 60 * 60_000;
export const ACTIVITY_RETENTION_MS = 400 * 86_400_000;
export const PURGE_BATCH = 100;
const ACTIVITY_BATCH = 5_000;

export interface PurgeDeps {
  db: Db;
  storage: StorageDriver;
  logger: LogSink;
}

interface StoredAsset {
  id: string;
  storageKey: string;
  variants: unknown;
}

const assetColumns = { id: true, storageKey: true, variants: true } as const;

// El original y las variantes guardadas en `variants` ({ thumb: { key, w, h }, ... }).
export function objectKeysOf(asset: Pick<StoredAsset, 'storageKey' | 'variants'>): string[] {
  const keys = new Set([asset.storageKey]);
  if (asset.variants && typeof asset.variants === 'object') {
    for (const variant of Object.values(asset.variants as Record<string, unknown>)) {
      const key = (variant as { key?: unknown } | null)?.key;
      if (typeof key === 'string') keys.add(key);
    }
  }
  return [...keys];
}

// Primero los objetos: si el storage falla, las filas se quedan y la siguiente ejecución lo reintenta.
async function deleteObjects(deps: PurgeDeps, assets: readonly StoredAsset[]): Promise<void> {
  const keys = assets.flatMap(objectKeysOf);
  if (keys.length > 0) await deps.storage.delete(keys);
}

async function deleteAssets(deps: PurgeDeps, assets: readonly StoredAsset[]): Promise<void> {
  if (assets.length === 0) return;
  await deleteObjects(deps, assets);
  await deps.db.asset.deleteMany({ where: { id: { in: assets.map((asset) => asset.id) } } });
}

export async function purgePendingAssets(deps: PurgeDeps, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - PENDING_MAX_AGE_MS);
  let purged = 0;
  for (;;) {
    const batch = await deps.db.asset.findMany({
      where: { status: 'pending', createdAt: { lt: before }, templateId: null },
      orderBy: { id: 'asc' },
      take: PURGE_BATCH,
      select: assetColumns,
    });
    await deleteAssets(deps, batch);
    purged += batch.length;
    if (batch.length < PURGE_BATCH) return purged;
  }
}

// Borra los proyectos con sus objetos; documento, versiones, assets y chat caen en cascada.
async function purgeProjectBatch(deps: PurgeDeps, projectIds: readonly string[]): Promise<void> {
  if (projectIds.length === 0) return;
  const assets = await deps.db.asset.findMany({
    where: { projectId: { in: [...projectIds] }, templateId: null },
    select: assetColumns,
  });
  await deleteObjects(deps, assets);
  await deps.db.project.deleteMany({ where: { id: { in: [...projectIds] } } });
}

export async function purgeTrashedProjects(deps: PurgeDeps, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - TRASH_RETENTION_MS);
  let purged = 0;
  for (;;) {
    const batch = await deps.db.project.findMany({
      where: { deletedAt: { lt: before } },
      orderBy: { id: 'asc' },
      take: PURGE_BATCH,
      select: { id: true },
    });
    await purgeProjectBatch(deps, batch.map((row) => row.id));
    purged += batch.length;
    if (batch.length < PURGE_BATCH) return purged;
  }
}

// Sus proyectos, sus plantillas con sus assets, los assets sueltos del espacio (logo) y la organización.
// La organización se borra con Prisma, nunca con la ruta de Better Auth.
async function purgeWorkspace(deps: PurgeDeps, organizationId: string): Promise<void> {
  const { db } = deps;
  for (;;) {
    const projects = await db.project.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
      take: PURGE_BATCH,
      select: { id: true },
    });
    await purgeProjectBatch(deps, projects.map((row) => row.id));
    if (projects.length < PURGE_BATCH) break;
  }
  const templateIds = (await db.template.findMany({ where: { organizationId }, select: { id: true } })).map((row) => row.id);
  const assets = await db.asset.findMany({
    where: { OR: [{ organizationId }, ...(templateIds.length ? [{ templateId: { in: templateIds } }] : [])] },
    select: assetColumns,
  });
  await deleteObjects(deps, assets);
  await db.$transaction(async (tx) => {
    await tx.asset.deleteMany({ where: { id: { in: assets.map((asset) => asset.id) } } });
    if (templateIds.length) await tx.favorite.deleteMany({ where: { targetType: 'template', targetId: { in: templateIds } } });
    await tx.organization.delete({ where: { id: organizationId } });
  });
}

export async function purgeTrashedWorkspaces(deps: PurgeDeps, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - TRASH_RETENTION_MS);
  let purged = 0;
  for (;;) {
    const batch = await deps.db.organization.findMany({
      where: { deletedAt: { lt: before } },
      orderBy: { id: 'asc' },
      take: PURGE_BATCH,
      select: { id: true },
    });
    let done = 0;
    for (const row of batch) {
      try {
        await purgeWorkspace(deps, row.id);
        done++;
      } catch (error) {
        deps.logger.error({ err: error, organizationId: row.id }, 'No se pudo purgar el espacio');
      }
    }
    purged += done;
    // Si un lote entero falla, se reintenta en la siguiente ejecución en vez de repetirlo ahora.
    if (batch.length < PURGE_BATCH || done === 0) return purged;
  }
}

// Assets borrados hace más de 30 días que ningún documento referencia (avatares de cuentas borradas incluidos).
// Los de plantilla solo caen al borrar la plantilla.
export async function purgeDeletedAssets(deps: PurgeDeps, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - TRASH_RETENTION_MS);
  let purged = 0;
  for (;;) {
    const batch = await deps.db.$queryRaw<StoredAsset[]>`
      SELECT a."id", a."storageKey", a."variants"
      FROM "Asset" a
      WHERE a."deletedAt" < ${before}
        AND a."templateId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "ProjectDocument" d WHERE d."assetRefs" @> ARRAY[a."id"])
      ORDER BY a."id"
      LIMIT ${PURGE_BATCH}`;
    await deleteAssets(deps, batch);
    purged += batch.length;
    if (batch.length < PURGE_BATCH) return purged;
  }
}

export async function purgeOldActivity(db: Db, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - ACTIVITY_RETENTION_MS);
  let purged = 0;
  for (;;) {
    const deleted = await db.$executeRaw`
      DELETE FROM "ActivityEvent" WHERE "id" IN (
        SELECT "id" FROM "ActivityEvent" WHERE "createdAt" < ${before} LIMIT ${ACTIVITY_BATCH}
      )`;
    purged += deleted;
    if (deleted < ACTIVITY_BATCH) return purged;
  }
}

export interface PurgeSummary {
  projects: number;
  workspaces: number;
  assets: number;
}

export async function runDailyPurge(deps: PurgeDeps, now = new Date()): Promise<PurgeSummary> {
  const projects = await purgeTrashedProjects(deps, now);
  const workspaces = await purgeTrashedWorkspaces(deps, now);
  const assets = await purgeDeletedAssets(deps, now);
  return { projects, workspaces, assets };
}
