import type { z } from 'zod';
import { recordActivity } from '../../../core/activity.js';
import type { Db } from '../../../core/db.js';
import { AppError, isAppError, type ErrorCode } from '../../../core/errors.js';
import { publishProjectEvent } from '../../../core/events.js';
import type { LogSink } from '../../../core/logger.js';
import {
  projectRoleFrom,
  requireProject,
  requireWorkspace,
  type ProjectAccess,
} from '../../../core/permissions.js';
import type { Redis } from '../../../core/redis.js';
import type { StorageDriver } from '../../../core/storage/index.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { ProjectListQuery, ProjectSummary } from '../../../shared/api/projects.js';
import { can } from '../../../shared/permissions.js';
import type { Actor } from '../../types.js';
import { createProjectFromTemplate } from '../templates/service.js';
import { duplicateProject } from './duplicate.js';
import { editorNames, favoriteIds, summarySelect, toSummary } from './summary.js';
import type {
  BatchProjectsBodySchema,
  BatchProjectsResponseSchema,
  CreateProjectBodySchema,
  DuplicateProjectBodySchema,
  ListQuerySchema,
  ProjectDetailSchema,
  UpdateProjectBodySchema,
} from './schemas.js';

export interface ProjectDeps {
  db: Db;
  redis: Redis;
  storage: StorageDriver;
  logger: LogSink;
}

type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

const MEMBERS_IN_DETAIL = 20;

async function publishSafely(deps: ProjectDeps, projectId: string, event: Parameters<typeof publishProjectEvent>[2]) {
  try {
    await publishProjectEvent(deps.redis, projectId, event);
  } catch (error) {
    deps.logger.error(
      { err: { message: (error as Error).message }, projectId, event: event.type },
      'No se pudo publicar el evento del proyecto',
    );
  }
}

const SORT_FIELDS = { name: 'name', edited: 'lastEditedAt', created: 'createdAt' } as const;

function page<T extends { id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}

export async function listWorkspaceProjects(
  deps: ProjectDeps,
  actor: Actor,
  slug: string,
  query: ProjectListQuery,
): Promise<{ items: ProjectSummary[]; nextCursor: string | null }> {
  const access = await requireWorkspace(deps.db, actor.userId, slug);
  const userId = actor.userId;
  const isMember = access.role === 'member';

  const and: Prisma.ProjectWhereInput[] = [{ organizationId: access.workspace.id }];
  if (query.filter === 'trash') {
    and.push({ deletedAt: { not: null } });
    if (isMember) and.push({ members: { some: { userId, role: 'admin' } } });
  } else {
    and.push({ deletedAt: null });
    if (isMember) and.push({ OR: [{ orgAccess: { not: 'none' } }, { members: { some: { userId } } }] });
  }
  if (query.filter === 'mine') and.push({ createdById: userId });
  if (query.filter === 'shared') and.push({ createdById: { not: userId } });
  if (query.filter === 'favorites') {
    const favorites = await deps.db.favorite.findMany({
      where: { userId, targetType: 'project' },
      select: { targetId: true },
    });
    and.push({ id: { in: favorites.map((favorite) => favorite.targetId) } });
  }
  if (query.q) and.push({ name: { contains: query.q, mode: 'insensitive' } });

  const field = SORT_FIELDS[query.sort];
  const rows = await deps.db.project.findMany({
    where: { AND: and },
    orderBy: [{ [field]: query.dir }, { id: query.dir }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: summarySelect(userId),
  });
  const { items, nextCursor } = page(rows, query.limit);
  const [favorites, editors] = await Promise.all([
    favoriteIds(deps.db, userId, items.map((row) => row.id)),
    editorNames(deps.db, items),
  ]);
  return {
    items: items.flatMap((row) => {
      const role = projectRoleFrom({
        orgRole: access.role,
        orgAccess: row.orgAccess,
        directRole: row.members[0]?.role,
        projectDeleted: row.deletedAt !== null,
        workspaceDeleted: false,
      });
      return role ? [toSummary(row, access.workspace.slug, role, favorites.has(row.id), editors)] : [];
    }),
    nextCursor,
  };
}

// Proyectos de espacios ajenos con acceso directo (ProjectMember).
export async function listSharedProjects(
  deps: ProjectDeps,
  actor: Actor,
  query: z.infer<typeof ListQuerySchema>,
): Promise<{ items: ProjectSummary[]; nextCursor: string | null }> {
  const userId = actor.userId;
  const rows = await deps.db.project.findMany({
    where: {
      deletedAt: null,
      members: { some: { userId } },
      organization: { deletedAt: null, members: { none: { userId } } },
    },
    orderBy: [{ lastEditedAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: { ...summarySelect(userId), organization: { select: { slug: true } } },
  });
  const { items, nextCursor } = page(rows, query.limit);
  const [favorites, editors] = await Promise.all([
    favoriteIds(deps.db, userId, items.map((row) => row.id)),
    editorNames(deps.db, items),
  ]);
  return {
    items: items.flatMap((row) => {
      const role = row.members[0]?.role;
      return role ? [toSummary(row, row.organization.slug, role, favorites.has(row.id), editors)] : [];
    }),
    nextCursor,
  };
}

export async function createProject(
  deps: ProjectDeps,
  actor: Actor,
  slug: string,
  body: z.infer<typeof CreateProjectBodySchema>,
): Promise<ProjectSummary> {
  const access = await requireWorkspace(deps.db, actor.userId, slug);
  if (body.templateId !== undefined) {
    return createProjectFromTemplate(deps, actor, access, { name: body.name, templateId: body.templateId });
  }
  const project = await deps.db.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { organizationId: access.workspace.id, name: body.name, createdById: actor.userId },
      select: summarySelect(actor.userId),
    });
    // Un member del espacio administra lo que crea; owner y admin ya lo hacen por su rol.
    if (access.role === 'member') {
      await tx.projectMember.create({
        data: { projectId: created.id, userId: actor.userId, role: 'admin', addedById: actor.userId },
      });
    }
    await recordActivity(tx, { type: 'project.created', actorId: actor.userId, projectId: created.id });
    return created;
  });
  return toSummary(project, access.workspace.slug, 'admin', false);
}

