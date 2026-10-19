import fp from 'fastify-plugin';
import { createMailer, type Mailer } from '../../core/mailer/index.js';

export const mailerPlugin = fp<{ mailer?: Mailer }>(
  async (app, options) => {
    const mailer = options.mailer ?? createMailer(app.config, app.log);
    app.decorate('mailer', mailer);
    app.addHook('onClose', async () => {
      await mailer.close?.();
    });
  },
  { name: 'mailer', dependencies: ['config'] },
);
