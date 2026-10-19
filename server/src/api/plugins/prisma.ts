import fp from 'fastify-plugin';
import { createDb, pingDb, type Db } from '../../core/db.js';

export const prismaPlugin = fp<{ db?: Db }>(
  async (app, options) => {
    const db = options.db ?? createDb(app.config);
    app.decorate('db', db);
    // La primera consulta abre el pool y prepara el cliente; mejor pagarla antes de recibir tráfico.
    app.addHook('onReady', async () => {
      await pingDb(db).catch((error: unknown) => app.log.warn({ err: error }, 'Postgres no responde al arrancar'));
    });
    if (!options.db) {
      app.addHook('onClose', async () => {
        await db.$disconnect();
      });
    }
  },
  { name: 'prisma', dependencies: ['config'] },
);
