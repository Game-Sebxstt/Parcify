import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified, type TestUser } from '../../../../test/helpers/auth.js';
import { addOrgMember, api, createProjectRow, createWorkspaceFor, subscribe } from '../../../../test/helpers/seed.js';
import { orgChannel } from '../../../core/events.js';
import { WorkspaceDetailSchema, WorkspaceListResponseSchema } from './schemas.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

async function memberIdOf(organizationId: string, userId: string) {
  return (await app.db.member.findFirstOrThrow({ where: { organizationId, userId } })).id;
}

async function personalOf(user: TestUser) {
  return app.db.organization.findFirstOrThrow({ where: { personal: true, members: { some: { userId: user.id } } } });
}

describe('crear, renombrar y listar espacios', () => {
  it('POST /workspaces crea el espacio con slug y el creador como owner', async () => {
    const user = await registerVerified(app);
    const response = await api(app, user, 'POST', '/v1/workspaces', { name: 'Estudio Ñandú' });
    expect(response.statusCode).toBe(201);
    const body = WorkspaceDetailSchema.strict().parse(response.json());
    expect(body).toMatchObject({ name: 'Estudio Ñandú', role: 'owner', personal: false, deletedAt: null, purgeAt: null });
    expect(body.slug).toMatch(/^estudio-nandu(-[a-z0-9]{4})?$/);
    expect(body.counts).toEqual({ members: 1, projects: 0 });

    const again = await api(app, user, 'POST', '/v1/workspaces', { name: 'Estudio Ñandú' });
    expect(again.statusCode).toBe(201);
    expect(again.json().slug).toMatch(/^estudio-nandu-[a-z0-9]{4}$/);

    const list = await api(app, user, 'GET', '/v1/workspaces');
    const items = WorkspaceListResponseSchema.parse(list.json()).items;
    expect(items.map((item) => item.slug)).toEqual(expect.arrayContaining([body.slug, again.json().slug]));
    expect(items.some((item) => item.personal)).toBe(true);
  });

  it('valida el nombre', async () => {
    const user = await registerVerified(app);
    for (const name of ['', '   ', 'x'.repeat(81), 'con\u0007control']) {
      const response = await api(app, user, 'POST', '/v1/workspaces', { name });
      expect(response.statusCode, JSON.stringify(name)).toBe(400);
    }
  });

  it('PATCH renombra (admin sí, member no) y valida el logo', async () => {
    const owner = await registerVerified(app);
    const admin = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, admin, 'admin');
    await addOrgMember(app, ws.id, member, 'member');

    const renamed = await api(app, admin, 'PATCH', `/v1/workspaces/${ws.slug}`, { name: 'Nuevo nombre' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'Nuevo nombre', role: 'admin' });

    const denied = await api(app, member, 'PATCH', `/v1/workspaces/${ws.slug}`, { name: 'No' });
    expect(denied.statusCode).toBe(403);

    const id = randomUUID();
    await app.db.asset.create({
      data: {
        id,
        ownerId: admin.id,
        organizationId: ws.id,
        source: 'logo',
        status: 'ready',
        storageKey: `a/${ws.id}/${id}/original.png`,
        mime: 'image/png',
        sizeBytes: 10,
      },
    });
    const foreignLogo = await api(app, admin, 'PATCH', `/v1/workspaces/${ws.slug}`, { logoAssetId: randomUUID() });
    expect(foreignLogo.json().error.code).toBe('INVALID_ASSET');
    const logo = await api(app, admin, 'PATCH', `/v1/workspaces/${ws.slug}`, { logoAssetId: id });
    expect(logo.json().logoAssetId).toBe(id);

    const outsider = await registerVerified(app);
    expect((await api(app, outsider, 'GET', `/v1/workspaces/${ws.slug}`)).statusCode).toBe(404);
  });
});

