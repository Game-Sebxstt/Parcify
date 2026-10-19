import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Db } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { requireProject } from '../../../core/permissions.js';
import type { RpcClient, RpcReply } from '../../../core/rpc.js';
import { createManualVersion, storedContent } from '../../../core/versions.js';
import type {
  CreateVersionBodySchema,
  RestoreVersionResponse,
  VersionDto,
  VersionListQuerySchema,
} from '../../../shared/api/versions.js';
import type { Actor } from '../../types.js';

export interface VersionDeps {
  db: Db;
  rpc: RpcClient;
}

const versionSelect = {
  id: true,
  projectId: true,
  kind: true,
  name: true,
  createdById: true,
  sizeBytes: true,
  nodeCount: true,
  createdAt: true,
} as const;

type VersionRow = {
  id: string;
  projectId: string;
  kind: VersionDto['kind'];
  name: string | null;
  createdById: string | null;
  sizeBytes: number;
  nodeCount: number;
  createdAt: Date;
};

async function present(db: Db, rows: VersionRow[]): Promise<VersionDto[]> {
  const userIds = [...new Set(rows.flatMap((row) => (row.createdById ? [row.createdById] : [])))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((user) => [user.id, user.name]));
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    name: row.name,
    createdBy: row.createdById ? { id: row.createdById, name: nameById.get(row.createdById) ?? null } : null,
    sizeBytes: row.sizeBytes,
    nodeCount: row.nodeCount,
    createdAt: row.createdAt.toISOString(),
  }));
}

function failure(reply: RpcReply | null): AppError {
  if (!reply) return new AppError('COLLAB_UNAVAILABLE');
  if (reply.ok) return new AppError('INTERNAL');
  switch (reply.error) {
    case 'epoch_changed':
      return new AppError('DOCUMENT_RELOADED');
    case 'restore_in_progress':
      return new AppError('RESTORE_IN_PROGRESS');
    case 'not_found':
      return new AppError('NOT_FOUND');
    default:
      return new AppError('COLLAB_UNAVAILABLE');
  }
}

export async function listVersions(
  deps: VersionDeps,
  actor: Actor,
  projectId: string,
  query: z.infer<typeof VersionListQuerySchema>,
): Promise<{ items: VersionDto[]; nextCursor: string | null }> {
  await requireProject(deps.db, actor.userId, projectId);
  let after: { id: string; createdAt: Date } | null = null;
  if (query.cursor) {
    after = await deps.db.projectVersion.findFirst({ where: { id: query.cursor, projectId }, select: { id: true, createdAt: true } });
    if (!after) return { items: [], nextCursor: null };
  }
  const rows = await deps.db.projectVersion.findMany({
    where: {
      projectId,
      ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: versionSelect,
  });
  const page = rows.slice(0, query.limit);
  return {
    items: await present(deps.db, page),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

// La instancia de collab con el documento guarda y copia el estado vivo; si nadie lo tiene, se copia lo guardado.
export async function createVersion(
  deps: VersionDeps,
  actor: Actor,
  projectId: string,
  body: z.infer<typeof CreateVersionBodySchema>,
): Promise<VersionDto> {
  await requireProject(deps.db, actor.userId, projectId, 'version:create');
  const name = body.name ?? null;
  const reply = await deps.rpc.call(
    { type: 'version.create', requestId: randomUUID(), projectId, userId: actor.userId, name },
    {
      fallback: async () => {
        const content = await storedContent(deps.db, projectId);
        return { ok: true, versionId: await createManualVersion(deps.db, { projectId, userId: actor.userId, name, content }) };
      },
    },
  );
  if (!reply?.ok || !('versionId' in reply)) throw failure(reply);
  const row = await deps.db.projectVersion.findUniqueOrThrow({ where: { id: reply.versionId }, select: versionSelect });
  const [version] = await present(deps.db, [row]);
  return version!;
}

export async function restoreVersion(
  deps: VersionDeps,
  actor: Actor,
  projectId: string,
  versionId: string,
): Promise<RestoreVersionResponse> {
  await requireProject(deps.db, actor.userId, projectId, 'version:restore');
  const exists = await deps.db.projectVersion.count({ where: { id: versionId, projectId } });
  if (!exists) throw new AppError('NOT_FOUND');
  const reply = await deps.rpc.call({ type: 'version.restore', requestId: randomUUID(), projectId, userId: actor.userId, versionId });
  if (!reply?.ok || !('versionId' in reply) || !reply.restorePointId) throw failure(reply);
  return { versionId: reply.versionId, restorePointId: reply.restorePointId };
}

export async function versionState(deps: VersionDeps, actor: Actor, projectId: string, versionId: string): Promise<Buffer> {
  await requireProject(deps.db, actor.userId, projectId);
  const row = await deps.db.projectVersion.findFirst({ where: { id: versionId, projectId }, select: { state: true } });
  if (!row) throw new AppError('NOT_FOUND');
  return Buffer.from(row.state);
}
