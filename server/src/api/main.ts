import { loadConfigOrExit } from '../core/config.js';
import { Scheduler, storageJobs } from '../core/jobs/index.js';
import { captureError, flushSentry, initSentry } from '../core/sentry.js';
import { buildApp } from './app.js';

const SHUTDOWN_TIMEOUT_MS = 25_000;
// En el stack de e2e todo el navegador llega desde 127.0.0.1 y la batería completa pasa de las 300 peticiones por
// minuto de una sola IP. Los límites propios de cada ruta y los de Better Auth siguen igual.
const TEST_GLOBAL_RATE_LIMIT = 100_000;

const config = loadConfigOrExit('api');
await initSentry(config);
const app = await buildApp(config, config.nodeEnv === 'test' ? { globalRateLimit: TEST_GLOBAL_RATE_LIMIT } : {});

// Con storage `local` el volumen solo lo tiene la API: las purgas que borran ficheros corren aquí.
const scheduler =
  config.storage.driver === 'local'
    ? new Scheduler(
        { redis: app.redis, logger: app.log, owner: `api:${config.instanceId}` },
        storageJobs({ db: app.db, redis: app.redis, logger: app.log, instanceId: config.instanceId, storage: app.storage }),
      )
    : null;

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Cerrando la API');
  const timer = setTimeout(() => {
    app.log.error('El cierre superó el tope; se fuerza la salida');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();
  try {
    await scheduler?.stop();
    await app.close();
    await flushSentry();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'Error al cerrar la API');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (error) {
  app.log.fatal({ err: error }, 'No se pudo arrancar la API');
  captureError(error);
  await flushSentry();
  process.exit(1);
}

if (scheduler) {
  scheduler.start();
  app.log.info({ jobs: scheduler.names }, 'Trabajos periódicos programados');
}
