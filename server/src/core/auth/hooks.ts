import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { Db } from '../db.js';
import { publishOrgEvent } from '../events.js';
import type { LogSink } from '../logger.js';
import { sendInBackground, templates, type Mailer } from '../mailer/index.js';
import type { Redis } from '../redis.js';
import { withUniqueSlug } from './slug.js';

export const OTP_EXPIRES_IN_SECONDS = 600;
export const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

const PERSONAL_LOCK_TTL_SECONDS = 30;
const MAX_WORKSPACE_NAME = 80;
const MAX_USER_AGENT = 300;
const EMAIL_CHANGE_PATHS = new Set(['/email-otp/change-email', '/change-email']);

type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';

export type CreateOrganization = (body: { name: string; slug: string; userId: string }) => Promise<{ id: string }>;

export interface HookDeps {
  db: Db;
  redis: Redis;
  mailer: Mailer;
  logger: LogSink;
  clientOrigin: string;
  // Se resuelve después de crear la instancia de Better Auth.
  createOrganization: () => CreateOrganization;
}

// La ruta solo admite verificar el email; forget-password va por /email-otp/request-password-reset.
export const rejectOtpSignIn = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/email-otp/send-verification-otp') return;
  const type = (ctx.body as { type?: unknown } | undefined)?.type;
  if (type !== 'email-verification') throw APIError.fromStatus('NOT_FOUND');
});

type OtpContext = { context?: { session?: { user?: { email?: unknown } } | null } } | undefined;

export function otpSender(mailer: Mailer, logger: LogSink) {
  return async ({ email, otp, type }: { email: string; otp: string; type: OtpType }, ctx?: OtpContext) => {
    if (type === 'sign-in') throw APIError.fromStatus('BAD_REQUEST');
    const minutes = OTP_EXPIRES_IN_SECONDS / 60;
    if (type === 'change-email') {
      // El código va a la dirección nueva; la actual solo recibe el aviso.
      void sendInBackground(mailer, logger, { to: email, ...templates.emailChangeCode({ code: otp, minutes }) }, { mail: 'otp.change-email' });
      const current = ctx?.context?.session?.user?.email;
      if (typeof current === 'string' && current !== email) {
        void sendInBackground(mailer, logger, { to: current, ...templates.emailChangeNotice({ newEmail: email }) }, { mail: 'notice.change-email' });
      }
      return;
    }
    const mail =
      type === 'forget-password'
        ? templates.passwordResetCode({ code: otp, minutes })
        : templates.verificationCode({ code: otp, minutes });
    void sendInBackground(mailer, logger, { to: email, ...mail }, { mail: `otp.${type}` });
  };
}

export function invitationSender(deps: Pick<HookDeps, 'mailer' | 'logger' | 'clientOrigin'>) {
  return async (data: {
    id: string;
    role: string;
    email: string;
    organization: { name: string };
    inviter: { user: { name: string } };
  }) => {
    const url = `${deps.clientOrigin}/invitacion?espacio=${encodeURIComponent(data.id)}`;
    const mail = templates.workspaceInvitation({
      inviterName: data.inviter.user.name,
      workspaceName: data.organization.name,
      role: data.role,
      url,
      expiresInDays: INVITATION_EXPIRES_IN_SECONDS / 86_400,
    });
    void sendInBackground(deps.mailer, deps.logger, { to: data.email, ...mail }, { mail: 'invitation.workspace' });
  };
}

async function recordSecurityEvent(
  deps: Pick<HookDeps, 'db' | 'logger'>,
  actorId: string,
  type: string,
  data: Record<string, string> = {},
) {
  try {
    await deps.db.activityEvent.create({ data: { actorId, type, data, projectId: null } });
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message }, type }, 'No se pudo registrar el evento de seguridad');
  }
}

