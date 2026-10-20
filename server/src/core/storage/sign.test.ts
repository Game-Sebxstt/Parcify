import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signStorageUrl, verifyStorageSignature } from './sign.js';
import { assertValidKey, assetKey, parseKey, StorageKeyError } from './types.js';

const SECRET = 'storage-secret-0123456789abcdef-0123456789';

describe('firmas HMAC de storage', () => {
  const key = assetKey('org1', randomUUID(), 'thumb', 'webp');
  const now = 1_800_000_000_000;
  const exp = now / 1000 + 60;

  it('acepta la firma correcta antes de caducar', () => {
    const sig = signStorageUrl(SECRET, 'GET', key, exp);
    expect(verifyStorageSignature(SECRET, { method: 'GET', key, exp: String(exp), sig }, now)).toBe(true);
  });

  it('rechaza firma alterada, caducada, otro método, otra clave u otro nombre de descarga', () => {
    const sig = signStorageUrl(SECRET, 'GET', key, exp, 'foto.png');
    const base = { method: 'GET' as const, key, exp, sig, downloadName: 'foto.png' };
    expect(verifyStorageSignature(SECRET, base, now)).toBe(true);
    const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
    expect(verifyStorageSignature(SECRET, { ...base, sig: flipped }, now)).toBe(false);
    expect(verifyStorageSignature(SECRET, base, (exp + 1) * 1000)).toBe(false);
    expect(verifyStorageSignature(SECRET, { ...base, method: 'PUT' }, now)).toBe(false);
    expect(verifyStorageSignature(SECRET, { ...base, key: assetKey('org1', randomUUID(), 'thumb', 'webp') }, now)).toBe(false);
    expect(verifyStorageSignature(SECRET, { ...base, downloadName: 'otra.png' }, now)).toBe(false);
    expect(verifyStorageSignature(SECRET, { ...base, exp: exp + 1 }, now)).toBe(false);
    expect(verifyStorageSignature(SECRET, { ...base, sig: 'corta' }, now)).toBe(false);
    expect(verifyStorageSignature(SECRET, { ...base, exp: 'abc' }, now)).toBe(false);
  });
});

describe('claves de storage', () => {
  it('sigue el formato a/{scope}/{assetId}/{variant}.{ext}', () => {
    const id = randomUUID();
    expect(assetKey(`u-user_1`, id, 'original', 'png')).toBe(`a/u-user_1/${id}/original.png`);
    expect(parseKey(`a/org1/${id}/full.webp`)).toEqual({ scope: 'org1', assetId: id, variant: 'full', ext: 'webp' });
  });

  it('rechaza ámbitos, ids, variantes o rutas fuera del formato', () => {
    const id = randomUUID();
    expect(() => assetKey('a/b', id, 'original', 'png')).toThrow(StorageKeyError);
    expect(() => assetKey('org', 'no-uuid', 'original', 'png')).toThrow(StorageKeyError);
    expect(() => assetKey('org', id, 'grande' as 'full', 'png')).toThrow(StorageKeyError);
    for (const bad of [`a/org/${id}/../x.png`, `a/../${id}/original.png`, `a/org/${id}/original.exe`, '']) {
      expect(() => assertValidKey(bad), bad).toThrow(StorageKeyError);
    }
  });
});
