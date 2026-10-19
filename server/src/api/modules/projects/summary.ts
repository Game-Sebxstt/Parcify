import type { Db } from '../../../core/db.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { ProjectSummary } from '../../../shared/api/projects.js';
import type { ProjectRole } from '../../../shared/permissions.js';

export const summarySelect = (userId: string) =>
  ({
    id: true,
    name: true,
    organizationId: true,
    createdById: true,
    orgAccess: true,
    previewAssetId: true,
    lastEditedAt: true,
    lastEditedById: true,
    createdAt: true,
    deletedAt: true,
    members: { where: { userId }, select: { role: true }, take: 1 },
  }) as const;

type SummaryRow = Prisma.ProjectGetPayload<{ select: ReturnType<typeof summarySelect> }>;

export type EditorNames = ReadonlyMap<string, string>;

export function toSummary(
  row: Pick<
    SummaryRow,
    'id' | 'name' | 'createdById' | 'previewAssetId' | 'lastEditedAt' | 'lastEditedById' | 'createdAt' | 'deletedAt'
  >,
  workspaceSlug: string,
  role: ProjectRole,
  favorite: boolean,
  editors: EditorNames = new Map(),
): ProjectSummary {
  const editorName = row.lastEditedById ? editors.get(row.lastEditedById) : undefined;
  return {
    id: row.id,
    name: row.name,
    workspaceSlug,
    role,
    previewAssetId: row.previewAssetId,
    favorite,
    createdById: row.createdById,
    lastEditedAt: row.lastEditedAt.toISOString(),
    lastEditedBy: row.lastEditedById && editorName !== undefined ? { id: row.lastEditedById, name: editorName } : null,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export async function favoriteIds(db: Db, userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.favorite.findMany({
    where: { userId, targetType: 'project', targetId: { in: ids } },
    select: { targetId: true },
  });
  return new Set(rows.map((row) => row.targetId));
}

// Nombres de quienes editaron por última vez; una sola consulta por página.
export async function editorNames(db: Db, rows: ReadonlyArray<{ lastEditedById: string | null }>): Promise<EditorNames> {
  const ids = [...new Set(rows.flatMap((row) => (row.lastEditedById ? [row.lastEditedById] : [])))];
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}
