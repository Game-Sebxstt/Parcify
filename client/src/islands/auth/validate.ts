import { m } from '../../paraglide/messages.js';
import { EmailSchema, NameSchema } from '../../shared/api/common.js';
import type { AuthResult } from '../../lib/auth.ts';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const CODE_LENGTH = 6;
export const RESEND_SECONDS = 60;

export function emailError(value: string): string | null {
  return EmailSchema.safeParse(value.trim()).success ? null : m.auth_error_email();
}

export function nameError(value: string): string | null {
  return NameSchema.safeParse(value).success ? null : m.auth_error_name();
}

export function passwordError(value: string): string | null {
  if (value.length < PASSWORD_MIN) return m.auth_error_password_short();
  if (value.length > PASSWORD_MAX) return m.auth_error_password_long();
  return null;
}

// Acepta el código pegado con espacios o guiones («123 456», «123-456»).
export function normalizeCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function codeError(value: string): string | null {
  return value.length === CODE_LENGTH ? null : m.auth_error_code_format();
}

export type AuthField = 'name' | 'email' | 'password' | 'code' | 'form';

// Traduce el fallo de una acción a un mensaje y al campo junto al que se muestra.
export function describeFailure(result: Extract<AuthResult, { ok: false }>): { field: AuthField; message: string } {
  switch (result.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return { field: 'password', message: m.auth_error_credentials() };
    case 'INVALID_OTP':
    case 'OTP_EXPIRED':
      return { field: 'code', message: m.auth_error_code() };
    case 'TOO_MANY_ATTEMPTS':
      return { field: 'code', message: m.auth_error_code_attempts() };
    case 'PASSWORD_TOO_SHORT':
      return { field: 'password', message: m.auth_error_password_short() };
    case 'PASSWORD_TOO_LONG':
      return { field: 'password', message: m.auth_error_password_long() };
    case 'INVALID_EMAIL':
      return { field: 'email', message: m.auth_error_email() };
    case 'NETWORK':
      return { field: 'form', message: m.auth_error_network() };
  }
  if (result.status === 429 || result.code === 'RATE_LIMITED') return { field: 'form', message: m.auth_error_rate_limited() };
  return { field: 'form', message: m.auth_error_generic() };
}
