import { APIError } from 'better-auth/api';
import { AppError } from '../errors.js';

const OWNER_CODES = new Set([
  'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
  'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER',
]);

// Traduce los errores de auth.api.* del plugin de organizaciones al catálogo propio.
export function toAppError(error: unknown): unknown {
  if (!(error instanceof APIError)) return error;
  const code = (error.body as { code?: unknown } | undefined)?.code;
  if (typeof code === 'string') {
    if (OWNER_CODES.has(code)) return new AppError('LAST_OWNER', { cause: error });
    if (code === 'MEMBER_NOT_FOUND') return new AppError('NOT_FOUND', { cause: error });
    if (code === 'YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS') {
      return new AppError('FORBIDDEN', { message: 'Has llegado al máximo de espacios.', cause: error });
    }
    if (code === 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED') return new AppError('MEMBERSHIP_LIMIT', { cause: error });
  }
  if (error.statusCode === 401) return new AppError('UNAUTHORIZED', { cause: error });
  if (error.statusCode === 403) return new AppError('FORBIDDEN', { cause: error });
  if (error.statusCode === 404) return new AppError('NOT_FOUND', { cause: error });
  return error;
}

export async function callAuth<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toAppError(error);
  }
}
