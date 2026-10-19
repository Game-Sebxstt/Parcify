import { cpSync, rmSync } from 'node:fs';
import { CLIENT_SHARED_DIR, computeSharedHash, readStoredHash, serverSharedDir } from './shared-hash.ts';

const source = serverSharedDir();
if (!source) {
  console.error('No se encuentra src/shared del servidor. Define PARCIFY_SERVER_DIR con la ruta del servidor (por defecto ../server).');
  process.exit(1);
}

const stored = readStoredHash(source);
if (computeSharedHash(source) !== stored) {
  console.error('El SHARED_HASH del servidor no coincide con su src/shared: ejecuta npm run shared:hash en server/.');
  process.exit(1);
}

rmSync(CLIENT_SHARED_DIR, { recursive: true, force: true });
cpSync(source, CLIENT_SHARED_DIR, { recursive: true });
console.log(`src/shared sincronizado (${stored})`);
