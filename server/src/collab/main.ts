import { loadConfigOrExit } from '../core/config.js';
import { createDb, pingDb } from '../core/db.js';
import { documentJobs, Scheduler, storageJobs } from '../core/jobs/index.js';
import { createLogger } from '../core/logger.js';
import { createRedis } from '../core/redis.js';
import { captureError, flushSentry, initSentry } from '../core/sentry.js';
import { createStorage } from '../core/storage/index.js';
import { createCollabServer } from './server.js';

const SHUTDOWN_TIMEOUT_MS = 25_000;

const config = loadConfigOrExit('collab');
const logger = createLogger(config);
for (const warning of config.warnings) logger.warn(warning);
await initSentry(config);

const db = createDb(config);
const redis = createRedis(config.redisUrl, { name: 'collab', logger });

// Con stopOnSignals, Hocuspocus guarda los documentos pendientes y sale; aquí solo se pone el tope.
const collab = createCollabServer({ config, db, redis, logger }, { stopOnSignals: true });

// Con storage `local` los ficheros están en el volumen de la API, que ejecuta las purgas.
const jobDeps = { db, redis, logger, instanceId: config.instanceId };
const scheduler = new Scheduler({ redis, logger, owner: config.instanceId }, [
  ...documentJobs(jobDeps),
  ...(config.storage.driver === 's3' ? storageJobs({ ...jobDeps, storage: createStorage(config) }) : []),
]);

let closing = false;
function onSignal(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'Cerrando collab');
  void scheduler.stop();
  void flushSentry();
  const timer = setTimeout(() => {
    logger.error('El cierre superó el tope; se fuerza la salida');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();
}

process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

await pingDb(db).catch((error: unknown) => logger.warn({ err: error }, 'Postgres no responde al arrancar'));

try {
  const port = await collab.listen();
  logger.info({ port, instance: config.instanceId }, 'collab escuchando');
} catch (error) {
  logger.fatal({ err: error }, 'No se pudo arrancar collab');
  captureError(error);
  await flushSentry();
  process.exit(1);
}

scheduler.start();
logger.info({ jobs: scheduler.names }, 'Trabajos periódicos programados');
