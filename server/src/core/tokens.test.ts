import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateShareToken, hashToken, isShareToken, tokenHashEquals } from './tokens.js';

describe('tokens de enlace', () => {
  it('son 32 bytes aleatorios en base64url y no se repiten', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      const token = generateShareToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(isShareToken(token)).toBe(true);
      tokens.add(token);
    }
    expect(tokens.size).toBe(1_000);
  });

  it('rechaza formas que no son un token', () => {
    for (const value of ['', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`]) {
      expect(isShareToken(value), value).toBe(false);
    }
  });

  it('el hash es SHA-256 en hex y no contiene el token', () => {
    const token = generateShareToken();
    const hash = hashToken(token);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('compara hashes en tiempo constante y descarta valores mal formados', () => {
    const hash = hashToken(generateShareToken());
    expect(tokenHashEquals(hash, hash)).toBe(true);
    expect(tokenHashEquals(hash, hashToken(generateShareToken()))).toBe(false);
    expect(tokenHashEquals(hash, hash.slice(0, 63))).toBe(false);
    expect(tokenHashEquals(hash, hash.toUpperCase())).toBe(false);
  });
});
