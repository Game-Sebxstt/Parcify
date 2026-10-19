import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// El Postgres de pruebas vive en tmpfs: hay que aplicar las migraciones del servidor antes de cada ejecución.
export default function globalSetup() {
  const serverDir = resolve(process.env.PARCIFY_SERVER_DIR || '../server');
  const prismaCli = join(serverDir, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://parcify:parcify_test@127.0.0.1:55433/parcify_test',
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `No se pudieron aplicar las migraciones (¿npm run stack:test:up en server/?):\n${result.stderr || result.stdout}`,
    );
  }
}
