import { APIError } from 'better-auth/api';
import type { z } from 'zod';
import { recordActivity } from '../../../core/activity.js';
import { callAuth, toAppError } from '../../../core/auth/errors.js';
import { isSlugTaken } from '../../../core/auth/hooks.js';
import type { Auth } from '../../../core/auth/index.js';
import { withUniqueSlug } from '../../../core/auth/slug.js';
import type { Db } from '../../../core/db.js';
import { AppError, type ErrorCode } from '../../../core/errors.js';
import { publishOrgEvent } from '../../../core/events.js';
import type { LogSink } from '../../../core/logger.js';
import { isOrgRole, purgeAtOf, requireWorkspace, type WorkspaceAccess } from '../../../core/permissions.js';
import { takeRateSlots } from '../../../core/rate-limit.js';
import type { Redis } from '../../../core/redis.js';
import { WORKSPACE_INVITE_ROLES } from '../../../shared/api/workspaces.js';
import type { OrgRole } from '../../../shared/permissions.js';
import type { Actor } from '../../types.js';
import type {
  AcceptInvitationResponseSchema,
  CreateWorkspaceInvitationBodySchema,
  ReceivedInvitationSchema,
  WorkspaceInvitationSchema,
  CreateWorkspaceBodySchema,
  UpdateWorkspaceBodySchema,
  UpdateWorkspaceMemberBodySchema,
  WorkspaceDetailSchema,
  WorkspaceMemberSchema,
  WorkspaceMembersQuerySchema,
  WorkspaceMembersResponseSchema,
  WorkspaceSchema,
} from './schemas.js';

export interface WorkspaceDeps {
  db: Db;
  redis: Redis;
  auth: Auth;
  logger: LogSink;
}

type Workspace = z.infer<typeof WorkspaceSchema>;
type WorkspaceDetail = z.infer<typeof WorkspaceDetailSchema>;
type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

const workspaceSelect = { id: true, slug: true, name: true, personal: true, logoAssetId: true, deletedAt: true } as const;

function toWorkspace(org: WorkspaceAccess['workspace'], role: OrgRole): Workspace {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    personal: org.personal,
    role,
    logoAssetId: org.logoAssetId,
    deletedAt: org.deletedAt?.toISOString() ?? null,
    purgeAt: purgeAtOf(org.deletedAt)?.toISOString() ?? null,
  };
}

async function publishSafely(deps: WorkspaceDeps, organizationId: string, event: Parameters<typeof publishOrgEvent>[2]) {
  try {
    await publishOrgEvent(deps.redis, organizationId, event);
  } catch (error) {
    deps.logger.error(
      { err: { message: (error as Error).message }, organizationId, event: event.type },
      'No se pudo publicar el evento del espacio',
    );
  }
}

export async function listWorkspaces(deps: WorkspaceDeps, actor: Actor): Promise<{ items: Workspace[] }> {
  const memberships = await deps.db.member.findMany({
    where: {
      userId: actor.userId,
      OR: [{ organization: { deletedAt: null } }, { role: 'owner', organization: { deletedAt: { not: null } } }],
    },
    orderBy: { createdAt: 'asc' },
    select: { role: true, organization: { select: workspaceSelect } },
  });
  return {
    items: memberships.flatMap(({ role, organization }) => (isOrgRole(role) ? [toWorkspace(organization, role)] : [])),
  };
}

async function detailOf(deps: WorkspaceDeps, access: WorkspaceAccess): Promise<WorkspaceDetail> {
  const [members, projects] = await Promise.all([
    deps.db.member.count({ where: { organizationId: access.workspace.id } }),
    deps.db.project.count({ where: { organizationId: access.workspace.id, deletedAt: null } }),
  ]);
  return { ...toWorkspace(access.workspace, access.role), counts: { members, projects } };
}

