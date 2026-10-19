import { APIError } from 'better-auth/api';
import type { z } from 'zod';
import { ensurePersonalWorkspace, SESSION_FRESH_AGE_SECONDS, type Auth } from '../../../core/auth/index.js';
import type { Db } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { publishOrgEvent } from '../../../core/events.js';
import type { LogSink } from '../../../core/logger.js';
import type { Redis } from '../../../core/redis.js';
import { ORG_ROLES, type OrgRole } from '../../../shared/permissions.js';
import type { Actor } from '../../types.js';
import {
  LocaleSchema,
  SECURITY_EVENT_TYPES,
  type MeResponse,
  type SecurityEvent,
  type SecurityEventsQuerySchema,
  type SetPasswordBodySchema,
  type UpdateMeBodySchema,
} from './schemas.js';

export interface MeDeps {
  db: Db;
  redis: Redis;
  auth: Auth;
  logger: LogSink;
}

type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;
type SecurityEventsQuery = z.infer<typeof SecurityEventsQuerySchema>;

function isOrgRole(role: string): role is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(role);
}

async function loadWorkspaces(db: Db, userId: string) {
  const memberships = await db.member.findMany({
    where: { userId, organization: { deletedAt: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      organization: { select: { id: true, slug: true, name: true, personal: true, logoAssetId: true } },
    },
  });
  return memberships.flatMap(({ role, organization }) =>
    isOrgRole(role) ? [{ ...organization, role }] : [],
  );
}

export async function getMe(deps: MeDeps, actor: Actor): Promise<MeResponse> {
  const user = await deps.db.user.findUnique({
    where: { id: actor.userId },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      avatarAssetId: true,
      bio: true,
      locale: true,
      createdAt: true,
    },
  });
  if (!user) throw new AppError('UNAUTHORIZED');

  let workspaces = await loadWorkspaces(deps.db, user.id);
  if (!workspaces.some((workspace) => workspace.personal && workspace.role === 'owner')) {
    try {
      const created = await ensurePersonalWorkspace(
        { db: deps.db, redis: deps.redis, createOrganization: () => (body) => deps.auth.api.createOrganization({ body }) },
        user,
      );
      if (created) workspaces = await loadWorkspaces(deps.db, user.id);
    } catch (error) {
      deps.logger.error(
        { err: { message: (error as Error).message }, userId: user.id },
        'No se pudo crear el espacio personal',
      );
    }
  }

  const locale = LocaleSchema.safeParse(user.locale);
  return {
    user: {
      ...user,
      locale: locale.success ? locale.data : 'es',
      createdAt: user.createdAt.toISOString(),
    },
    workspaces,
  };
}

export async function updateMe(deps: MeDeps, actor: Actor, headers: Headers, body: UpdateMeBody): Promise<MeResponse> {
  if (body.avatarAssetId) {
    const asset = await deps.db.asset.findFirst({
      where: { id: body.avatarAssetId, ownerId: actor.userId, source: 'avatar', status: 'ready', deletedAt: null },
      select: { id: true },
    });
    if (!asset) throw new AppError('INVALID_ASSET');
  }

  if (body.name !== undefined) await deps.auth.api.updateUser({ headers, body: { name: body.name } });

  const data: { bio?: string | null; locale?: string; avatarAssetId?: string | null } = {};
  if (body.bio !== undefined) data.bio = body.bio === '' ? null : body.bio;
  if (body.locale !== undefined) data.locale = body.locale;
  if (body.avatarAssetId !== undefined) data.avatarAssetId = body.avatarAssetId;
  if (Object.keys(data).length > 0) await deps.db.user.update({ where: { id: actor.userId }, data });

  return getMe(deps, actor);
}

function stringField(data: unknown, key: string): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

