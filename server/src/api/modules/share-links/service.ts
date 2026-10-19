import type { z } from 'zod';
import { recordActivity } from '../../../core/activity.js';
import type { Db } from '../../../core/db.js';
import { AppError, type ErrorCode } from '../../../core/errors.js';
import { publishProjectEvent } from '../../../core/events.js';
import type { LogSink } from '../../../core/logger.js';
import { sendInBackground, templates, type Mailer } from '../../../core/mailer/index.js';
import { projectRoleFrom, requireProject } from '../../../core/permissions.js';
import type { Redis } from '../../../core/redis.js';
import { generateShareToken, hashToken, isShareToken, tokenHashEquals } from '../../../core/tokens.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  PROJECT_INVITATION_DAYS,
  type CreateShareLinkBodySchema,
  type CreatedShareLinkSchema,
  type ProjectInvitationBodySchema,
  type ProjectInvitationResponse,
  type ShareLink,
  type ShareLinkAcceptResponseSchema,
  type ShareLinkInspectSchema,
} from '../../../shared/api/share-links.js';
import { can, maxRole, roleAtLeast, type EffectiveRole, type ProjectRole } from '../../../shared/permissions.js';
import type { Actor } from '../../types.js';
import { putProjectMember } from '../members/service.js';

export interface ShareLinkDeps {
  db: Db;
  redis: Redis;
  mailer: Mailer;
  logger: LogSink;
  clientOrigin: string;
}

type Tx = Prisma.TransactionClient;
type LinkRole = ShareLink['role'];

const DAY_MS = 86_400_000;
const LIST_LIMIT = 200;
const ACCEPT_TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 };

const linkSelect = {
  id: true,
  role: true,
  email: true,
  maxUses: true,
  uses: true,
  expiresAt: true,
  createdById: true,
  createdAt: true,
} as const;

const linkWithProjectSelect = {
  ...linkSelect,
  tokenHash: true,
  projectId: true,
  revokedAt: true,
  project: {
    select: {
      name: true,
      orgAccess: true,
      organizationId: true,
      deletedAt: true,
      organization: { select: { name: true, deletedAt: true } },
    },
  },
} as const;

type LinkRow = Prisma.ProjectShareLinkGetPayload<{ select: typeof linkSelect }>;
type LinkWithProject = Prisma.ProjectShareLinkGetPayload<{ select: typeof linkWithProjectSelect }> & {
  role: LinkRole;
};

function isLinkRole(role: ProjectRole): role is LinkRole {
  return role === 'editor' || role === 'viewer';
}

function toShareLink(row: LinkRow & { role: LinkRole }): ShareLink {
  return {
    id: row.id,
    role: row.role,
    email: row.email,
    maxUses: row.maxUses,
    uses: row.uses,
    expiresAt: row.expiresAt.toISOString(),
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}

function shareUrl(deps: ShareLinkDeps, token: string): string {
  // En el fragmento: el navegador no lo envía al servidor ni en Referer.
  return `${deps.clientOrigin}/invitacion#t=${token}`;
}

async function publishAccessChanged(deps: ShareLinkDeps, projectId: string, userId: string) {
  try {
    await publishProjectEvent(deps.redis, projectId, { type: 'access.changed', userId });
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message }, projectId }, 'No se pudo publicar access.changed');
  }
}

async function insertLink(
  deps: ShareLinkDeps,
  actor: Actor,
  projectId: string,
  input: { role: LinkRole; expiresInDays: number; maxUses: number | null; email: string | null },
): Promise<{ link: ShareLink; token: string }> {
  const token = generateShareToken();
  const row = await deps.db.projectShareLink.create({
    data: {
      projectId,
      tokenHash: hashToken(token),
      role: input.role,
      email: input.email,
      maxUses: input.maxUses,
      expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
      createdById: actor.userId,
    },
    select: linkSelect,
  });
  return { link: toShareLink({ ...row, role: input.role }), token };
}

export async function listShareLinks(deps: ShareLinkDeps, actor: Actor, projectId: string): Promise<{ items: ShareLink[] }> {
  await requireProject(deps.db, actor.userId, projectId, 'project:share');
  const rows = await deps.db.projectShareLink.findMany({
    where: { projectId, revokedAt: null, expiresAt: { gt: new Date() }, role: { in: ['editor', 'viewer'] } },
    orderBy: { createdAt: 'desc' },
    take: LIST_LIMIT,
    select: linkSelect,
  });
  return {
    items: rows.flatMap((row) =>
      isLinkRole(row.role) && (row.maxUses === null || row.uses < row.maxUses) ? [toShareLink({ ...row, role: row.role })] : [],
    ),
  };
}

