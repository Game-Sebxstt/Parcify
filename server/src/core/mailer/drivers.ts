import nodemailer from 'nodemailer';
import type { LogSink } from '../logger.js';
import { Resend } from 'resend';
import type { MailMessage, Mailer, StoredMail } from './types.js';

export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    driver: 'smtp',
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
    async close() {
      transport.close();
    },
  };
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  const client = new Resend(apiKey);
  return {
    driver: 'resend',
    async send(message) {
      const { error } = await client.emails.send({ from, ...message });
      if (error) throw new Error(`Resend rechazó el envío: ${error.name}`);
    },
  };
}

// Solo para desarrollo: escribe el correo en el log para poder copiar el código.
export function createConsoleMailer(logger: LogSink): Mailer {
  return {
    driver: 'console',
    async send(message) {
      // El asunto lleva el código, así se ve en el mensaje sin abrir el objeto del log.
      logger.warn(
        { mail: { to: message.to, subject: message.subject, body: message.text } },
        `Correo para ${message.to}: ${message.subject}`,
      );
    },
  };
}

export interface MemoryMailer extends Mailer {
  readonly driver: 'memory';
  list(to?: string): StoredMail[];
  clear(): void;
}

export function createMemoryMailer(limit = 500): MemoryMailer {
  const outbox: StoredMail[] = [];
  return {
    driver: 'memory',
    async send(message: MailMessage) {
      outbox.push({ ...message, sentAt: new Date() });
      if (outbox.length > limit) outbox.splice(0, outbox.length - limit);
    },
    list(to) {
      const wanted = to?.toLowerCase();
      return outbox.filter((mail) => wanted === undefined || mail.to.toLowerCase() === wanted);
    },
    clear() {
      outbox.length = 0;
    },
  };
}