// Solo eventos security.* del propio usuario, del más reciente al más antiguo.
export async function listSecurityEvents(
  deps: MeDeps,
  actor: Actor,
  query: SecurityEventsQuery,
): Promise<{ items: SecurityEvent[]; nextCursor: string | null }> {
  const rows = await deps.db.activityEvent.findMany({
    where: { actorId: actor.userId, projectId: null, type: { in: [...SECURITY_EVENT_TYPES] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: { id: true, type: true, data: true, createdAt: true },
  });
  const items = rows.slice(0, query.limit);
  return {
    items: items.map((row) => ({
      id: row.id,
      type: row.type as SecurityEvent['type'],
      createdAt: row.createdAt.toISOString(),
      ipAddress: stringField(row.data, 'ipAddress'),
      userAgent: stringField(row.data, 'userAgent'),
      provider: stringField(row.data, 'provider'),
    })),
    nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
  };
}

function assertFresh(sessionCreatedAt: Date) {
  if (Date.now() - sessionCreatedAt.getTime() >= SESSION_FRESH_AGE_SECONDS * 1000) {
    throw new AppError('SESSION_NOT_FRESH');
  }
}

// «Crear contraseña» en cuentas que solo entran con Google; setPassword solo existe en el servidor.
export async function setPassword(
  deps: MeDeps,
  headers: Headers,
  sessionCreatedAt: Date,
  body: z.infer<typeof SetPasswordBodySchema>,
): Promise<void> {
  assertFresh(sessionCreatedAt);
  try {
    await deps.auth.api.setPassword({ headers, body: { newPassword: body.newPassword } });
  } catch (error) {
    if (error instanceof APIError) {
      const code = (error.body as { code?: unknown } | undefined)?.code;
      if (code === 'PASSWORD_ALREADY_SET') throw new AppError('CONFLICT');
      if (error.statusCode === 401) throw new AppError('UNAUTHORIZED');
      throw new AppError('VALIDATION_FAILED');
    }
    throw error;
  }
}

export async function deleteMe(deps: MeDeps, actor: Actor, sessionCreatedAt: Date): Promise<void> {
  assertFresh(sessionCreatedAt);
  const userId = actor.userId;

  const trashed = await deps.db.$transaction(async (tx) => {
    const memberships = await tx.member.findMany({
      where: { userId },
      select: {
        role: true,
        organizationId: true,
        organization: {
          select: { slug: true, name: true, personal: true, deletedAt: true, _count: { select: { members: true } } },
        },
      },
    });

    const shared = memberships.filter(
      (m) => m.role === 'owner' && !m.organization.personal && m.organization.deletedAt === null && m.organization._count.members > 1,
    );
    if (shared.length > 0) {
      const otherOwners = await tx.member.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: shared.map((m) => m.organizationId) }, role: 'owner', userId: { not: userId } },
        _count: { _all: true },
      });
      const covered = new Set(otherOwners.map((row) => row.organizationId));
      const conflicts = shared.filter((m) => !covered.has(m.organizationId));
      if (conflicts.length > 0) {
        throw new AppError('MUST_TRANSFER_OWNERSHIP', {
          details: { workspaces: conflicts.map((m) => ({ slug: m.organization.slug, name: m.organization.name })) },
        });
      }
    }

    const toTrash = memberships
      .filter((m) => (m.organization.personal && m.role === 'owner') || m.organization._count.members === 1)
      .map((m) => m.organizationId);
    const now = new Date();
    if (toTrash.length > 0) {
      await tx.organization.updateMany({ where: { id: { in: toTrash }, deletedAt: null }, data: { deletedAt: now } });
    }
    await tx.asset.updateMany({ where: { ownerId: userId, source: 'avatar', deletedAt: null }, data: { deletedAt: now } });
    await tx.favorite.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
    return toTrash;
  });

  // Las filas de session ya cayeron en cascada; queda borrar las copias de Redis.
  try {
    const context = await deps.auth.$context;
    await context.internalAdapter.deleteUserSessions(userId);
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message }, userId }, 'No se pudieron borrar las sesiones en caché');
  }

  for (const organizationId of trashed) {
    await publishOrgEvent(deps.redis, organizationId, { type: 'workspace.deleted' }).catch((error: unknown) =>
      deps.logger.error(
        { err: { message: (error as Error).message }, organizationId },
        'No se pudo publicar workspace.deleted',
      ),
    );
  }
}
