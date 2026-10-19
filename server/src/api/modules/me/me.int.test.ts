import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import {
  authPost,
  codeFrom,
  registerVerified,
  uniqueEmail,
  waitForMail,
  withSession,
  type TestUser,
} from '../../../../test/helpers/auth.js';
import { orgChannel } from '../../../core/events.js';
import { createRedis } from '../../../core/redis.js';
import { MeResponseSchema } from './schemas.js';
import { deleteMe } from './service.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

function patchMe(user: TestUser, body: unknown) {
  return app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: withSession(user, { 'content-type': 'application/json' }),
    payload: JSON.stringify(body),
  });
}

function deleteMeRequest(user: TestUser) {
  return app.inject({ method: 'DELETE', url: '/v1/me', headers: withSession(user) });
}

async function createAsset(ownerId: string, overrides: { source?: 'avatar' | 'logo'; status?: 'ready' | 'pending' } = {}) {
  const id = randomUUID();
  return app.db.asset.create({
    data: {
      id,
      ownerId,
      source: overrides.source ?? 'avatar',
      status: overrides.status ?? 'ready',
      storageKey: `a/u-${ownerId}/${id}/original.png`,
      mime: 'image/png',
      sizeBytes: 100,
    },
  });
}

async function createWorkspace(owner: TestUser, name: string) {
  return app.auth.api.createOrganization({
    body: { name, slug: `ws-${randomUUID().slice(0, 12)}`, userId: owner.id },
  });
}

async function personalOf(userId: string) {
  return app.db.organization.findFirstOrThrow({ where: { personal: true, members: { some: { userId } } } });
}

describe('GET /v1/me', () => {
  it('401 sin sesión', async () => {
    const response = await app.inject({ url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('devuelve solo los campos declarados, sin datos de account ni el hash', async () => {
    const user = await registerVerified(app);
    const response = await app.inject({ url: '/v1/me', headers: { cookie: user.jar.header() } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(MeResponseSchema.strict().safeParse(body).success).toBe(true);
    expect(Object.keys(body.user).sort()).toEqual(
      ['avatarAssetId', 'bio', 'createdAt', 'email', 'emailVerified', 'id', 'locale', 'name'].sort(),
    );
    const account = await app.db.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(response.body).not.toContain(account.password!);
    expect(response.body).not.toMatch(/password|accessToken|refreshToken|idToken|providerId/);
    expect(body.workspaces).toEqual([expect.objectContaining({ personal: true, role: 'owner' })]);
  });

  it('vuelve a crear el espacio personal si falta', async () => {
    const user = await registerVerified(app);
    const personal = await personalOf(user.id);
    await app.db.organization.delete({ where: { id: personal.id } });

    const response = await app.inject({ url: '/v1/me', headers: { cookie: user.jar.header() } });
    expect(response.statusCode).toBe(200);
    const workspaces = response.json().workspaces as Array<{ id: string; personal: boolean; role: string }>;
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ personal: true, role: 'owner' });
    expect(workspaces[0]!.id).not.toBe(personal.id);
  });
});

describe('PATCH /v1/me', () => {
  it('cambia nombre, bio y locale', async () => {
    const user = await registerVerified(app);
    const response = await patchMe(user, { name: 'Ana Renombrada', bio: 'Diseño cosas', locale: 'en' });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ name: 'Ana Renombrada', bio: 'Diseño cosas', locale: 'en' });
    const stored = await app.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ name: 'Ana Renombrada', bio: 'Diseño cosas', locale: 'en' });
  });

  it('acepta un avatar propio listo y rechaza los demás con 400 INVALID_ASSET', async () => {
    const user = await registerVerified(app);
    const other = await registerVerified(app);
    const own = await createAsset(user.id);
    const foreign = await createAsset(other.id);
    const pending = await createAsset(user.id, { status: 'pending' });
    const logo = await createAsset(user.id, { source: 'logo' });

    for (const id of [randomUUID(), foreign.id, pending.id, logo.id]) {
      const response = await patchMe(user, { avatarAssetId: id });
      expect(response.statusCode, id).toBe(400);
      expect(response.json().error.code).toBe('INVALID_ASSET');
    }
    expect((await app.db.user.findUniqueOrThrow({ where: { id: user.id } })).avatarAssetId).toBeNull();

    const ok = await patchMe(user, { avatarAssetId: own.id });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.avatarAssetId).toBe(own.id);

    const cleared = await patchMe(user, { avatarAssetId: null });
    expect(cleared.json().user.avatarAssetId).toBeNull();
  });

  it('rechaza campos desconocidos', async () => {
    const user = await registerVerified(app);
    const response = await patchMe(user, { emailVerified: false });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /v1/me/security-events', () => {
  function events(user: TestUser, query = '') {
    return app.inject({ url: `/v1/me/security-events${query}`, headers: withSession(user) });
  }

  it('401 sin sesión', async () => {
    const response = await app.inject({ url: '/v1/me/security-events' });
    expect(response.statusCode).toBe(401);
  });

  it('solo devuelve eventos security.* propios, sin ids de sesión', async () => {
    const user = await registerVerified(app);
    const other = await registerVerified(app);
    const project = randomUUID();
    await app.db.activityEvent.createMany({
      data: [
        { actorId: user.id, type: 'project.created', projectId: project },
        { actorId: user.id, type: 'security.session_revoked', projectId: project },
        { actorId: other.id, type: 'security.email_changed' },
        { actorId: user.id, type: 'security.account_linked', data: { provider: 'google' } },
      ],
    });
    const response = await events(user);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<Record<string, unknown>>; nextCursor: string | null };
    expect(body.items.map((item) => item.type).sort()).toEqual(['security.account_linked', 'security.session_created']);
    expect(body.items.find((item) => item.type === 'security.account_linked')).toMatchObject({ provider: 'google' });
    expect(response.body).not.toContain('sessionId');
    const own = await app.db.activityEvent.findFirstOrThrow({ where: { actorId: user.id, type: 'security.session_created' } });
    expect(response.body).not.toContain(String((own.data as { sessionId: string }).sessionId));
    const foreign = await events(other);
    expect((foreign.json().items as Array<{ type: string }>).map((item) => item.type).sort()).toEqual([
      'security.email_changed',
      'security.session_created',
    ]);
  });

  it('pagina por cursor del más reciente al más antiguo', async () => {
    const user = await registerVerified(app);
    for (let i = 0; i < 3; i++) {
      await app.db.activityEvent.create({
        data: { actorId: user.id, type: 'security.session_revoked', createdAt: new Date(Date.now() + (i + 1) * 1000) },
      });
    }
    const first = await events(user, '?limit=2');
    const page1 = first.json() as { items: Array<{ id: string; createdAt: string }>; nextCursor: string | null };
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBe(page1.items[1]!.id);
    expect(Date.parse(page1.items[0]!.createdAt)).toBeGreaterThan(Date.parse(page1.items[1]!.createdAt));
    const second = await events(user, `?limit=2&cursor=${page1.nextCursor}`);
    const page2 = second.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.items, ...page2.items].map((item) => item.id)).size).toBe(4);
  });
});