export async function createWorkspace(
  deps: WorkspaceDeps,
  actor: Actor,
  headers: Headers,
  body: z.infer<typeof CreateWorkspaceBodySchema>,
): Promise<WorkspaceDetail> {
  const created = await withUniqueSlug(body.name, async (slug) => {
    const taken = await deps.db.organization.findUnique({ where: { slug }, select: { id: true } });
    if (taken) return null;
    try {
      return await callAuth(() =>
        deps.auth.api.createOrganization({
          headers,
          body: { name: body.name, slug, keepCurrentActiveOrganization: true },
        }),
      );
    } catch (error) {
      if (isSlugTaken(error)) return null;
      throw error;
    }
  });
  const access = await requireWorkspace(deps.db, actor.userId, created.slug);
  return detailOf(deps, access);
}

export async function getWorkspace(deps: WorkspaceDeps, actor: Actor, slug: string): Promise<WorkspaceDetail> {
  const access = await requireWorkspace(deps.db, actor.userId, slug, { allowTrash: true });
  return detailOf(deps, access);
}

export async function updateWorkspace(
  deps: WorkspaceDeps,
  actor: Actor,
  slug: string,
  body: z.infer<typeof UpdateWorkspaceBodySchema>,
): Promise<WorkspaceDetail> {
  const access = await requireWorkspace(deps.db, actor.userId, slug, { minRole: 'admin' });
  if (body.logoAssetId) {
    const logo = await deps.db.asset.findFirst({
      where: {
        id: body.logoAssetId,
        source: 'logo',
        status: 'ready',
        organizationId: access.workspace.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!logo) throw new AppError('INVALID_ASSET');
  }
  const data: { name?: string; logoAssetId?: string | null } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.logoAssetId !== undefined) data.logoAssetId = body.logoAssetId;
  if (Object.keys(data).length > 0) {
    const updated = await deps.db.organization.update({
      where: { id: access.workspace.id },
      data,
      select: workspaceSelect,
    });
    access.workspace = updated;
  }
  return detailOf(deps, access);
}

export async function deleteWorkspace(deps: WorkspaceDeps, actor: Actor, slug: string): Promise<void> {
  const access = await requireWorkspace(deps.db, actor.userId, slug, { minRole: 'owner' });
  if (access.workspace.personal) throw new AppError('PERSONAL_WORKSPACE');
  await deps.db.organization.update({ where: { id: access.workspace.id }, data: { deletedAt: new Date() } });
  await publishSafely(deps, access.workspace.id, { type: 'workspace.deleted' });
}

export async function restoreWorkspace(deps: WorkspaceDeps, actor: Actor, slug: string): Promise<WorkspaceDetail> {
  const access = await requireWorkspace(deps.db, actor.userId, slug, { minRole: 'owner', allowTrash: true });
  if (access.workspace.deletedAt) {
    access.workspace = await deps.db.organization.update({
      where: { id: access.workspace.id },
      data: { deletedAt: null },
      select: workspaceSelect,
    });
  }
  return detailOf(deps, access);
}

const memberSelect = {
  id: true,
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { name: true, email: true, avatarAssetId: true } },
} as const;

