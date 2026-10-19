import type { z } from 'zod';
import { m } from '../paraglide/messages.js';
import { ERROR_CODES, ErrorResponseSchema, type ErrorCode } from '../shared/api/errors.js';
import { showToast } from '../ui/toast.svelte.ts';

export const API_ORIGIN = (import.meta.env.PUBLIC_API_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');

export type ClientErrorCode = ErrorCode | 'NETWORK' | 'BAD_RESPONSE';

const KNOWN_CODES = new Set<string>(ERROR_CODES);

// Mapa explícito: un acceso dinámico a `m` metería todos los mensajes en cada página.
const ERROR_MESSAGES: Record<ErrorCode, () => string> = {
  VALIDATION_FAILED: m.error_validation_failed,
  INVALID_ASSET: m.error_invalid_asset,
  INVALID_ATTACHMENT: m.error_invalid_attachment,
  INVALID_ARCHIVE: m.error_invalid_archive,
  UNAUTHORIZED: m.error_unauthorized,
  FORBIDDEN: m.error_forbidden,
  BAD_ORIGIN: m.error_bad_origin,
  EMAIL_NOT_VERIFIED: m.error_email_not_verified,
  SESSION_NOT_FRESH: m.error_session_not_fresh,
  NOT_FOUND: m.error_not_found,
  PROJECT_NOT_FOUND: m.error_project_not_found,
  WORKSPACE_NOT_FOUND: m.error_workspace_not_found,
  ASSET_NOT_FOUND: m.error_asset_not_found,
  INVITE_NOT_FOUND: m.error_invite_not_found,
  INVITE_EMAIL_MISMATCH: m.error_invite_email_mismatch,
  CONFLICT: m.error_conflict,
  LAST_OWNER: m.error_last_owner,
  PERSONAL_WORKSPACE: m.error_personal_workspace,
  WORKSPACE_IN_TRASH: m.error_workspace_in_trash,
  MUST_TRANSFER_OWNERSHIP: m.error_must_transfer_ownership,
  MEMBERSHIP_LIMIT: m.error_membership_limit,
  INVITE_ALREADY_HANDLED: m.error_invite_already_handled,
  DOCUMENT_RELOADED: m.error_document_reloaded,
  RESTORE_IN_PROGRESS: m.error_restore_in_progress,
  INVITE_EXPIRED: m.error_invite_expired,
  INVITE_REVOKED: m.error_invite_revoked,
  INVITE_USED_UP: m.error_invite_used_up,
  PAYLOAD_TOO_LARGE: m.error_payload_too_large,
  UNSUPPORTED_FILE: m.error_unsupported_file,
  PROCESSING_TIMEOUT: m.error_processing_timeout,
  AI_REFUSED: m.error_ai_refused,
  RATE_LIMITED: m.error_rate_limited,
  AI_QUOTA_EXCEEDED: m.error_ai_quota_exceeded,
  INTERNAL: m.error_internal,
  AI_BAD_OUTPUT: m.error_ai_bad_output,
  AI_PROVIDER_ERROR: m.error_ai_provider_error,
  STORAGE_ERROR: m.error_storage_error,
  SERVICE_UNAVAILABLE: m.error_service_unavailable,
  COLLAB_UNAVAILABLE: m.error_collab_unavailable,
  AI_BUSY: m.error_ai_busy,
  AI_JOB_LOST: m.error_ai_job_lost,
  AI_PROVIDER_BUSY: m.error_ai_provider_busy,
  AI_TIMEOUT: m.error_ai_timeout,
};

export function errorMessage(code: ClientErrorCode): string {
  if (code === 'NETWORK') return m.toast_offline();
  if (code === 'BAD_RESPONSE') return m.error_internal();
  return (ERROR_MESSAGES[code] ?? m.error_internal)();
}

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: Record<string, unknown>;

  constructor(input: { code: ClientErrorCode; status: number; requestId?: string | null; details?: Record<string, unknown> }) {
    super(errorMessage(input.code));
    this.name = 'ApiError';
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId ?? null;
    this.details = input.details ?? {};
  }
}

