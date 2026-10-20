import { createHmac } from 'node:crypto';
import { safeEqual } from '../ids.js';

export type SignedMethod = 'GET' | 'PUT';

const SIGNATURE = /^[0-9a-f]{64}$/;

function payload(method: SignedMethod, key: string, expiresAt: number, downloadName?: string): string {
  return [method, key, String(expiresAt), downloadName ?? ''].join('\n');
}

export function signStorageUrl(
  secret: string,
  method: SignedMethod,
  key: string,
  expiresAt: number,
  downloadName?: string,
): string {
  return createHmac('sha256', secret).update(payload(method, key, expiresAt, downloadName)).digest('hex');
}

export interface SignedParams {
  method: SignedMethod;
  key: string;
  exp: unknown;
  sig: unknown;
  downloadName?: string;
}

// expiresAt en segundos Unix; la comparación de la firma es en tiempo constante.
export function verifyStorageSignature(secret: string, params: SignedParams, nowMs = Date.now()): boolean {
  const exp = typeof params.exp === 'string' ? Number(params.exp) : params.exp;
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= 0) return false;
  if (typeof params.sig !== 'string' || !SIGNATURE.test(params.sig)) return false;
  const expected = signStorageUrl(secret, params.method, params.key, exp, params.downloadName);
  const valid = safeEqual(expected, params.sig);
  return valid && exp * 1000 > nowMs;
}