export async function createShareLink(
  deps: ShareLinkDeps,
  actor: Actor,
  projectId: string,
  body: z.infer<typeof CreateShareLinkBodySchema>,
): Promise<z.infer<typeof CreatedShareLinkSchema>> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'project:share');
  if (!roleAtLeast(access.role, body.role)) throw new AppError('FORBIDDEN');
  const { link, token } = await insertLink(deps, actor, projectId, {
    role: body.role,
    expiresInDays: body.expiresInDays,
    maxUses: body.maxUses ?? null,
    email: body.email ?? null,
  });
  return { ...link, url: shareUrl(deps, token) };
}

export async function revokeShareLink(deps: ShareLinkDeps, actor: Actor, projectId: string, linkId: string): Promise<void> {
  await requireProject(deps.db, actor.userId, projectId, 'project:share');
  const { count } = await deps.db.projectShareLink.updateMany({
    where: { id: linkId, projectId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count > 0) return;
  const exists = await deps.db.projectShareLink.findFirst({ where: { id: linkId, projectId }, select: { id: true } });
  if (!exists) throw new AppError('NOT_FOUND');
}

function rejectionOf(link: { revokedAt: Date | null; expiresAt: Date; maxUses: number | null; uses: number }): ErrorCode | null {
  if (link.revokedAt) return 'INVITE_REVOKED';
  if (link.expiresAt.getTime() <= Date.now()) return 'INVITE_EXPIRED';
  if (link.maxUses !== null && link.uses >= link.maxUses) return 'INVITE_USED_UP';
  return null;
}

// Token mal formado, inexistente o de un proyecto en papelera: misma respuesta.
async function findLink(db: Tx, token: string): Promise<LinkWithProject> {
  if (!isShareToken(token)) throw new AppError('INVITE_NOT_FOUND');
  const tokenHash = hashToken(token);
  const link = await db.projectShareLink.findUnique({ where: { tokenHash }, select: linkWithProjectSelect });
  if (
    !link ||
    !tokenHashEquals(link.tokenHash, tokenHash) ||
    !isLinkRole(link.role) ||
    link.project.deletedAt ||
    link.project.organization.deletedAt
  ) {
    throw new AppError('INVITE_NOT_FOUND');
  }
  return { ...link, role: link.role };
}

async function recipientOf(db: Tx, userId: string, link: LinkWithProject) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
  if (!user) throw new AppError('UNAUTHORIZED');
  if (link.email && link.email.toLowerCase() !== user.email.toLowerCase()) throw new AppError('INVITE_EMAIL_MISMATCH');
  return user;
}

async function currentAccessOf(db: Tx, userId: string, link: LinkWithProject) {
  const orgMember = await db.member.findFirst({
    where: { organizationId: link.project.organizationId, userId },
    select: { role: true },
  });
  const direct = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: link.projectId, userId } },
    select: { role: true },
  });
  const role = projectRoleFrom({
    orgRole: orgMember?.role,
    orgAccess: link.project.orgAccess,
    directRole: direct?.role,
    projectDeleted: false,
    workspaceDeleted: false,
  });
  return { role, direct: direct?.role ?? null };
}

// El enlace solo vale mientras quien lo creó pueda seguir concediendo ese rol.
async function assertCreatorCanGrant(db: Tx, link: LinkWithProject): Promise<void> {
  const creator = await currentAccessOf(db, link.createdById, link);
  if (!can(creator.role, 'project:share') || !roleAtLeast(creator.role, link.role)) {
    throw new AppError('INVITE_REVOKED');
  }
}

export async function inspectShareLink(
  deps: ShareLinkDeps,
  actor: Actor,
  token: string,
): Promise<z.infer<typeof ShareLinkInspectSchema>> {
  const link = await findLink(deps.db, token);
  await recipientOf(deps.db, actor.userId, link);
  const current = await currentAccessOf(deps.db, actor.userId, link);
  if (!roleAtLeast(current.role, link.role)) {
    const reason = rejectionOf(link);
    if (reason) throw new AppError(reason);
    await assertCreatorCanGrant(deps.db, link);
  }
  const inviter = await deps.db.user.findUnique({ where: { id: link.createdById }, select: { name: true } });
  return {
    project: { id: link.projectId, name: link.project.name },
    workspace: { name: link.project.organization.name },
    role: link.role,
    inviter,
    expiresAt: link.expiresAt.toISOString(),
    currentRole: current.role,
  };
}

