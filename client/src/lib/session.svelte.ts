import sharedHash from '../shared/SHARED_HASH?raw';
import { MeResponseSchema, type MeResponse } from '../shared/api/me.js';
import { MetaResponseSchema } from '../shared/api/meta.js';
import { DOCUMENT_SCHEMA_VERSION } from '../shared/document/schema.js';
import { ApiError, apiFetch, cached, invalidateCache } from './api.ts';
import { clearLocalCopies } from './local-copies.ts';

export type SessionStatus = 'idle' | 'loading' | 'signed-in' | 'signed-out' | 'error';

export const session = $state<{ status: SessionStatus; me: MeResponse | null; error: ApiError | null }>({
  status: 'idle',
  me: null,
  error: null,
});

export const clientVersion = $state<{ reloadRequired: boolean }>({ reloadRequired: false });

// En páginas privadas, un 401 redirige al overlay de acceso; en las públicas solo marca «signed-out».
export async function loadSession(options: { redirectOn401?: boolean } = {}): Promise<MeResponse | null> {
  if (session.status === 'idle') session.status = 'loading';
  try {
    const me = await cached('me', () =>
      apiFetch('/v1/me', { schema: MeResponseSchema, redirectOn401: options.redirectOn401 ?? true }),
    );
    session.me = me;
    session.error = null;
    session.status = 'signed-in';
    return me;
  } catch (error) {
    session.me = null;
    if (error instanceof ApiError && error.status === 401) {
      session.status = 'signed-out';
      return null;
    }
    session.error = error instanceof ApiError ? error : new ApiError({ code: 'INTERNAL', status: 0 });
    session.status = 'error';
    return null;
  }
}

// `to` debe ser una ruta interna fija; por defecto, la landing.
export async function signOut(to = '/') {
  const userId = session.me?.user.id;
  if (userId) await clearLocalCopies(userId);
  // Better Auth solo se descarga al cerrar sesión.
  const { authActions } = await import('./auth.ts');
  await authActions.signOut();
  invalidateCache();
  session.me = null;
  session.status = 'signed-out';
  window.location.assign(to);
}

let versionCheck: Promise<void> | null = null;

// Si el servidor exige un esquema de documento más nuevo, la página queda bloqueada hasta recargar.
export function checkClientVersion(): Promise<void> {
  versionCheck ??= apiFetch('/v1/meta', { schema: MetaResponseSchema, redirectOn401: false })
    .then((meta) => {
      if (DOCUMENT_SCHEMA_VERSION < meta.minClientSchemaVersion) {
        clientVersion.reloadRequired = true;
      } else if (meta.sharedHash !== sharedHash.trim()) {
        console.warn('Los tipos compartidos del cliente no coinciden con los del servidor; se sigue con DTOs compatibles.');
      }
    })
    .catch(() => {
      versionCheck = null;
    });
  return versionCheck;
}
