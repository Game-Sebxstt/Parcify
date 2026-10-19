import { describe, expect, it, vi } from 'vitest';
import { createMemoryMailer } from './drivers.js';
import { createMailer, sendInBackground } from './index.js';
import * as templates from './templates.js';

const silent = { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
const from = 'Parcify <no-reply@example.com>';

describe('driver memory', () => {
  it('guarda los correos y los filtra por destinatario sin distinguir mayúsculas', async () => {
    const mailer = createMemoryMailer();
    await mailer.send({ to: 'Ana@example.com', subject: 'a', text: 't', html: '<p>t</p>' });
    await mailer.send({ to: 'luis@example.com', subject: 'b', text: 't', html: '<p>t</p>' });
    expect(mailer.list('ana@example.com').map((mail) => mail.subject)).toEqual(['a']);
    expect(mailer.list()).toHaveLength(2);
    mailer.clear();
    expect(mailer.list()).toHaveLength(0);
  });

  it('solo se crea con NODE_ENV=test', () => {
    expect(createMailer({ nodeEnv: 'test', mail: { driver: 'memory', from } }, silent).driver).toBe('memory');
    expect(() => createMailer({ nodeEnv: 'development', mail: { driver: 'memory', from } }, silent)).toThrow();
    expect(() => createMailer({ nodeEnv: 'production', mail: { driver: 'console', from } }, silent)).toThrow();
  });
});

describe('sendInBackground', () => {
  it('no espera al envío en la llamada y registra el fallo sin el contenido', async () => {
    const logger = { ...silent, error: vi.fn() };
    const send = vi.fn().mockRejectedValue(new Error('smtp caído'));
    const done = sendInBackground({ driver: 'smtp', send }, logger, { to: 'a@example.com', subject: 's', text: '123456', html: '' }, {
      verificationId: 'v1',
    });
    expect(send).not.toHaveBeenCalled();
    await done;
    expect(send).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    const logged = JSON.stringify(logger.error.mock.calls[0]);
    expect(logged).toContain('v1');
    expect(logged).not.toContain('123456');
  });
});

describe('plantillas', () => {
  const rendered = [
    templates.verificationCode({ code: '482913', minutes: 10 }),
    templates.passwordResetCode({ code: '771204', minutes: 10 }),
    templates.emailChangeCode({ code: '305118', minutes: 10 }),
    templates.emailChangeNotice({ newEmail: 'nuevo@example.com' }),
    templates.workspaceInvitation({
      inviterName: 'Ana',
      workspaceName: 'Estudio',
      role: 'member',
      url: 'https://parcify.app/invitacion?espacio=abc',
      expiresInDays: 7,
    }),
    templates.projectInvitation({
      inviterName: 'Ana',
      projectName: 'Mapa',
      role: 'editor',
      url: 'https://parcify.app/invitacion#t=xyz',
      expiresInDays: 7,
    }),
  ];

  it.each(rendered.map((mail) => [mail.subject, mail]))('«%s» no contiene undefined ni null', (_subject, mail) => {
    for (const part of [mail.subject, mail.text, mail.html]) {
      expect(part).not.toMatch(/undefined|null|NaN|\[object Object\]/);
      expect(part.length).toBeGreaterThan(0);
    }
  });

  it('no incluye imágenes remotas y tiene versión de texto', () => {
    for (const mail of rendered) {
      expect(mail.html).not.toMatch(/<img|url\(/i);
      expect(mail.text).toContain('Parcify');
    }
  });

  it('incluye el código en texto y HTML', () => {
    expect(rendered[0]!.text).toContain('482913');
    expect(rendered[0]!.html).toContain('482913');
    expect(rendered[1]!.text).toContain('771204');
  });

  it('escapa el contenido en HTML', () => {
    const mail = templates.workspaceInvitation({
      inviterName: '<script>alert(1)</script>',
      workspaceName: 'A & B',
      role: 'admin',
      url: 'https://parcify.app/invitacion?espacio=a&b=1',
      expiresInDays: 7,
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('A &amp; B');
    expect(mail.text).toContain('como administrador');
  });
});