export async function acceptShareLink(
  deps: ShareLinkDeps,
  actor: Actor,
  token: string,
): Promise<z.infer<typeof ShareLinkAcceptResponseSchema>> {
  const userId = actor.userId;
  const result = await deps.db.$transaction(async (tx) => {
    const link = await findLink(tx, token);
    const user = await recipientOf(tx, userId, link);
    if (!user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED');

    // Serializa las aceptaciones del mismo enlace: el rol actual se lee ya con la fila bloqueada.
    await tx.$queryRaw`SELECT "id" FROM "ProjectShareLink" WHERE "id" = ${link.id}::uuid FOR UPDATE`;
    const current = await currentAccessOf(tx, userId, link);
    if (roleAtLeast(current.role, link.role)) {
      return { projectId: link.projectId, role: current.role as ProjectRole, changed: false };
    }
    await assertCreatorCanGrant(tx, link);

    const consumed = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "ProjectShareLink" SET "uses" = "uses" + 1
      WHERE "id" = ${link.id}::uuid
        AND "revokedAt" IS NULL
        AND "expiresAt" > now()
        AND ("maxUses" IS NULL OR "uses" < "maxUses")
      RETURNING "id"`;
    if (consumed.length === 0) {
      const fresh = await tx.projectShareLink.findUnique({
        where: { id: link.id },
        select: { revokedAt: true, expiresAt: true, maxUses: true, uses: true },
      });
      throw new AppError(fresh ? (rejectionOf(fresh) ?? 'INVITE_USED_UP') : 'INVITE_NOT_FOUND');
    }

    // Nunca baja un rol directo que ya fuera mayor.
    const directRole = maxRole(current.direct, link.role) as ProjectRole;
    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: link.projectId, userId } },
      create: { projectId: link.projectId, userId, role: directRole, addedById: link.createdById },
      update: { role: directRole },
    });
    await recordActivity(tx, {
      type: current.direct ? 'member.role_changed' : 'member.added',
      actorId: userId,
      projectId: link.projectId,
      data: {
        userId,
        role: directRole,
        via: 'share_link',
        linkId: link.id,
        ...(current.direct ? { previousRole: current.direct } : {}),
      },
    });
    const role: EffectiveRole = maxRole(current.role, directRole);
    return { projectId: link.projectId, role: role as ProjectRole, changed: true };
  }, ACCEPT_TX_OPTIONS);

  if (result.changed) await publishAccessChanged(deps, result.projectId, userId);
  return { projectId: result.projectId, role: result.role };
}

export async function inviteToProject(
  deps: ShareLinkDeps,
  actor: Actor,
  projectId: string,
  body: z.infer<typeof ProjectInvitationBodySchema>,
): Promise<ProjectInvitationResponse> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'project:share');
  if (!roleAtLeast(access.role, body.role)) throw new AppError('FORBIDDEN');

  const target = await deps.db.user.findFirst({
    where: { email: { equals: body.email, mode: 'insensitive' } },
    select: { id: true },
  });
  const orgMember = target
    ? await deps.db.member.findFirst({
        where: { organizationId: access.project.organizationId, userId: target.id },
        select: { id: true },
      })
    : null;

  if (target && orgMember) {
    const existing = await deps.db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: target.id } },
      select: { role: true },
    });
    const role = maxRole(existing?.role ?? null, body.role) as ProjectRole;
    const member = await putProjectMember(deps, actor, projectId, target.id, role);
    return { kind: 'direct', member };
  }

  const { link, token } = await insertLink(deps, actor, projectId, {
    role: body.role,
    expiresInDays: PROJECT_INVITATION_DAYS,
    maxUses: 1,
    email: body.email,
  });
  const inviter = await deps.db.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  const mail = templates.projectInvitation({
    inviterName: inviter?.name ?? 'Alguien',
    projectName: access.project.name,
    role: body.role,
    url: shareUrl(deps, token),
    expiresInDays: PROJECT_INVITATION_DAYS,
  });
  void sendInBackground(deps.mailer, deps.logger, { to: body.email, ...mail }, { mail: 'invitation.project' });
  return { kind: 'link', link };
}
