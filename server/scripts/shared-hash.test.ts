import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SHARED_DIR, computeSharedHash, readStoredHash } from './shared-hash.js';

const temps: string[] = [];

function copyShared() {
  const dir = mkdtempSync(join(tmpdir(), 'parcify-shared-'));
  temps.push(dir);
  cpSync(SHARED_DIR, dir, { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SHARED_HASH', () => {
  it('coincide con el contenido de src/shared (ejecuta npm run shared:hash si falla)', () => {
    expect(readStoredHash(SHARED_DIR)).toBe(computeSharedHash(SHARED_DIR));
  });

  it('cambia al editar un archivo', () => {
    const dir = copyShared();
    const before = computeSharedHash(dir);
    writeFileSync(join(dir, 'permissions.ts'), '// cambio\n', { flag: 'a' });
    expect(computeSharedHash(dir)).not.toBe(before);
  });

  it('no depende de los saltos de línea CRLF', () => {
    const dir = copyShared();
    writeFileSync(join(dir, 'extra.ts'), 'export const a = 1;\n');
    const lf = computeSharedHash(dir);
    writeFileSync(join(dir, 'extra.ts'), 'export const a = 1;\r\n');
    expect(computeSharedHash(dir)).toBe(lf);
  });

  it('ignora el propio archivo SHARED_HASH', () => {
    const dir = copyShared();
    const before = computeSharedHash(dir);
    writeFileSync(join(dir, 'SHARED_HASH'), 'otro\n');
    expect(computeSharedHash(dir)).toBe(before);
  });
});