describe('papelera del espacio', () => {
  it('el personal no se borra', async () => {
    const user = await registerVerified(app);
    const personal = await personalOf(user);
    const response = await api(app, user, 'DELETE', `/v1/workspaces/${personal.slug}`);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PERSONAL_WORKSPACE');
  });

  it('solo el owner borra y restaura; el resto deja de verlo', async () => {
    const owner = await registerVerified(app);
    const admin = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner, 'Para la papelera');
    await addOrgMember(app, ws.id, admin, 'admin');
    await addOrgMember(app, ws.id, member, 'member');
    await createProjectRow(app, ws.id, owner.id);

    expect((await api(app, admin, 'DELETE', `/v1/workspaces/${ws.slug}`)).statusCode).toBe(403);

    const events = await subscribe([orgChannel(ws.id)]);
    try {
      const before = Date.now();
      expect((await api(app, owner, 'DELETE', `/v1/workspaces/${ws.slug}`)).statusCode).toBe(204);
      expect(await events.waitFor((m) => m.event.type === 'workspace.deleted')).toBeDefined();

      const list = WorkspaceListResponseSchema.parse((await api(app, owner, 'GET', '/v1/workspaces')).json()).items;
      const trashed = list.find((item) => item.id === ws.id)!;
      expect(trashed.deletedAt).not.toBeNull();
      const deletedAt = Date.parse(trashed.deletedAt!);
      expect(deletedAt).toBeGreaterThanOrEqual(before - 1_000);
      expect(Date.parse(trashed.purgeAt!) - deletedAt).toBe(30 * 86_400_000);

      for (const user of [admin, member]) {
        const items = (await api(app, user, 'GET', '/v1/workspaces')).json().items as Array<{ id: string }>;
        expect(items.some((item) => item.id === ws.id)).toBe(false);
        expect((await api(app, user, 'GET', `/v1/workspaces/${ws.slug}`)).statusCode).toBe(404);
        expect((await api(app, user, 'GET', `/v1/workspaces/${ws.slug}/members`)).statusCode).toBe(404);
        expect((await api(app, user, 'GET', `/v1/workspaces/${ws.slug}/projects`)).statusCode).toBe(404);
        expect((await api(app, user, 'POST', `/v1/workspaces/${ws.slug}/restore`)).statusCode).toBe(404);
      }

      const detail = await api(app, owner, 'GET', `/v1/workspaces/${ws.slug}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.json().deletedAt).not.toBeNull();

      const blocked: Array<[Parameters<typeof api>[2], string, unknown?]> = [
        ['PATCH', `/v1/workspaces/${ws.slug}`, { name: 'x' }],
        ['DELETE', `/v1/workspaces/${ws.slug}`],
        ['GET', `/v1/workspaces/${ws.slug}/members`],
        ['GET', `/v1/workspaces/${ws.slug}/projects`],
        ['POST', `/v1/workspaces/${ws.slug}/projects`, { name: 'x' }],
        ['PATCH', `/v1/workspaces/${ws.slug}/members/${await memberIdOf(ws.id, member.id)}`, { role: 'admin' }],
        ['DELETE', `/v1/workspaces/${ws.slug}/members/${await memberIdOf(ws.id, member.id)}`],
      ];
      for (const [method, url, body] of blocked) {
        const response = await api(app, owner, method, url, body);
        expect(response.statusCode, `${method} ${url}`).toBe(409);
        expect(response.json().error.code).toBe('WORKSPACE_IN_TRASH');
      }

      const restored = await api(app, owner, 'POST', `/v1/workspaces/${ws.slug}/restore`);
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toMatchObject({ deletedAt: null, purgeAt: null });
      expect((await api(app, member, 'GET', `/v1/workspaces/${ws.slug}`)).statusCode).toBe(200);
    } finally {
      events.close();
    }
  });
});

describe('miembros del espacio', () => {
  it('lista paginada por cursor', async () => {
    const owner = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    for (let i = 0; i < 3; i++) await addOrgMember(app, ws.id, await registerVerified(app), 'member');

    const first = await api(app, owner, 'GET', `/v1/workspaces/${ws.slug}/members?limit=2`);
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(2);
    expect(first.json().nextCursor).toBeTruthy();
    const second = await api(app, owner, 'GET', `/v1/workspaces/${ws.slug}/members?limit=2&cursor=${first.json().nextCursor}`);
    expect(second.json().items).toHaveLength(2);
    expect(second.json().nextCursor).toBeNull();
    const ids = [...first.json().items, ...second.json().items].map((item: { userId: string }) => item.userId);
    expect(new Set(ids).size).toBe(4);
    expect(Object.keys(first.json().items[0]).sort()).toEqual(
      ['avatarAssetId', 'createdAt', 'email', 'id', 'name', 'role', 'userId'].sort(),
    );
    expect((await api(app, owner, 'GET', `/v1/workspaces/${ws.slug}/members?limit=51`)).statusCode).toBe(400);
  });

  it('cambia roles: solo un owner toca owners y el último owner no se degrada', async () => {
    const owner = await registerVerified(app);
    const admin = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, admin, 'admin');
    await addOrgMember(app, ws.id, member, 'member');
    const memberId = await memberIdOf(ws.id, member.id);
    const ownerMemberId = await memberIdOf(ws.id, owner.id);

    const promoted = await api(app, admin, 'PATCH', `/v1/workspaces/${ws.slug}/members/${memberId}`, { role: 'admin' });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().role).toBe('admin');
    expect(
      await app.db.activityEvent.count({ where: { type: 'member.role_changed', actorId: admin.id } }),
    ).toBe(1);

    const toOwner = await api(app, admin, 'PATCH', `/v1/workspaces/${ws.slug}/members/${memberId}`, { role: 'owner' });
    expect(toOwner.statusCode).toBe(403);
    const touchOwner = await api(app, admin, 'PATCH', `/v1/workspaces/${ws.slug}/members/${ownerMemberId}`, { role: 'member' });
    expect(touchOwner.statusCode).toBe(403);

    const lastOwner = await api(app, owner, 'PATCH', `/v1/workspaces/${ws.slug}/members/${ownerMemberId}`, { role: 'admin' });
    expect(lastOwner.statusCode).toBe(409);
    expect(lastOwner.json().error.code).toBe('LAST_OWNER');

    const unknown = await api(app, owner, 'PATCH', `/v1/workspaces/${ws.slug}/members/no-existe`, { role: 'admin' });
    expect(unknown.statusCode).toBe(404);
  });

  it('expulsar publica access.changed; un member no puede expulsar', async () => {
    const owner = await registerVerified(app);
    const admin = await registerVerified(app);
    const member = await registerVerified(app);
    const other = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, admin, 'admin');
    await addOrgMember(app, ws.id, member, 'member');
    await addOrgMember(app, ws.id, other, 'member');

    const denied = await api(app, member, 'DELETE', `/v1/workspaces/${ws.slug}/members/${await memberIdOf(ws.id, other.id)}`);
    expect(denied.statusCode).toBe(403);
    const ownerByAdmin = await api(app, admin, 'DELETE', `/v1/workspaces/${ws.slug}/members/${await memberIdOf(ws.id, owner.id)}`);
    expect(ownerByAdmin.statusCode).toBe(403);

    const events = await subscribe([orgChannel(ws.id)]);
    try {
      const kicked = await api(app, admin, 'DELETE', `/v1/workspaces/${ws.slug}/members/${await memberIdOf(ws.id, other.id)}`);
      expect(kicked.statusCode).toBe(204);
      const event = await events.waitFor((m) => m.event.type === 'access.changed' && m.event.userId === other.id);
      expect(event?.channel).toBe(orgChannel(ws.id));
      expect(await app.db.member.count({ where: { organizationId: ws.id, userId: other.id } })).toBe(0);
      expect(await app.db.activityEvent.count({ where: { type: 'member.removed', actorId: admin.id } })).toBe(1);
      expect((await api(app, other, 'GET', `/v1/workspaces/${ws.slug}`)).statusCode).toBe(404);
    } finally {
      events.close();
    }
  });

  it('salir publica access.changed; el personal y el último owner no se abandonan', async () => {
    const owner = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, member, 'member');

    const personal = await personalOf(owner);
    const leavePersonal = await api(
      app,
      owner,
      'DELETE',
      `/v1/workspaces/${personal.slug}/members/${await memberIdOf(personal.id, owner.id)}`,
    );
    expect(leavePersonal.statusCode).toBe(409);
    expect(leavePersonal.json().error.code).toBe('PERSONAL_WORKSPACE');

    const leaveAsLastOwner = await api(app, owner, 'DELETE', `/v1/workspaces/${ws.slug}/members/${await memberIdOf(ws.id, owner.id)}`);
    expect(leaveAsLastOwner.statusCode).toBe(409);
    expect(leaveAsLastOwner.json().error.code).toBe('LAST_OWNER');

    const events = await subscribe([orgChannel(ws.id)]);
    try {
      const left = await api(app, member, 'DELETE', `/v1/workspaces/${ws.slug}/members/${await memberIdOf(ws.id, member.id)}`);
      expect(left.statusCode).toBe(204);
      expect(await events.waitFor((m) => m.event.type === 'access.changed' && m.event.userId === member.id)).toBeDefined();
      expect(await app.db.activityEvent.count({ where: { type: 'member.left', actorId: member.id } })).toBe(1);
    } finally {
      events.close();
    }
  });
});
