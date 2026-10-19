import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../../../core/config.js';
import type { Mailer, MemoryMailer } from '../../../core/mailer/index.js';
import { TestMailQuerySchema, TestMailResponseSchema } from '../../../shared/api/test-mail.js';

export function testMailEnabled(config: Config, mailer: Mailer): mailer is MemoryMailer {
  return config.nodeEnv === 'test' && config.mail?.driver === 'memory' && mailer.driver === 'memory';
}

// Solo existe en pruebas: expone el buzón en memoria para leer los códigos de verificación.
export const testMailRoutes: FastifyPluginAsyncZod = async (app) => {
  const mailer = app.mailer;
  if (!testMailEnabled(app.config, mailer)) return;

  app.get(
    '/__test/mail',
    { schema: { querystring: TestMailQuerySchema, response: { 200: TestMailResponseSchema } } },
    async (request) => ({
      messages: mailer.list(request.query.to).map((mail) => ({
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        sentAt: mail.sentAt.toISOString(),
      })),
    }),
  );
};
