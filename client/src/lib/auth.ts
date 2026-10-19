import { createAuthClient } from 'better-auth/client';
import { emailOTPClient, organizationClient } from 'better-auth/client/plugins';
import { API_ORIGIN } from './api.ts';

export const authClient = createAuthClient({
  baseURL: API_ORIGIN,
  basePath: '/api/auth',
  fetchOptions: { credentials: 'include' },
  plugins: [emailOTPClient(), organizationClient()],
});

// Resultado común de las acciones de acceso. «code» es el código de Better Auth, «NETWORK» o «UNKNOWN».
export type AuthResult = { ok: true } | { ok: false; code: string; status: number };

type BetterAuthResponse = { error: { code?: string | undefined; status: number } | null } | null | undefined;

async function run(call: () => Promise<BetterAuthResponse>): Promise<AuthResult> {
  try {
    const response = await call();
    const error = response?.error;
    if (!error) return { ok: true };
    return { ok: false, code: error.code ?? (error.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN'), status: error.status };
  } catch {
    return { ok: false, code: 'NETWORK', status: 0 };
  }
}

export const authActions = {
  signIn: (email: string, password: string) => run(() => authClient.signIn.email({ email, password })),

  // Redirección completa a Google; Better Auth navega a la URL de autorización que devuelve la API.
  signInWithGoogle: (callbackURL: string, errorCallbackURL: string) =>
    run(() => authClient.signIn.social({ provider: 'google', callbackURL, errorCallbackURL })),

  signUp: (name: string, email: string, password: string) =>
    run(() => authClient.signUp.email({ name, email, password })),

  verifyEmail: (email: string, otp: string) => run(() => authClient.emailOtp.verifyEmail({ email, otp })),

  sendVerificationOtp: (email: string) =>
    run(() => authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' })),

  requestPasswordReset: (email: string) => run(() => authClient.emailOtp.requestPasswordReset({ email })),

  resetPassword: (email: string, otp: string, password: string) =>
    run(() => authClient.emailOtp.resetPassword({ email, otp, password })),

  signOut: () => run(() => authClient.signOut()),
};

export type AuthActions = typeof authActions;

export type AuthData<T> = { ok: true; data: T } | { ok: false; code: string; status: number };

type BetterAuthData<T> = { data: T | null; error: { code?: string | undefined; status: number } | null };

async function read<T>(call: () => Promise<BetterAuthData<T>>): Promise<AuthData<T>> {
  try {
    const response = await call();
    if (response.error) {
      const code = response.error.code ?? (response.error.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN');
      return { ok: false, code, status: response.error.status };
    }
    return { ok: true, data: response.data as T };
  } catch {
    return { ok: false, code: 'NETWORK', status: 0 };
  }
}

export type AuthSessionItem = {
  id: string;
  token: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export type LinkedAccount = { id: string; providerId: string; accountId: string; createdAt: Date | string };

// Ajustes de cuenta: todas pasan por Better Auth con la cookie de sesión.
export const accountActions = {
  currentSessionToken: async () => {
    const result = await read(() => authClient.getSession({ query: { disableCookieCache: true } }));
    return result.ok ? (result.data?.session.token ?? null) : null;
  },
  listSessions: () => read<AuthSessionItem[]>(() => authClient.listSessions()),
  revokeSession: (token: string) => run(() => authClient.revokeSession({ token })),
  revokeOtherSessions: () => run(() => authClient.revokeOtherSessions()),
  listAccounts: () => read<LinkedAccount[]>(() => authClient.listAccounts()),
  linkGoogle: (callbackURL: string, errorCallbackURL: string) =>
    run(() => authClient.linkSocial({ provider: 'google', callbackURL, errorCallbackURL })),
  // accountId es el id de la fila de Better Auth, no el de Google.
  unlinkAccount: (accountId: string) => run(() => authClient.unlinkAccount({ accountId })),
  changePassword: (currentPassword: string, newPassword: string, revokeOtherSessions: boolean) =>
    run(() => authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })),
  requestEmailChange: (newEmail: string) => run(() => authClient.emailOtp.requestEmailChange({ newEmail })),
  changeEmail: (newEmail: string, otp: string) => run(() => authClient.emailOtp.changeEmail({ newEmail, otp })),
};

export type AccountActions = typeof accountActions;
