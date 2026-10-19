import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HASH_FILE = 'SHARED_HASH';

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

// SHA-256 del contenido con saltos de línea LF y ordenado por ruta relativa. El cliente usa el mismo algoritmo.
export function computeSharedHash(dir: string): string {
  const hash = createHash('sha256');
  const files = listFiles(dir)
    .map((file) => ({ file, path: relative(dir, file).split(sep).join('/') }))
    .filter(({ path }) => path !== HASH_FILE)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { file, path } of files) {
    const content = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    hash.update(`${path}\n`);
    hash.update(content);
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function readStoredHash(dir: string): string {
  return readFileSync(join(dir, HASH_FILE), 'utf8').trim();
}

export const SHARED_DIR = fileURLToPath(new URL('../src/shared', import.meta.url));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const value = computeSharedHash(SHARED_DIR);
  writeFileSync(join(SHARED_DIR, HASH_FILE), `${value}\n`);
  console.log(`SHARED_HASH ${value}`);
}
