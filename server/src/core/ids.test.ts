import { describe, expect, it } from 'vitest';
import { isUuid, isUuidV7, randomToken, safeEqual, sha256Hex, uuidv7 } from './ids.js';

describe('ids', () => {
  it('distingue uuid v7', () => {
    expect(isUuid('0199e2f0-8a5b-7c3d-9e4f-0123456789ab')).toBe(true);
    expect(isUuidV7('0199e2f0-8a5b-7c3d-9e4f-0123456789ab')).toBe(true);
    expect(isUuidV7('0199e2f0-8a5b-4c3d-9e4f-0123456789ab')).toBe(false);
  });

  it('genera uuid v7 ordenables por tiempo', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuidV7(a)).toBe(true);
    expect(a < b).toBe(true);
    expect(a.slice(0, 13)).toBe('018bcfe5-6800');
  });

  it('genera tokens base64url y compara en tiempo constante', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex('a')).toHaveLength(64);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
