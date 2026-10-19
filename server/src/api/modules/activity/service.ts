import type { z } from 'zod';
import { utcDay } from '../../../core/activity.js';
import type { Db } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { projectRoleFrom, requireProject, requireWorkspace } from '../../../core/permissions.js';
import {
  ACTIVITY_LIMITS,
  type ActivityCounters,
  type ActivityEventDto,
  type ActivityEventsQuerySchema,
  type ActivityRangeQuerySchema,
  type ProjectActivityResponse,
  type WorkspaceActivityResponse,
} from '../../../shared/api/activity.js';
import type { Actor } from '../../types.js';

const DAY_MS = 86_400_000;

const COUNTER_KEYS = [
  'editOps',
  'activeMinutes',
  'sessions',
  'nodesCreated',
  'nodesDeleted',
  'chatMessages',
  'versionsCreated',
  'aiActions',
] as const satisfies ReadonlyArray<keyof ActivityCounters>;

const SUM_SELECT = Object.fromEntries(COUNTER_KEYS.map((key) => [key, true])) as Record<keyof ActivityCounters, true>;

type CounterSums = { [K in keyof ActivityCounters]?: number | null };

export interface ActivityRange {
  from: Date;
  to: Date;
}

function invalid(path: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', { details: { issues: [{ path, message }] } });
}

function parseDay(value: string, path: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || utcDay(date) !== value) throw invalid(path, 'fecha inválida');
  return date;
}

export function resolveRange(query: z.infer<typeof ActivityRangeQuerySchema>, now = new Date()): ActivityRange {
  const to = query.to ? parseDay(query.to, 'querystring.to') : parseDay(utcDay(now), 'querystring.to');
  const from = query.from
    ? parseDay(query.from, 'querystring.from')
    : new Date(to.getTime() - (ACTIVITY_LIMITS.defaultRangeDays - 1) * DAY_MS);
  if (from.getTime() > to.getTime()) throw invalid('querystring.from', 'debe ser igual o anterior a to');
  if ((to.getTime() - from.getTime()) / DAY_MS + 1 > ACTIVITY_LIMITS.maxRangeDays) {
    throw invalid('querystring', `el rango no puede superar ${ACTIVITY_LIMITS.maxRangeDays} días`);
  }
  return { from, to };
}

function zero(): ActivityCounters {
  return { editOps: 0, activeMinutes: 0, sessions: 0, nodesCreated: 0, nodesDeleted: 0, chatMessages: 0, versionsCreated: 0, aiActions: 0 };
}

function countersOf(sums: CounterSums): ActivityCounters {
  const result = zero();
  for (const key of COUNTER_KEYS) result[key] = sums[key] ?? 0;
  return result;
}

function addTo(target: ActivityCounters, source: ActivityCounters): void {
  for (const key of COUNTER_KEYS) target[key] += source[key];
}

function nodeCounts(value: unknown, into: Record<string, number> = {}): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return into;
  for (const [type, count] of Object.entries(value)) {
    if (typeof count === 'number' && Number.isInteger(count) && count > 0) into[type] = (into[type] ?? 0) + count;
  }
  return into;
}

async function usersById(db: Db, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; name: string; avatarAssetId: string | null }>();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarAssetId: true } });
  return new Map(users.map((user) => [user.id, user]));
}

// Series por usuario y día, totales por usuario y del rango.
async function report(
  db: Db,
  range: ActivityRange,
  points: Array<{ userId: string; day: Date; counters: ActivityCounters }>,
  nodeCountByType: Record<string, number>,
): Promise<ProjectActivityResponse> {
  const byUser = new Map<string, ActivityCounters>();
  const totals = zero();
  for (const point of points) {
    let entry = byUser.get(point.userId);
    if (!entry) {
      entry = zero();
      byUser.set(point.userId, entry);
    }
    addTo(entry, point.counters);
    addTo(totals, point.counters);
  }
  const users = await usersById(db, [...byUser.keys()]);
  return {
    from: utcDay(range.from),
    to: utcDay(range.to),
    users: [...byUser.keys()].map((id) => {
      const user = users.get(id);
      return { id, name: user?.name ?? null, avatarAssetId: user?.avatarAssetId ?? null };
    }),
    series: points
      .map((point) => ({ userId: point.userId, day: utcDay(point.day), ...point.counters }))
      .sort((a, b) => a.day.localeCompare(b.day) || a.userId.localeCompare(b.userId)),
    byUser: [...byUser.entries()]
      .map(([userId, counters]) => ({ userId, ...counters }))
      .sort((a, b) => b.editOps - a.editOps || a.userId.localeCompare(b.userId)),
    totals,
    nodeCountByType,
  };
}

