import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SHARE_TOKEN_BYTES = 32;

// 32 bytes en base64url sin relleno: 43 caracteres.
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

export function isShareToken(value: string): boolean {
  return SHARE_TOKEN_PATTERN.test(value);
}

// SHA-256 en hex: es lo único que se guarda del token.
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenHashEquals(a: string, b: string): boolean {
  if (!HASH_PATTERN.test(a) || !HASH_PATTERN.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