// Solo rutas internas: empiezan por una barra y no son protocol-relative («//», «/\»).
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const base = 'https://parcify.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  // El parser elimina «.» y «..», así que la ruta resultante puede volver a ser «//host».
  if (url.pathname.startsWith('//') || url.pathname.startsWith('/\\')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function signInUrl(returnTo?: string | null): string {
  const params = new URLSearchParams({ acceso: 'entrar' });
  const safe = safeReturnPath(returnTo);
  if (safe) params.set('volver', safe);
  return `/?${params.toString()}`;
}

// Punto único de navegación completa; las pruebas lo sustituyen.
export const browser = {
  assign(url: string) {
    window.location.assign(url);
  },
};

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function retryAfterSeconds(response: Response): number {
  const header = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
  return Number.isFinite(header) && header > 0 ? header : 60;
}

export type ApiRequest<T extends z.ZodType | undefined> = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  schema?: T;
  signal?: AbortSignal;
  // En páginas privadas, un 401 lleva al overlay de acceso con «volver» a la página actual.
  redirectOn401?: boolean;
  // Si se indica, el aviso de «Sin conexión» ofrece reintentar.
  onRetry?: () => void;
};

type Result<T> = T extends z.ZodType ? z.infer<T> : undefined;

export async function apiFetch<T extends z.ZodType | undefined = undefined>(
  path: string,
  options: ApiRequest<T> = {},
): Promise<Result<T>> {
  const response = await send(path, options);
  if (response.status === 204 || !options.schema) return undefined as Result<T>;
  const parsed = options.schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new ApiError({ code: 'BAD_RESPONSE', status: response.status });
  return parsed.data as Result<T>;
}

// Como apiFetch, para respuestas que son un archivo.
export async function apiBlob(path: string, options: ApiRequest<undefined> = {}): Promise<Blob> {
  const response = await send(path, options);
  try {
    return await response.blob();
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({ code: 'NETWORK', status: 0 });
  }
}

// Un FormData viaja tal cual (multipart); cualquier otro cuerpo, como JSON.
async function send(path: string, options: ApiRequest<z.ZodType | undefined>): Promise<Response> {
  const init: RequestInit = { method: options.method ?? 'GET', credentials: 'include', headers: {} };
  if (options.signal) init.signal = options.signal;
  if (options.body instanceof FormData) {
    init.body = options.body;
  } else if (options.body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    showToast({
      message: m.toast_offline(),
      tone: 'error',
      ...(options.onRetry ? { action: { label: m.common_retry(), run: options.onRetry } } : {}),
    });
    throw new ApiError({ code: 'NETWORK', status: 0 });
  }

  if (!response.ok) {
    const error = await toApiError(response);
    if (response.status === 401 && (options.redirectOn401 ?? true) && typeof window !== 'undefined') {
      browser.assign(signInUrl(currentPath()));
    } else if (response.status === 429) {
      showToast({ message: m.toast_rate_limited({ seconds: retryAfterSeconds(response) }), tone: 'error' });
    }
    throw error;
  }
  return response;
}

async function toApiError(response: Response): Promise<ApiError> {
  const parsed = ErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
  if (parsed.success && KNOWN_CODES.has(parsed.data.error.code)) {
    return new ApiError({
      code: parsed.data.error.code,
      status: response.status,
      requestId: parsed.data.error.requestId,
      details: parsed.data.error.details,
    });
  }
  const fallback: ErrorCode =
    response.status === 401 ? 'UNAUTHORIZED' : response.status === 429 ? 'RATE_LIMITED' : response.status === 404 ? 'NOT_FOUND' : 'INTERNAL';
  return new ApiError({ code: fallback, status: response.status });
}

// Omite los valores vacíos: un cursor nulo no viaja.
export function queryString(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
const CACHE_TTL_MS = 30_000;

// Memoriza lecturas durante 30 s para no repetirlas al cambiar de pestaña; un error no se guarda.
export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  value.catch(() => cache.delete(key));
  return value;
}

export function invalidateCache(prefix = '') {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}
