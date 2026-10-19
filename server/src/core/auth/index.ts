import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { organization } from 'better-auth/plugins/organization';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { LogSink } from '../logger.js';
import type { Mailer } from '../mailer/index.js';
import type { Redis } from '../redis.js';
import { ac, roles } from './access-control.js';
import { DISABLED_AUTH_PATHS } from './disabled-paths.js';
import {
  buildDatabaseHooks,
  buildOrganizationHooks,
  INVITATION_EXPIRES_IN_SECONDS,
  invitationSender,
  OTP_EXPIRES_IN_SECONDS,
  otpSender,
  rejectOtpSignIn,
  type CreateOrganization,
} from './hooks.js';

export { DISABLED_AUTH_PATHS } from './disabled-paths.js';
export { ensurePersonalWorkspace } from './hooks.js';

export const AUTH_BASE_PATH = '/api/auth';
export const CLIENT_IP_HEADER = 'x-parcify-client-ip';
export const SECONDARY_STORAGE_PREFIX = 'parcify:ba:';
export const SESSION_FRESH_AGE_SECONDS = 60 * 60 * 2;

export const AUTH_RATE_LIMITS = {
  '/sign-in/email': { window: 60, max: 5 },
  '/sign-up/email': { window: 60, max: 3 },
  '/email-otp/send-verification-otp': { window: 60, max: 3 },
  '/email-otp/request-password-reset': { window: 60, max: 3 },
  '/email-otp/verify-email': { window: 60, max: 10 },
  '/email-otp/reset-password': { window: 60, max: 5 },
  '/email-otp/request-email-change': { window: 60, max: 3 },
  '/email-otp/change-email': { window: 60, max: 5 },
};

type SecondaryStorage = NonNullable<BetterAuthOptions['secondaryStorage']>;

export function redisSecondaryStorage(redis: Redis, prefix = SECONDARY_STORAGE_PREFIX): SecondaryStorage {
  const key = (name: string) => prefix + name;
  return {
    get: (name) => redis.get(key(name)),
    getAndDelete: (name) => redis.getdel(key(name)),
    set: async (name, value, ttl) => {
      if (ttl && ttl > 0) await redis.set(key(name), value, 'EX', Math.ceil(ttl));
      else await redis.set(key(name), value);
    },
    delete: async (name) => {
      await redis.del(key(name));
    },
    // SET NX + INCR en MULTI: el TTL se fija solo al crear el contador.
    increment: async (name, ttl) => {
      const results = await redis
        .multi()
        .set(key(name), '0', 'EX', Math.max(1, Math.ceil(ttl)), 'NX')
        .incr(key(name))
        .exec();
      const [error, value] = results?.[1] ?? [new Error('MULTI sin respuesta'), null];
      if (error) throw error;
      return Number(value);
    },
  };
}

function authLogger(logger: LogSink): NonNullable<BetterAuthOptions['logger']> {
  return {
    level: 'warn',
    log: (level, message, ...args) => {
      const errors = args.filter((arg): arg is Error => arg instanceof Error).map((error) => error.message);
      const payload = errors.length > 0 ? { auth: true, errors } : { auth: true };
      if (level === 'error') logger.error(payload, message);
      else if (level === 'warn') logger.warn(payload, message);
      else if (level === 'info') logger.info(payload, message);
      else logger.debug(payload, message);
    },
  };
}

export interface AuthDeps {
  config: Config;
  db: Db;
  redis: Redis;
  mailer: Mailer;
  logger: LogSink;
}

export function createAuth({ config, db, redis, mailer, logger }: AuthDeps) {
  if (!config.betterAuthSecret) throw new Error('Falta BETTER_AUTH_SECRET');

  const late: { createOrganization?: CreateOrganization } = {};
  const hookDeps = {
    db,
    redis,
    mailer,
    logger,
    clientOrigin: config.clientOrigins[0]!,
    createOrganization: () => {
      if (!late.createOrganization) throw new Error('Better Auth aún no está listo');
      return late.createOrganization;
    },
  };

  const auth = betterAuth({
    appName: 'Parcify',
    baseURL: config.apiOrigin,
    basePath: AUTH_BASE_PATH,
    secret: config.betterAuthSecret,
    trustedOrigins: config.clientOrigins,
    database: prismaAdapter(db, { provider: 'postgresql' }),
    secondaryStorage: redisSecondaryStorage(redis),
    disabledPaths: [...DISABLED_AUTH_PATHS],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: { autoSignInAfterVerification: true },
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } }
      : {},
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: SESSION_FRESH_AGE_SECONDS,
      storeSessionInDatabase: true,
      preserveSessionInDatabase: false,
      cookieCache: { enabled: true, maxAge: 300, strategy: 'compact' },
    },
    rateLimit: { enabled: true, storage: 'secondary-storage', customRules: AUTH_RATE_LIMITS },
    advanced: {
      useSecureCookies: config.isProduction,
      cookiePrefix: 'parcify',
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    user: {
      additionalFields: {
        bio: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, defaultValue: 'es', input: false },
        avatarAssetId: { type: 'string', required: false, input: false },
      },
    },
    databaseHooks: buildDatabaseHooks(hookDeps),
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        disableSignUp: true,
        sendVerificationOnSignUp: true,
        overrideDefaultEmailVerification: true,
        // Código a la dirección nueva; el cambio solo se aplica al verificarlo.
        changeEmail: { enabled: true, verifyCurrentEmail: false },
        sendVerificationOTP: otpSender(mailer, logger),
      }),
      organization({
        allowUserToCreateOrganization: (user) => user.emailVerified === true,
        organizationLimit: 20,
        membershipLimit: 500,
        invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
        invitationLimit: 100,
        cancelPendingInvitationsOnReInvite: true,
        // /v1 ya lo exige; así tampoco auth.api.* acepta ni rechaza sin email verificado.
        requireEmailVerificationOnInvitation: true,
        ac,
        roles,
        sendInvitationEmail: invitationSender(hookDeps),
        disableOrganizationDeletion: true,
        organizationHooks: buildOrganizationHooks(hookDeps),
        schema: {
          organization: {
            additionalFields: {
              personal: { type: 'boolean', required: false, defaultValue: false, input: false },
              logoAssetId: { type: 'string', required: false, input: false },
              deletedAt: { type: 'date', required: false, input: false },
            },
          },
        },
      }),
    ],
    hooks: { before: rejectOtpSignIn },
    logger: authLogger(logger),
    telemetry: { enabled: false },
  });

  late.createOrganization = async (body) => auth.api.createOrganization({ body });
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
