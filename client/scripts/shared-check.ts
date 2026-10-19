import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENT_SHARED_DIR, HASH_FILE, computeSharedHash, readStoredHash, serverSharedDir } from './shared-hash.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!existsSync(join(CLIENT_SHARED_DIR, HASH_FILE))) {
  fail('Falta src/shared: ejecuta npm run shared:sync');
}

const stored = readStoredHash(CLIENT_SHARED_DIR);
if (computeSharedHash(CLIENT_SHARED_DIR) !== stored) {
  fail('La copia de src/shared se ha editado a mano: ejecuta npm run shared:sync');
}

const server = serverSharedDir();
if (server && readStoredHash(server) !== stored) {
  fail('La copia de src/shared está desactualizada: ejecuta npm run shared:sync');
}

console.log(`src/shared al día (${stored})`);