describe('POST /v1/me/password', () => {
  it('crea la contraseña de una cuenta sin credencial y deja un evento security.password_changed', async () => {
    const user = await registerVerified(app);
    await app.db.account.deleteMany({ where: { userId: user.id, providerId: 'credential' } });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/password',
      headers: withSession(user, { 'content-type': 'application/json' }),
      payload: JSON.stringify({ newPassword: 'otra-clave-segura-9' }),
    });
    expect(response.statusCode).toBe(204);
    expect(await app.db.account.count({ where: { userId: user.id, providerId: 'credential' } })).toBe(1);
    expect(await app.db.activityEvent.count({ where: { actorId: user.id, type: 'security.password_changed' } })).toBe(1);
  });

  it('409 si la cuenta ya tiene contraseña', async () => {
    const user = await registerVerified(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/password',
      headers: withSession(user, { 'content-type': 'application/json' }),
      payload: JSON.stringify({ newPassword: 'otra-clave-segura-9' }),
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('cambio de email por código', () => {
  it('envía el código a la dirección nueva, avisa a la actual y cambia el email al verificarlo', async () => {
    const user = await registerVerified(app);
    const newEmail = uniqueEmail('nueva');
    const request = await authPost(app, '/email-otp/request-email-change', { newEmail }, { ip: user.ip, jar: user.jar });
    expect(request.statusCode).toBe(200);
    const [codeMail] = await waitForMail(app, newEmail);
    expect(codeMail!.subject).toMatch(/cambiar el email/);
    const notices = await waitForMail(app, user.email, 2);
    expect(notices.at(-1)!.subject).toMatch(/Cambio de email/);
    const change = await authPost(app, '/email-otp/change-email', { newEmail, otp: codeFrom(codeMail!) }, { ip: user.ip, jar: user.jar });
    expect(change.statusCode).toBe(200);
    const stored = await app.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ email: newEmail, emailVerified: true });
    expect(await app.db.activityEvent.count({ where: { actorId: user.id, type: 'security.email_changed' } })).toBe(1);
  });
});

describe('DELETE /v1/me', () => {
  it('409 MUST_TRANSFER_OWNERSHIP si es el único owner de un espacio compartido, y nada cambia', async () => {
    const owner = await registerVerified(app);
    const member = await registerVerified(app);
    const shared = await createWorkspace(owner, 'Estudio compartido');
    await app.auth.api.addMember({ body: { userId: member.id, role: 'member', organizationId: shared.id } });
    const avatar = await createAsset(owner.id);
    await app.db.favorite.create({ data: { userId: owner.id, targetType: 'project', targetId: randomUUID() } });

    const response = await deleteMeRequest(owner);
    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error.code).toBe('MUST_TRANSFER_OWNERSHIP');
    expect(body.error.details.workspaces).toEqual([{ slug: shared.slug, name: 'Estudio compartido' }]);

    expect(await app.db.user.count({ where: { id: owner.id } })).toBe(1);
    expect((await personalOf(owner.id)).deletedAt).toBeNull();
    expect((await app.db.organization.findUniqueOrThrow({ where: { id: shared.id } })).deletedAt).toBeNull();
    expect((await app.db.asset.findUniqueOrThrow({ where: { id: avatar.id } })).deletedAt).toBeNull();
    expect(await app.db.favorite.count({ where: { userId: owner.id } })).toBe(1);
  });

  it('borra la cuenta: papelera para el personal y los de un solo miembro, avatar con deletedAt y sin favoritos', async () => {
    const user = await registerVerified(app);
    const coOwner = await registerVerified(app);
    const personal = await personalOf(user.id);
    const solo = await createWorkspace(user, 'Solo mío');
    const withCoOwner = await createWorkspace(user, 'Con otra owner');
    await app.auth.api.addMember({ body: { userId: coOwner.id, role: 'owner', organizationId: withCoOwner.id } });
    const avatar = await createAsset(user.id);
    await patchMe(user, { avatarAssetId: avatar.id });
    await app.db.favorite.createMany({
      data: [
        { userId: user.id, targetType: 'project', targetId: randomUUID() },
        { userId: user.id, targetType: 'template', targetId: randomUUID() },
      ],
    });
    const otherFavorite = await app.db.favorite.create({
      data: { userId: coOwner.id, targetType: 'project', targetId: randomUUID() },
    });

    const subscriber = createRedis(process.env.TEST_REDIS_URL!, { name: 'test-sub' });
    const received: Array<{ channel: string; message: string }> = [];
    subscriber.on('message', (channel: string, message: string) => received.push({ channel, message }));
    await subscriber.subscribe(orgChannel(personal.id), orgChannel(solo.id), orgChannel(withCoOwner.id));

    try {
      const response = await deleteMeRequest(user);
      expect(response.statusCode).toBe(204);

      expect(await app.db.user.count({ where: { id: user.id } })).toBe(0);
      expect(await app.db.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await app.db.account.count({ where: { userId: user.id } })).toBe(0);
      expect(await app.db.member.count({ where: { userId: user.id } })).toBe(0);

      expect((await app.db.organization.findUniqueOrThrow({ where: { id: personal.id } })).deletedAt).toBeInstanceOf(Date);
      expect((await app.db.organization.findUniqueOrThrow({ where: { id: solo.id } })).deletedAt).toBeInstanceOf(Date);
      expect((await app.db.organization.findUniqueOrThrow({ where: { id: withCoOwner.id } })).deletedAt).toBeNull();

      expect((await app.db.asset.findUniqueOrThrow({ where: { id: avatar.id } })).deletedAt).toBeInstanceOf(Date);
      expect(await app.db.favorite.count({ where: { userId: user.id } })).toBe(0);
      expect(await app.db.favorite.count({ where: { userId: coOwner.id, targetId: otherFavorite.targetId } })).toBe(1);

      const after = await patchMe(user, { bio: 'ya no existo' });
      expect(after.statusCode).toBe(401);
      const read = await app.inject({ url: '/v1/me', headers: { cookie: user.jar.header() } });
      expect(read.statusCode).toBe(401);

      for (let i = 0; i < 40 && received.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 25));
      const deleted = received
        .filter((event) => JSON.parse(event.message).type === 'workspace.deleted')
        .map((event) => event.channel)
        .sort();
      expect(deleted).toEqual([orgChannel(personal.id), orgChannel(solo.id)].sort());
    } finally {
      subscriber.disconnect();
    }
  });

  it('exige una sesión fresca', async () => {
    const user = await registerVerified(app);
    const deps = { db: app.db, redis: app.redis, auth: app.auth, logger: app.log };
    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await expect(deleteMe(deps, { userId: user.id, sessionId: 'x' }, stale)).rejects.toMatchObject({
      code: 'SESSION_NOT_FRESH',
      statusCode: 403,
    });
    expect(await app.db.user.count({ where: { id: user.id } })).toBe(1);
  });

  it('403 BAD_ORIGIN desde un origen ajeno', async () => {
    const user = await registerVerified(app);
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { cookie: user.jar.header(), origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(await app.db.user.count({ where: { id: user.id } })).toBe(1);
  });
});
