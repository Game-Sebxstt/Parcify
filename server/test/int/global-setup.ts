import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Falta TEST_DATABASE_URL (vitest.int.config.ts)');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `No se pudieron aplicar las migraciones al Postgres de pruebas (¿npm run stack:test:up?):\n${result.stderr || result.stdout}`,
    );
  }
}
