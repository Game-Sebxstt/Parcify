import type { LogSink } from '../logger.js';
import type { Config } from '../config.js';
import { createConsoleMailer, createMemoryMailer, createResendMailer, createSmtpMailer } from './drivers.js';
import type { MailMessage, Mailer } from './types.js';

export type { MailMessage, Mailer, StoredMail } from './types.js';
export type { MemoryMailer } from './drivers.js';
export * as templates from './templates.js';

export function createMailer(config: Pick<Config, 'mail' | 'nodeEnv'>, logger: LogSink): Mailer {
  const mail = config.mail;
  if (!mail) throw new Error('Falta la configuración de correo');
  switch (mail.driver) {
    case 'smtp':
      return createSmtpMailer(mail.smtpUrl, mail.from);
    case 'resend':
      return createResendMailer(mail.resendApiKey, mail.from);
    case 'console':
      if (config.nodeEnv === 'production') throw new Error('MAIL_DRIVER=console no se permite en producción');
      return createConsoleMailer(logger);
    case 'memory':
      if (config.nodeEnv !== 'test') throw new Error('MAIL_DRIVER=memory solo se permite con NODE_ENV=test');
      return createMemoryMailer();
  }
}

// El envío no bloquea la respuesta, así el tiempo de respuesta no revela si la cuenta existe.
export function sendInBackground(
  mailer: Mailer,
  logger: LogSink,
  message: MailMessage,
  context: Record<string, unknown> = {},
): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      mailer
        .send(message)
        .catch((error: unknown) => {
          logger.error(
            { ...context, mailDriver: mailer.driver, err: { message: error instanceof Error ? error.message : String(error) } },
            'No se pudo enviar el correo',
          );
        })
        .finally(resolve);
    });
  });
}