function toMember(row: {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: { name: string; email: string; avatarAssetId: string | null };
}): WorkspaceMember | null {
  if (!isOrgRole(row.role)) return null;
  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    avatarAssetId: row.user.avatarAssetId,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMembers(
  deps: WorkspaceDeps,
  actor: Actor,
  slug: string,
  query: z.infer<typeof WorkspaceMembersQuerySchema>,
): Promise<z.infer<typeof WorkspaceMembersResponseSchema>> {
  const access = await requireWorkspace(deps.db, actor.userId, slug);
  const rows = await deps.db.member.findMany({
    where: { organizationId: access.workspace.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: memberSelect,
  });
  const page = rows.slice(0, query.limit);
  return {
    items: page.flatMap((row) => {
      const member = toMember(row);
      return member ? [member] : [];
    }),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

async function findTarget(deps: WorkspaceDeps, access: WorkspaceAccess, memberId: string) {
  const target = await deps.db.member.findFirst({
    where: { id: memberId, organizationId: access.workspace.id },
    select: memberSelect,
  });
  if (!target || !isOrgRole(target.role)) throw new AppError('NOT_FOUND');
  return { ...target, role: target.role };
}

async function ownerCount(deps: WorkspaceDeps, organizationId: string): Promise<number> {
  return deps.db.member.count({ where: { organizationId, role: 'owner' } });
}

export async function updateMember(
  deps: WorkspaceDeps,
  actor: Actor,
  headers: Headers,
  slug: string,
  memberId: string,
  body: z.infer<typeof UpdateWorkspaceMemberBodySchema>,
): Promise<WorkspaceMember> {
  const access = await requireWorkspace(deps.db, actor.userId, slug, { minRole: 'admin' });
  const target = await findTarget(deps, access, memberId);
  if (target.role === body.role) return toMember(target)!;
  if ((target.role === 'owner' || body.role === 'owner') && access.role !== 'owner') throw new AppError('FORBIDDEN');
  if (target.role === 'owner' && (await ownerCount(deps, access.workspace.id)) <= 1) throw new AppError('LAST_OWNER');

  await callAuth(() =>
    deps.auth.api.updateMemberRole({
      headers,
      body: { memberId: target.id, role: body.role, organizationId: access.workspace.id },
    }),
  );
  await recordActivity(deps.db, {
    type: 'member.role_changed',
    actorId: actor.userId,
    data: { organizationId: access.workspace.id, userId: target.userId, role: body.role, previousRole: target.role },
  });
  return toMember({ ...target, role: body.role })!;
}

export async function removeMember(
  deps: WorkspaceDeps,
  actor: Actor,
  headers: Headers,
  slug: string,
  memberId: string,
): Promise<void> {
  const access = await requireWorkspace(deps.db, actor.userId, slug);
  const target = await findTarget(deps, access, memberId);
  const organizationId = access.workspace.id;

  if (target.userId === actor.userId) {
    if (access.workspace.personal && target.role === 'owner') throw new AppError('PERSONAL_WORKSPACE');
    if (target.role === 'owner' && (await ownerCount(deps, organizationId)) <= 1) throw new AppError('LAST_OWNER');
    await callAuth(() => deps.auth.api.leaveOrganization({ headers, body: { organizationId } }));
    await recordActivity(deps.db, {
      type: 'member.left',
      actorId: actor.userId,
      data: { organizationId, userId: actor.userId },
    });
    // leave no pasa por los hooks de expulsión: el aviso lo publica el servicio.
    await publishSafely(deps, organizationId, { type: 'access.changed', userId: actor.userId });
    return;
  }

  if (access.role === 'member') throw new AppError('FORBIDDEN');
  if (target.role === 'owner' && access.role !== 'owner') throw new AppError('FORBIDDEN');
  if (target.role === 'owner' && (await ownerCount(deps, organizationId)) <= 1) throw new AppError('LAST_OWNER');
  await callAuth(() =>
    deps.auth.api.removeMember({ headers, body: { memberIdOrEmail: target.id, organizationId } }),
  );
  await recordActivity(deps.db, {
    type: 'member.removed',
    actorId: actor.userId,
    data: { organizationId, userId: target.userId, role: target.role },
  });
}

export const WORKSPACE_INVITATIONS_PER_DAY = 50;
const DAY_MS = 86_400_000;

type InviteRole = (typeof WORKSPACE_INVITE_ROLES)[number];
type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>;
type ReceivedInvitation = z.infer<typeof ReceivedInvitationSchema>;

function isInviteRole(role: string): role is InviteRole {
  return (WORKSPACE_INVITE_ROLES as readonly string[]).includes(role);
}

function authErrorCode(error: unknown): string | null {
  if (!(error instanceof APIError)) return null;
  const code = (error.body as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

const invitationSelect = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
} as const;

function toInvitation(row: {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
  user: { id: string; name: string };
}): WorkspaceInvitation | null {
  if (!isInviteRole(row.role)) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    inviter: { id: row.user.id, name: row.user.name },
  };
}

export async function listInvitations(
  deps: WorkspaceDeps,
  actor: Actor,
  slug: string,
): Promise<{ items: WorkspaceInvitation[] }> {
  const access = await requireWorkspace(deps.db, actor.userId, slug, { minRole: 'admin' });
  const rows = await deps.db.invitation.findMany({
    where: { organizationId: access.workspace.id, status: 'pending', expiresAt: { gt: new Date() } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: invitationSelect,
  });
  return {
    items: rows.flatMap((row) => {
      const invitation = toInvitation(row);
      return invitation ? [invitation] : [];
    }),
  };
}

export async function createInvitation(
  deps: WorkspaceDeps,
  actor: Actor,
  headers: Headers,
  slug: string,
  body: z.infer<typeof CreateWorkspaceInvitationBodySchema>,
): Promise<WorkspaceInvitation> {
  const access = await requireWorkspace(deps.db, actor.userId, slug, { minRole: 'admin' });
  // El cupo es del espacio y solo lo gastan sus admins.
  await takeRateSlots(deps.redis, [
    { key: `ws-invite:${access.workspace.id}`, max: WORKSPACE_INVITATIONS_PER_DAY, windowMs: DAY_MS },
  ]);
  const created = await callAuth(async () => {
    try {
      return await deps.auth.api.createInvitation({
        headers,
        body: { email: body.email, role: body.role, organizationId: access.workspace.id },
      });
    } catch (error) {
      const code = authErrorCode(error);
      if (code === 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION') {
        throw new AppError('CONFLICT', { message: 'Esa persona ya es miembro del espacio.', cause: error });
      }
      if (code === 'INVITATION_LIMIT_REACHED') {
        throw new AppError('CONFLICT', { message: 'El espacio tiene demasiadas invitaciones pendientes.', cause: error });
      }
      throw error;
    }
  });
  const row = await deps.db.invitation.findUniqueOrThrow({ where: { id: created.id }, select: invitationSelect });
  const invitation = toInvitation(row);
  if (!invitation) throw new AppError('INTERNAL');
  return invitation;
}

export async function cancelInvitation(
  deps: WorkspaceDeps,
  actor: Actor,
  headers: Headers,
  slug: string,
  invitationId: string,
): Promise<void> {
  const access = await requireWorkspace(deps.db, actor.userId, slug, { minRole: 'admin' });
  const invitation = await deps.db.invitation.findFirst({
    where: { id: invitationId, organizationId: access.workspace.id },
    select: { status: true },
  });
  if (!invitation) throw new AppError('INVITE_NOT_FOUND');
  if (invitation.status === 'canceled') return;
  if (invitation.status !== 'pending') throw new AppError('INVITE_ALREADY_HANDLED');
  await callAuth(() => deps.auth.api.cancelInvitation({ headers, body: { invitationId } }));
}

const receivedSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  organizationId: true,
  organization: { select: { name: true, slug: true, deletedAt: true } },
  user: { select: { name: true } },
} as const;

// Inexistente, de otro email o de un espacio en papelera: la misma respuesta, para no revelar invitaciones ajenas.
async function findReceived(deps: WorkspaceDeps, actor: Actor, invitationId: string) {
  const [user, invitation] = await Promise.all([
    deps.db.user.findUnique({ where: { id: actor.userId }, select: { email: true } }),
    deps.db.invitation.findUnique({ where: { id: invitationId }, select: receivedSelect }),
  ]);
  if (
    !user ||
    !invitation ||
    invitation.email.toLowerCase() !== user.email.toLowerCase() ||
    invitation.organization.deletedAt ||
    !isInviteRole(invitation.role)
  ) {
    throw new AppError('INVITE_NOT_FOUND');
  }
  return { ...invitation, role: invitation.role };
}

function statusOf(invitation: { status: string; expiresAt: Date }): ReceivedInvitation['status'] {
  if (invitation.status === 'pending') return invitation.expiresAt.getTime() <= Date.now() ? 'expired' : 'pending';
  if (invitation.status === 'accepted' || invitation.status === 'rejected') return invitation.status;
  return 'canceled';
}

function rejectionOf(invitation: { status: string; expiresAt: Date }, slug: string): AppError | null {
  const status = statusOf(invitation);
  if (status === 'pending') return null;
  if (status === 'expired') return new AppError('INVITE_EXPIRED');
  return new AppError('INVITE_ALREADY_HANDLED', status === 'accepted' ? { details: { slug } } : {});
}

// Traduce los errores de accept/reject de Better Auth; si la invitación cambió entre medias, se relee el motivo.
async function invitationActionError(deps: WorkspaceDeps, invitationId: string, slug: string, error: unknown): Promise<unknown> {
  const code = authErrorCode(error);
  const known: Record<string, ErrorCode> = {
    YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: 'INVITE_NOT_FOUND',
    ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: 'MEMBERSHIP_LIMIT',
    EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION: 'EMAIL_NOT_VERIFIED',
  };
  if (code && known[code]) return new AppError(known[code], { cause: error });
  if (code === 'INVITATION_NOT_FOUND' || code === 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION') {
    const fresh = await deps.db.invitation.findUnique({ where: { id: invitationId }, select: { status: true, expiresAt: true } });
    if (!fresh) return new AppError('INVITE_NOT_FOUND', { cause: error });
    return rejectionOf(fresh, slug) ?? new AppError('INVITE_ALREADY_HANDLED', { cause: error });
  }
  return error;
}

export async function getReceivedInvitation(
  deps: WorkspaceDeps,
  actor: Actor,
  invitationId: string,
): Promise<ReceivedInvitation> {
  const invitation = await findReceived(deps, actor, invitationId);
  return {
    id: invitation.id,
    workspace: { name: invitation.organization.name, slug: invitation.organization.slug },
    role: invitation.role,
    inviter: { name: invitation.user.name },
    status: statusOf(invitation),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function acceptInvitation(
  deps: WorkspaceDeps,
  actor: Actor,
  headers: Headers,
  invitationId: string,
): Promise<z.infer<typeof AcceptInvitationResponseSchema>> {
  const invitation = await findReceived(deps, actor, invitationId);
  const slug = invitation.organization.slug;
  const rejection = rejectionOf(invitation, slug);
  if (rejection) throw rejection;
  const already = await deps.db.member.findFirst({
    where: { organizationId: invitation.organizationId, userId: actor.userId },
    select: { id: true },
  });
  if (already) throw new AppError('INVITE_ALREADY_HANDLED', { details: { slug } });

  try {
    await deps.auth.api.acceptInvitation({ headers, body: { invitationId } });
  } catch (error) {
    const mapped = await invitationActionError(deps, invitationId, slug, error);
    throw mapped === error ? toAppError(error) : mapped;
  }
  await recordActivity(deps.db, {
    type: 'member.added',
    actorId: actor.userId,
    data: { organizationId: invitation.organizationId, userId: actor.userId, role: invitation.role, via: 'invitation' },
  });
  return { slug };
}

export async function rejectInvitation(
  deps: WorkspaceDeps,
  actor: Actor,
  headers: Headers,
  invitationId: string,
): Promise<void> {
  const invitation = await findReceived(deps, actor, invitationId);
  const slug = invitation.organization.slug;
  // Rechazar una invitación caducada también la cierra.
  if (invitation.status !== 'pending') throw rejectionOf(invitation, slug) ?? new AppError('INVITE_ALREADY_HANDLED');
  try {
    await deps.auth.api.rejectInvitation({ headers, body: { invitationId } });
  } catch (error) {
    const mapped = await invitationActionError(deps, invitationId, slug, error);
    throw mapped === error ? toAppError(error) : mapped;
  }
}