async function detailOf(deps: ProjectDeps, actor: Actor, access: ProjectAccess): Promise<ProjectDetail> {
  const [members, favorites, editors] = await Promise.all([
    deps.db.projectMember.findMany({
      where: { projectId: access.project.id },
      orderBy: { createdAt: 'asc' },
      take: MEMBERS_IN_DETAIL,
      select: { userId: true, role: true, user: { select: { name: true, avatarAssetId: true } } },
    }),
    favoriteIds(deps.db, actor.userId, [access.project.id]),
    editorNames(deps.db, [access.project]),
  ]);
  return {
    ...toSummary(access.project, access.project.workspaceSlug, access.role, favorites.has(access.project.id), editors),
    orgAccess: access.project.orgAccess,
    members: members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      avatarAssetId: member.user.avatarAssetId,
      role: member.role,
    })),
  };
}

export async function getProject(deps: ProjectDeps, actor: Actor, projectId: string): Promise<ProjectDetail> {
  const access = await requireProject(deps.db, actor.userId, projectId);
  return detailOf(deps, actor, access);
}

export async function updateProject(
  deps: ProjectDeps,
  actor: Actor,
  projectId: string,
  body: z.infer<typeof UpdateProjectBodySchema>,
): Promise<ProjectDetail> {
  const access = await requireProject(deps.db, actor.userId, projectId);
  if (body.name !== undefined && !can(access.role, 'project:edit')) throw new AppError('FORBIDDEN');
  if (body.orgAccess !== undefined && !can(access.role, 'project:manage')) throw new AppError('FORBIDDEN');
  const data: { name?: string; orgAccess?: 'none' | 'viewer' | 'editor' } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.orgAccess !== undefined) data.orgAccess = body.orgAccess;
  if (Object.keys(data).length > 0) {
    const updated = await deps.db.project.update({ where: { id: projectId }, data, select: { name: true, orgAccess: true } });
    access.project.name = updated.name;
    access.project.orgAccess = updated.orgAccess;
  }
  return detailOf(deps, actor, access);
}

export async function deleteProject(deps: ProjectDeps, actor: Actor, projectId: string): Promise<void> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'project:manage');
  if (access.project.deletedAt) return;
  await deps.db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
    await tx.favorite.deleteMany({ where: { targetType: 'project', targetId: projectId } });
    await recordActivity(tx, { type: 'project.deleted', actorId: actor.userId, projectId });
  });
  await publishSafely(deps, projectId, { type: 'project.deleted' });
}

export async function restoreProject(deps: ProjectDeps, actor: Actor, projectId: string): Promise<ProjectSummary> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'project:manage');
  let row = access.project;
  if (row.deletedAt) {
    const restored = await deps.db.$transaction(async (tx) => {
      const updated = await tx.project.update({
        where: { id: projectId },
        data: { deletedAt: null },
        select: summarySelect(actor.userId),
      });
      await recordActivity(tx, { type: 'project.restored', actorId: actor.userId, projectId });
      return updated;
    });
    row = { ...row, deletedAt: restored.deletedAt };
  }
  const [favorites, editors] = await Promise.all([
    favoriteIds(deps.db, actor.userId, [projectId]),
    editorNames(deps.db, [row]),
  ]);
  return toSummary(row, row.workspaceSlug, access.role, favorites.has(projectId), editors);
}

export async function duplicate(
  deps: ProjectDeps,
  actor: Actor,
  projectId: string,
  body: z.infer<typeof DuplicateProjectBodySchema>,
): Promise<ProjectSummary> {
  return duplicateProject(deps, actor, projectId, body);
}

type BatchResult = z.infer<typeof BatchProjectsResponseSchema>['results'][string];

// Cada id se procesa por separado: un fallo no deshace los demás.
export async function batchProjects(
  deps: ProjectDeps,
  actor: Actor,
  body: z.infer<typeof BatchProjectsBodySchema>,
): Promise<z.infer<typeof BatchProjectsResponseSchema>> {
  const results: Record<string, BatchResult> = {};
  for (const id of [...new Set(body.ids)]) {
    try {
      if (body.action === 'delete') {
        await deleteProject(deps, actor, id);
        results[id] = { ok: true };
      } else if (body.action === 'restore') {
        await restoreProject(deps, actor, id);
        results[id] = { ok: true };
      } else {
        const copy = await duplicateProject(deps, actor, id, {});
        results[id] = { ok: true, id: copy.id };
      }
    } catch (error) {
      if (isAppError(error)) {
        results[id] = { ok: false, code: error.code satisfies ErrorCode };
      } else {
        deps.logger.error({ err: { message: (error as Error).message }, projectId: id }, 'Fallo en la acción por lotes');
        results[id] = { ok: false, code: 'INTERNAL' };
      }
    }
  }
  return { results };
}
