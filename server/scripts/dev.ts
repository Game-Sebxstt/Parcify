import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2e = process.argv.includes('--e2e');
const root = fileURLToPath(new URL('..', import.meta.url));

if (!e2e && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

// Valores fijos solo para el stack de pruebas de compose.test.yml; no sirven fuera de él.
const E2E_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
  API_ORIGIN: 'http://localhost:3000',
  COLLAB_ORIGIN: 'http://localhost:3001',
  CLIENT_ORIGINS: process.env.CLIENT_ORIGINS ?? 'http://localhost:4321',
  DATABASE_URL: 'postgresql://parcify:parcify_test@127.0.0.1:55433/parcify_test',
  REDIS_URL: 'redis://:parcify_test@127.0.0.1:56380/0',
  BETTER_AUTH_SECRET: 'e2e-better-auth-secret-0123456789abcdef',
  COLLAB_TOKEN_SECRET: 'e2e-collab-token-secret-0123456789abcdef',
  MAIL_DRIVER: 'memory',
  MAIL_FROM: 'Parcify <no-reply@example.com>',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_PATH: join(tmpdir(), 'parcify-e2e-storage'),
  STORAGE_URL_SECRET: 'e2e-storage-url-secret-0123456789abcdef',
};

const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));

const services = [
  { name: 'api', port: '3000', entry: 'api/main' },
  { name: 'collab', port: '3001', entry: 'collab/main' },
] as const;

const children: ChildProcess[] = [];
let stopping = false;

function stopAll(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 3_000).unref();
}

for (const service of services) {
  const args = e2e
    ? [join(root, 'dist', `${service.entry}.js`)]
    : [tsxCli, 'watch', '--clear-screen=false', join(root, 'src', `${service.entry}.ts`)];
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...(e2e ? E2E_ENV : {}), PORT: service.port },
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[${service.name}] terminó (${signal ?? code})`);
    stopAll(code ?? 1);
  });
  children.push(child);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
