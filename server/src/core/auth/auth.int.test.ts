import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/helpers/app.js';
import {
  CLIENT_ORIGIN,
  CookieJar,
  PASSWORD,
  authPost,
  codeFrom,
  mailbox,
  registerVerified,
  signUp,
  uniqueEmail,
  uniqueIp,
  waitForMail,
  withSession,
} from '../../../test/helpers/auth.js';
import { orgChannel } from '../events.js';
import { createRedis } from '../redis.js';
import { DISABLED_AUTH_PATHS } from './disabled-paths.js';
import { SLUG_PATTERN } from './slug.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('montaje', () => {
  it('responde en /api/auth/ok', async () => {
    const response = await app.inject({ url: '/api/auth/ok' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});

describe('registro y verificación por OTP', () => {
  it('el registro no abre sesión; verify-email devuelve la cookie y GET /v1/me responde 200', async () => {
    const { response, email, ip } = await signUp(app);
    expect(response.statusCode).toBe(200);
    expect(new CookieJar().store(response).has('parcify.session_token')).toBe(false);

    const user = await app.db.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(false);
    expect(await app.db.session.count({ where: { userId: user.id } })).toBe(0);

    const [mail] = await waitForMail(app, email);
    expect(mail!.subject).toContain('código');
    const verify = await authPost(app, '/email-otp/verify-email', { email, otp: codeFrom(mail!) }, { ip });
    expect(verify.statusCode).toBe(200);
    const jar = new CookieJar().store(verify);
    expect(jar.has('parcify.session_token')).toBe(true);

    expect(await app.db.session.count({ where: { userId: user.id } })).toBe(1);
    expect((await app.db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBe(true);

    const me = await app.inject({ url: '/v1/me', headers: { cookie: jar.header() } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email);
  });

  it('crea el espacio personal con personal = true, el usuario como owner y un slug válido', async () => {
    const user = await registerVerified(app, { name: 'José Ñúñez' });
    const org = await app.db.organization.findFirstOrThrow({
      where: { members: { some: { userId: user.id } } },
      include: { members: true },
    });
    expect(org.personal).toBe(true);
    expect(org.name).toBe('Espacio de José Ñúñez');
    expect(org.slug).toMatch(SLUG_PATTERN);
    expect(org.slug.startsWith('espacio-de-jose-nunez')).toBe(true);
    expect(org.members).toEqual([expect.objectContaining({ userId: user.id, role: 'owner' })]);
  });

  it('dos registros con el mismo nombre reciben slugs distintos', async () => {
    const name = `Gemelo ${randomUUID().slice(0, 8)}`;
    const a = await registerVerified(app, { name });
    const b = await registerVerified(app, { name });
    const slugs = await app.db.organization.findMany({
      where: { members: { some: { userId: { in: [a.id, b.id] } } } },
      select: { slug: true },
    });
    expect(new Set(slugs.map((s) => s.slug)).size).toBe(2);
  });

  it('registra un ActivityEvent security.session_created sin datos sensibles', async () => {
    const user = await registerVerified(app);
    const events = await app.db.activityEvent.findMany({ where: { actorId: user.id, type: 'security.session_created' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.projectId).toBeNull();
    const data = JSON.stringify(events[0]!.data);
    expect(data).not.toMatch(/token|otp|password/i);
  });

  it('entrar sin verificar responde 403 y entrar verificado abre sesión', async () => {
    const pending = await signUp(app);
    const denied = await authPost(app, '/sign-in/email', { email: pending.email, password: PASSWORD }, { ip: pending.ip });
    expect(denied.statusCode).toBe(403);

    const user = await registerVerified(app);
    const ok = await authPost(app, '/sign-in/email', { email: user.email, password: PASSWORD }, { ip: user.ip });
    expect(ok.statusCode).toBe(200);
    expect(new CookieJar().store(ok).has('parcify.session_token')).toBe(true);
  });
});

describe('OTP solo para verificar y recuperar', () => {
  it('POST /sign-in/email-otp responde 404', async () => {
    const user = await registerVerified(app);
    const response = await authPost(app, '/sign-in/email-otp', { email: user.email, otp: '123456' }, { ip: user.ip });
    expect(response.statusCode).toBe(404);
  });

  it('send-verification-otp con sign-in o forget-password responde 404 y no envía correo', async () => {
    const user = await registerVerified(app);
    const before = (await mailbox(app, user.email)).length;
    for (const type of ['sign-in', 'forget-password']) {
      const response = await authPost(app, '/email-otp/send-verification-otp', { email: user.email, type }, { ip: uniqueIp() });
      expect(response.statusCode).toBe(404);
    }
    await sleep(150);
    expect(await mailbox(app, user.email)).toHaveLength(before);
  });

  it('send-verification-otp con email-verification sí envía el código', async () => {
    const pending = await signUp(app);
    await waitForMail(app, pending.email, 1);
    const response = await authPost(
      app,
      '/email-otp/send-verification-otp',
      { email: pending.email, type: 'email-verification' },
      { ip: pending.ip },
    );
    expect(response.statusCode).toBe(200);
    const messages = await waitForMail(app, pending.email, 2);
    expect(codeFrom(messages[1]!)).toMatch(/^\d{6}$/);
  });

  it('request-password-reset envía el código y reset-password lo consume', async () => {
    const user = await registerVerified(app);
    const before = (await mailbox(app, user.email)).length;
    const request = await authPost(app, '/email-otp/request-password-reset', { email: user.email }, { ip: user.ip });
    expect(request.statusCode).toBe(200);
    const messages = await waitForMail(app, user.email, before + 1);
    const mail = messages[messages.length - 1]!;
    expect(mail.subject).toContain('restablecer');
    const otp = codeFrom(mail);

    const newPassword = 'otra-contraseña-456';
    const reset = await authPost(app, '/email-otp/reset-password', { email: user.email, otp, password: newPassword }, { ip: user.ip });
    expect(reset.statusCode).toBe(200);

    const reused = await authPost(app, '/email-otp/reset-password', { email: user.email, otp, password: 'tercera-clave-789' }, { ip: user.ip });
    expect(reused.statusCode).toBe(400);

    const oldPassword = await authPost(app, '/sign-in/email', { email: user.email, password: PASSWORD }, { ip: uniqueIp() });
    expect(oldPassword.statusCode).toBe(401);
    const signIn = await authPost(app, '/sign-in/email', { email: user.email, password: newPassword }, { ip: uniqueIp() });
    expect(signIn.statusCode).toBe(200);
  });
});

describe('rutas desactivadas', () => {
  it('todas las rutas de DISABLED_AUTH_PATHS responden 404', async () => {
    const user = await registerVerified(app);
    for (const path of DISABLED_AUTH_PATHS) {
      const response =
        path === '/organization/list-invitations'
          ? await app.inject({ url: `/api/auth${path}`, remoteAddress: user.ip, headers: withSession(user) })
          : await authPost(app, path, {}, { ip: user.ip, jar: user.jar });
      expect(response.statusCode, path).toBe(404);
    }
  });

  it('POST /organization/remove-member responde 404 aunque el cuerpo sea válido', async () => {
    const user = await registerVerified(app);
    const org = await app.db.organization.findFirstOrThrow({ where: { members: { some: { userId: user.id } } } });
    const response = await authPost(
      app,
      '/organization/remove-member',
      { memberIdOrEmail: user.email, organizationId: org.id },
      { ip: user.ip, jar: user.jar },
    );
    expect(response.statusCode).toBe(404);
    expect(await app.db.member.count({ where: { organizationId: org.id } })).toBe(1);
  });
});

describe('campos input: false', () => {
  it('/update-user no cambia avatarAssetId, bio ni locale', async () => {
    const user = await registerVerified(app);
    const response = await authPost(
      app,
      '/update-user',
      { avatarAssetId: randomUUID(), bio: 'intruso', locale: 'en' },
      { ip: user.ip, jar: user.jar },
    );
    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    const stored = await app.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.avatarAssetId).toBeNull();
    expect(stored.bio).toBeNull();
    expect(stored.locale).toBe('es');
  });
});

describe('IP real para el rate limit de Better Auth', () => {
  it('dos X-Forwarded-For falsos distintos comparten el contador de la IP real', async () => {
    const proxied = await buildTestApp({ TRUST_PROXY_HOPS: '1' });
    try {
      const realIp = uniqueIp();
      const email = uniqueEmail('xff');
      const attempt = (fake: string) =>
        proxied.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          remoteAddress: '172.16.0.1',
          headers: {
            origin: CLIENT_ORIGIN,
            'content-type': 'application/json',
            'x-forwarded-for': `${fake}, ${realIp}`,
            'x-parcify-client-ip': fake,
          },
          payload: JSON.stringify({ email, password: 'no-es-la-clave-1' }),
        });
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await attempt(`203.0.113.${i + 1}`)).statusCode);
      expect(statuses.slice(0, 5).every((status) => status !== 429)).toBe(true);
      expect(statuses[5]).toBe(429);

      const otherClient = await proxied.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        remoteAddress: '172.16.0.1',
        headers: { origin: CLIENT_ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
        payload: JSON.stringify({ email, password: 'no-es-la-clave-1' }),
      });
      expect(otherClient.statusCode).not.toBe(429);
    } finally {
      await proxied.close();
    }
  });
});

describe('sesiones revocadas', () => {
  it('una sesión revocada no puede hacer POST aunque su cookie de caché siga vigente', async () => {
    const user = await registerVerified(app);
    const signIn = await authPost(app, '/sign-in/email', { email: user.email, password: PASSWORD }, { ip: user.ip });
    const jar = new CookieJar().store(signIn);
    expect(jar.has('parcify.session_data')).toBe(true);

    await app.auth.api.revokeSessions({ headers: new Headers({ cookie: user.jar.header() }) });
    expect(await app.db.session.count({ where: { userId: user.id } })).toBe(0);

    const read = await app.inject({ url: '/v1/me', headers: { cookie: jar.header() } });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { cookie: jar.header(), origin: CLIENT_ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ bio: 'no debería guardarse' }),
    });
    expect(write.statusCode).toBe(401);
    expect(write.json().error.code).toBe('UNAUTHORIZED');
    expect((await app.db.user.findUniqueOrThrow({ where: { id: user.id } })).bio).toBeNull();
  });
});

describe('organizationHooks', () => {
  it('quitar a un miembro publica access.changed en el canal del espacio', async () => {
    const owner = await registerVerified(app);
    const guest = await registerVerified(app);
    const org = await app.db.organization.findFirstOrThrow({ where: { members: { some: { userId: owner.id } } } });
    await app.auth.api.addMember({ body: { userId: guest.id, role: 'member', organizationId: org.id } });

    const subscriber = createRedis(process.env.TEST_REDIS_URL!, { name: 'test-sub' });
    try {
      const received = new Promise<{ channel: string; message: string }>((resolve) => {
        subscriber.on('message', (channel: string, message: string) => resolve({ channel, message }));
      });
      await subscriber.subscribe(orgChannel(org.id));
      await app.auth.api.removeMember({
        body: { memberIdOrEmail: guest.email, organizationId: org.id },
        headers: new Headers({ cookie: owner.jar.header() }),
      });
      const event = await received;
      expect(event.channel).toBe(orgChannel(org.id));
      expect(JSON.parse(event.message)).toEqual({ type: 'access.changed', userId: guest.id });
    } finally {
      subscriber.disconnect();
    }
  });
});