export function isSlugTaken(error: unknown): boolean {
  if (error instanceof APIError) {
    const code = (error.body as { code?: unknown } | undefined)?.code;
    return code === 'ORGANIZATION_ALREADY_EXISTS' || code === 'ORGANIZATION_SLUG_ALREADY_TAKEN';
  }
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

export function personalWorkspaceName(userName: string): string {
  return `Espacio de ${userName}`.trim().slice(0, MAX_WORKSPACE_NAME).trim();
}

async function findPersonalWorkspace(db: Db, userId: string): Promise<string | null> {
  const org = await db.organization.findFirst({
    where: { personal: true, members: { some: { userId, role: 'owner' } } },
    select: { id: true },
  });
  return org?.id ?? null;
}

// Crea el espacio personal sin cabeceras: sin sesión y con userId, Better Auth lo trata como acción de sistema.
export async function ensurePersonalWorkspace(
  deps: Pick<HookDeps, 'db' | 'redis' | 'createOrganization'>,
  user: { id: string; name: string },
): Promise<string | null> {
  const existing = await findPersonalWorkspace(deps.db, user.id);
  if (existing) return existing;

  const lockKey = `parcify:lock:personal-ws:${user.id}`;
  const locked = await deps.redis.set(lockKey, '1', 'EX', PERSONAL_LOCK_TTL_SECONDS, 'NX');
  if (locked !== 'OK') return null;
  try {
    const again = await findPersonalWorkspace(deps.db, user.id);
    if (again) return again;
    const name = personalWorkspaceName(user.name);
    const createOrganization = deps.createOrganization();
    const org = await withUniqueSlug(name, async (slug) => {
      const taken = await deps.db.organization.findUnique({ where: { slug }, select: { id: true } });
      if (taken) return null;
      try {
        return await createOrganization({ name, slug, userId: user.id });
      } catch (error) {
        if (isSlugTaken(error)) return null;
        throw error;
      }
    });
    await deps.db.organization.update({ where: { id: org.id }, data: { personal: true } });
    return org.id;
  } finally {
    await deps.redis.del(lockKey).catch(() => undefined);
  }
}

type DatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>;

export function buildDatabaseHooks(deps: HookDeps): DatabaseHooks {
  // El after de update no recibe el valor anterior: el before marca la petición que cambia la contraseña.
  const passwordChanges = new WeakSet<object>();

  return {
    user: {
      create: {
        after: async (user) => {
          try {
            await ensurePersonalWorkspace(deps, { id: user.id, name: user.name });
          } catch (error) {
            deps.logger.error(
              { err: { message: (error as Error).message }, userId: user.id },
              'No se pudo crear el espacio personal',
            );
          }
        },
      },
      update: {
        // Verificar el email también escribe el campo email: solo cuenta la ruta de cambio de email.
        after: async (user, context) => {
          if (context && EMAIL_CHANGE_PATHS.has(context.path)) {
            await recordSecurityEvent(deps, user.id, 'security.email_changed');
          }
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          const data: Record<string, string> = { sessionId: session.id };
          if (session.ipAddress) data.ipAddress = session.ipAddress;
          if (session.userAgent) data.userAgent = session.userAgent.slice(0, MAX_USER_AGENT);
          await recordSecurityEvent(deps, session.userId, 'security.session_created', data);
        },
      },
      delete: {
        after: async (session) => {
          await recordSecurityEvent(deps, session.userId, 'security.session_revoked', { sessionId: session.id });
        },
      },
    },
    account: {
      create: {
        after: async (account, context) => {
          if (account.providerId !== 'credential') {
            await recordSecurityEvent(deps, account.userId, 'security.account_linked', { provider: account.providerId });
          } else if (context?.path !== '/sign-up/email') {
            // Una contraseña creada después del registro («Crear contraseña» en cuentas de Google).
            await recordSecurityEvent(deps, account.userId, 'security.password_changed');
          }
        },
      },
      update: {
        before: async (data, context) => {
          if (context && typeof data.password === 'string') passwordChanges.add(context);
        },
        after: async (account, context) => {
          if (context && passwordChanges.has(context)) {
            passwordChanges.delete(context);
            await recordSecurityEvent(deps, account.userId, 'security.password_changed');
          }
        },
      },
    },
  };
}

export function buildOrganizationHooks(deps: Pick<HookDeps, 'redis' | 'logger'>) {
  const publishAccessChanged = async (data: { member: { userId: string }; organization: { id: string } }) => {
    try {
      await publishOrgEvent(deps.redis, data.organization.id, { type: 'access.changed', userId: data.member.userId });
    } catch (error) {
      deps.logger.error(
        { err: { message: (error as Error).message }, organizationId: data.organization.id },
        'No se pudo publicar access.changed',
      );
    }
  };
  return { afterRemoveMember: publishAccessChanged, afterUpdateMemberRole: publishAccessChanged };
}
