import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HASH_FILE = 'SHARED_HASH';
export const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CLIENT_SHARED_DIR = join(CLIENT_ROOT, 'src', 'shared');

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

// Mismo algoritmo que scripts/shared-hash.ts del servidor: LF, orden por ruta relativa y SHARED_HASH excluido.
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

// Carpeta src/shared del servidor, o null si no está disponible (por ejemplo, dentro de la imagen Docker).
export function serverSharedDir(): string | null {
  const serverDir = resolve(CLIENT_ROOT, process.env.PARCIFY_SERVER_DIR || '../server');
  const dir = join(serverDir, 'src', 'shared');
  return existsSync(join(dir, HASH_FILE)) ? dir : null;
}