export async function projectActivity(
  db: Db,
  actor: Actor,
  projectId: string,
  query: z.infer<typeof ActivityRangeQuerySchema>,
): Promise<ProjectActivityResponse> {
  await requireProject(db, actor.userId, projectId);
  const range = resolveRange(query);
  const [rows, document] = await Promise.all([
    db.activityDaily.findMany({ where: { projectId, day: { gte: range.from, lte: range.to } } }),
    db.projectDocument.findUnique({ where: { projectId }, select: { nodeCountByType: true } }),
  ]);
  return report(
    db,
    range,
    rows.map((row) => ({ userId: row.userId, day: row.day, counters: countersOf(row) })),
    nodeCounts(document?.nodeCountByType),
  );
}

// Solo agrega los proyectos que el usuario puede ver en el espacio (sin los de la papelera).
export async function workspaceActivity(
  db: Db,
  actor: Actor,
  slug: string,
  query: z.infer<typeof ActivityRangeQuerySchema>,
): Promise<WorkspaceActivityResponse> {
  const access = await requireWorkspace(db, actor.userId, slug);
  const range = resolveRange(query);
  const projects = await db.project.findMany({
    where: {
      organizationId: access.workspace.id,
      deletedAt: null,
      ...(access.role === 'member'
        ? { OR: [{ orgAccess: { not: 'none' } }, { members: { some: { userId: actor.userId } } }] }
        : {}),
    },
    select: {
      id: true,
      name: true,
      orgAccess: true,
      members: { where: { userId: actor.userId }, select: { role: true }, take: 1 },
      document: { select: { nodeCountByType: true } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  const visible = projects.filter((project) =>
    projectRoleFrom({
      orgRole: access.role,
      orgAccess: project.orgAccess,
      directRole: project.members[0]?.role,
      projectDeleted: false,
      workspaceDeleted: false,
    }),
  );
  const ids = visible.map((project) => project.id);
  const where = { projectId: { in: ids }, day: { gte: range.from, lte: range.to } };
  const [daily, perProject] = ids.length
    ? await Promise.all([
        db.activityDaily.groupBy({ by: ['userId', 'day'], where, _sum: SUM_SELECT }),
        db.activityDaily.groupBy({ by: ['projectId'], where, _sum: SUM_SELECT }),
      ])
    : [[], []];

  const nodeCountByType: Record<string, number> = {};
  for (const project of visible) nodeCounts(project.document?.nodeCountByType, nodeCountByType);
  const base = await report(
    db,
    range,
    daily.map((group) => ({ userId: group.userId, day: group.day, counters: countersOf(group._sum) })),
    nodeCountByType,
  );
  const totalsByProject = new Map(perProject.map((group) => [group.projectId, countersOf(group._sum)]));
  return {
    ...base,
    projects: visible.map((project) => ({ id: project.id, name: project.name, totals: totalsByProject.get(project.id) ?? zero() })),
  };
}

function eventData(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function projectEvents(
  db: Db,
  actor: Actor,
  projectId: string,
  query: z.infer<typeof ActivityEventsQuerySchema>,
): Promise<{ items: ActivityEventDto[]; nextCursor: string | null }> {
  await requireProject(db, actor.userId, projectId);
  let cursor: { id: string; createdAt: Date } | null = null;
  if (query.cursor) {
    cursor = await db.activityEvent.findFirst({ where: { id: query.cursor, projectId }, select: { id: true, createdAt: true } });
    if (!cursor) return { items: [], nextCursor: null };
  }
  const rows = await db.activityEvent.findMany({
    where: {
      projectId,
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: { id: true, type: true, actorId: true, data: true, createdAt: true },
  });
  const page = rows.slice(0, query.limit);
  const users = await usersById(db, [...new Set(page.flatMap((row) => (row.actorId ? [row.actorId] : [])))]);
  return {
    items: page.map((row) => {
      const user = row.actorId ? users.get(row.actorId) : undefined;
      return {
        id: row.id,
        type: row.type,
        actor: row.actorId ? { id: row.actorId, name: user?.name ?? null, avatarAssetId: user?.avatarAssetId ?? null } : null,
        data: eventData(row.data),
        createdAt: row.createdAt.toISOString(),
      };
    }),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}
