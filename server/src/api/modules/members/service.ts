import type { z } from 'zod';
import { recordActivity } from '../../../core/activity.js';
import type { Db } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { publishProjectEvent } from '../../../core/events.js';
import type { LogSink } from '../../../core/logger.js';
import { isOrgRole, projectRoleFrom, requireProject, type ProjectAccess } from '../../../core/permissions.js';
import type { Redis } from '../../../core/redis.js';
import type { ProjectMemberSchema } from '../../../shared/api/projects.js';
import { can, maxRole, roleAtLeast, type ProjectRole } from '../../../shared/permissions.js';
import type { Actor } from '../../types.js';

export interface MemberDeps {
  db: Db;
  redis: Redis;
  logger: LogSink;
}

type ProjectMember = z.infer<typeof ProjectMemberSchema>;

async function publishAccessChanged(deps: MemberDeps, projectId: string, userId: string) {
  try {
    await publishProjectEvent(deps.redis, projectId, { type: 'access.changed', userId });
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message }, projectId }, 'No se pudo publicar access.changed');
  }
}

interface Person {
  userId: string;
  name: string;
  avatarAssetId: string | null;
}

function effectiveMember(
  access: ProjectAccess,
  person: Person,
  orgRole: string | null,
  directRole: ProjectRole | null,
): ProjectMember | null {
  const role = projectRoleFrom({
    orgRole,
    orgAccess: access.project.orgAccess,
    directRole,
    projectDeleted: access.project.deletedAt !== null,
    workspaceDeleted: access.project.workspaceDeleted,
  });
  if (!role) return null;
  const fromWorkspace =
    orgRole && isOrgRole(orgRole)
      ? projectRoleFrom({
          orgRole,
          orgAccess: access.project.orgAccess,
          directRole: null,
          projectDeleted: access.project.deletedAt !== null,
          workspaceDeleted: access.project.workspaceDeleted,
        })
      : null;
  // Si el rol directo no supera al que da el espacio, el origen es el espacio.
  const origin = fromWorkspace && maxRole(fromWorkspace, directRole) === fromWorkspace ? 'workspace' : 'direct';
  return { ...person, role, origin };
}

export async function listProjectMembers(deps: MemberDeps, actor: Actor, projectId: string): Promise<{ items: ProjectMember[] }> {
  const access = await requireProject(deps.db, actor.userId, projectId);
  const [orgMembers, direct] = await Promise.all([
    deps.db.member.findMany({
      where: { organizationId: access.project.organizationId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, role: true, user: { select: { name: true, avatarAssetId: true } } },
    }),
    deps.db.projectMember.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, role: true, user: { select: { name: true, avatarAssetId: true } } },
    }),
  ]);
  const directByUser = new Map(direct.map((row) => [row.userId, row]));
  const items: ProjectMember[] = [];
  for (const member of orgMembers) {
    const person = { userId: member.userId, name: member.user.name, avatarAssetId: member.user.avatarAssetId };
    const entry = effectiveMember(access, person, member.role, directByUser.get(member.userId)?.role ?? null);
    directByUser.delete(member.userId);
    if (entry) items.push(entry);
  }
  for (const guest of directByUser.values()) {
    const person = { userId: guest.userId, name: guest.user.name, avatarAssetId: guest.user.avatarAssetId };
    const entry = effectiveMember(access, person, null, guest.role);
    if (entry) items.push(entry);
  }
  return { items };
}

export async function putProjectMember(
  deps: MemberDeps,
  actor: Actor,
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<ProjectMember> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'project:members');
  if (!roleAtLeast(access.role, role)) throw new AppError('FORBIDDEN');

  // Solo personas del espacio o que ya tienen acceso directo; el resto entra por invitación.
  const [user, orgMember, existing] = await Promise.all([
    deps.db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, avatarAssetId: true } }),
    deps.db.member.findFirst({ where: { organizationId: access.project.organizationId, userId }, select: { role: true } }),
    deps.db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { role: true } }),
  ]);
  if (!user || (!orgMember && !existing)) throw new AppError('NOT_FOUND');

  if (existing?.role !== role) {
    await deps.db.$transaction(async (tx) => {
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { projectId, userId, role, addedById: actor.userId },
        update: { role },
      });
      await recordActivity(tx, {
        type: existing ? 'member.role_changed' : 'member.added',
        actorId: actor.userId,
        projectId,
        data: existing ? { userId, role, previousRole: existing.role } : { userId, role },
      });
    });
    await publishAccessChanged(deps, projectId, userId);
  }

  const entry = effectiveMember(
    access,
    { userId: user.id, name: user.name, avatarAssetId: user.avatarAssetId },
    orgMember?.role ?? null,
    role,
  );
  if (!entry) throw new AppError('NOT_FOUND');
  return entry;
}

export async function deleteProjectMember(deps: MemberDeps, actor: Actor, projectId: string, userId: string): Promise<void> {
  const access = await requireProject(deps.db, actor.userId, projectId);
  if (userId !== actor.userId && !can(access.role, 'project:members')) throw new AppError('FORBIDDEN');
  const removed = await deps.db.$transaction(async (tx) => {
    const { count } = await tx.projectMember.deleteMany({ where: { projectId, userId } });
    if (count > 0) {
      await recordActivity(tx, {
        type: userId === actor.userId ? 'member.left' : 'member.removed',
        actorId: actor.userId,
        projectId,
        data: { userId },
      });
    }
    return count > 0;
  });
  if (removed) await publishAccessChanged(deps, projectId, userId);
}
