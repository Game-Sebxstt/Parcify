import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { CLIENT_ORIGIN, registerVerified, waitForMail, withSession, type TestUser } from '../../../../test/helpers/auth.js';
import { addOrgMember, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { ReceivedInvitationSchema, WorkspaceInvitationListResponseSchema, WorkspaceInvitationSchema } from './schemas.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;
type Method = 'GET' | 'POST' | 'DELETE';

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

function call(user: TestUser, method: Method, url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    remoteAddress: user.ip,
    headers: {
      cookie: user.jar.header(),
      origin: CLIENT_ORIGIN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function setup() {
  const owner = await registerVerified(app, { name: 'Ana Owner' });
  const ws = await createWorkspaceFor(app, owner, 'Estudio Norte');
  return { owner, ws };
}

async function invite(admin: TestUser, slug: string, email: string, role: 'admin' | 'member' = 'member') {
  const response = await call(admin, 'POST', `/v1/workspaces/${slug}/invitations`, { email, role });
  expect(response.statusCode, response.body).toBe(201);
  return WorkspaceInvitationSchema.strict().parse(response.json());
}

function errorBody(response: { json: () => { error: Record<string, unknown> } }) {
  const { requestId: _requestId, ...rest } = response.json().error;
  return rest;
}

describe('gestionar invitaciones del espacio', () => {
  it('un admin invita, el correo enlaza a /invitacion?espacio=<id> y la lista solo la ven admins', async () => {
    const { owner, ws } = await setup();
    const admin = await registerVerified(app);
    const member = await registerVerified(app);
    const outsider = await registerVerified(app);
    const invitee = await registerVerified(app);
    await addOrgMember(app, ws.id, admin, 'admin');
    await addOrgMember(app, ws.id, member, 'member');

    const invitation = await invite(admin, ws.slug, invitee.email.toUpperCase());
    expect(invitation).toMatchObject({ email: invitee.email, role: 'member', inviter: { id: admin.id } });

    const mail = (await waitForMail(app, invitee.email, 2)).at(-1);
    expect(mail!.subject).toContain('Estudio Norte');
    expect(mail!.text).toContain(`${CLIENT_ORIGIN}/invitacion?espacio=${invitation.id}`);

    const list = await call(owner, 'GET', `/v1/workspaces/${ws.slug}/invitations`);
    expect(list.statusCode).toBe(200);
    expect(WorkspaceInvitationListResponseSchema.parse(list.json()).items.map((item) => item.id)).toEqual([invitation.id]);

    expect((await call(member, 'GET', `/v1/workspaces/${ws.slug}/invitations`)).statusCode).toBe(403);
    expect((await call(member, 'POST', `/v1/workspaces/${ws.slug}/invitations`, { email: 'x@example.com', role: 'member' })).statusCode).toBe(403);
    expect((await call(member, 'DELETE', `/v1/workspaces/${ws.slug}/invitations/${invitation.id}`)).statusCode).toBe(403);
    expect((await call(outsider, 'GET', `/v1/workspaces/${ws.slug}/invitations`)).statusCode).toBe(404);
    expect((await call(owner, 'POST', `/v1/workspaces/${ws.slug}/invitations`, { email: 'x@example.com', role: 'owner' })).statusCode).toBe(400);

    const duplicate = await call(owner, 'POST', `/v1/workspaces/${ws.slug}/invitations`, { email: member.email, role: 'member' });
    expect(duplicate.statusCode).toBe(409);

    // La ruta de Better Auth que listaría los emails invitados a cualquier miembro sigue cerrada.
    const raw = await app.inject({
      url: `/api/auth/organization/list-invitations?organizationId=${ws.id}`,
      remoteAddress: member.ip,
      headers: withSession(member),
    });
    expect(raw.statusCode).toBe(404);
  });

  it('cancelar deja la invitación inutilizable', async () => {
    const { owner, ws } = await setup();
    const invitee = await registerVerified(app);
    const invitation = await invite(owner, ws.slug, invitee.email);
    expect((await call(owner, 'DELETE', `/v1/workspaces/${ws.slug}/invitations/${invitation.id}`)).statusCode).toBe(204);
    expect((await call(owner, 'DELETE', `/v1/workspaces/${ws.slug}/invitations/${invitation.id}`)).statusCode).toBe(204);
    expect((await call(owner, 'DELETE', `/v1/workspaces/${ws.slug}/invitations/no-existe`)).json().error.code).toBe('INVITE_NOT_FOUND');

    const accepted = await call(invitee, 'POST', `/v1/workspace-invitations/${invitation.id}/accept`);
    expect(accepted.statusCode).toBe(409);
    expect(accepted.json().error.code).toBe('INVITE_ALREADY_HANDLED');
    expect(await app.db.member.count({ where: { organizationId: ws.id, userId: invitee.id } })).toBe(0);
  });

  it('50 invitaciones al día por espacio', async () => {
    const { owner, ws } = await setup();
    for (let i = 0; i < 50; i++) {
      const response = await call(owner, 'POST', `/v1/workspaces/${ws.slug}/invitations`, { email: `cupo-${i}-${ws.id}@example.com`, role: 'member' });
      expect(response.statusCode, response.body).toBe(201);
    }
    const limited = await call(owner, 'POST', `/v1/workspaces/${ws.slug}/invitations`, { email: `cupo-extra-${ws.id}@example.com`, role: 'member' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('recibir una invitación', () => {
  it('ver, aceptar y no poder aceptarla dos veces', async () => {
    const { owner, ws } = await setup();
    const invitee = await registerVerified(app);
    const invitation = await invite(owner, ws.slug, invitee.email, 'admin');

    const detail = await call(invitee, 'GET', `/v1/workspace-invitations/${invitation.id}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(ReceivedInvitationSchema.strict().parse(detail.json())).toMatchObject({
      workspace: { name: 'Estudio Norte', slug: ws.slug },
      role: 'admin',
      inviter: { name: 'Ana Owner' },
      status: 'pending',
    });

    const accepted = await call(invitee, 'POST', `/v1/workspace-invitations/${invitation.id}/accept`);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({ slug: ws.slug });
    expect((await app.db.member.findFirstOrThrow({ where: { organizationId: ws.id, userId: invitee.id } })).role).toBe('admin');

    const twice = await call(invitee, 'POST', `/v1/workspace-invitations/${invitation.id}/accept`);
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error).toMatchObject({ code: 'INVITE_ALREADY_HANDLED', details: { slug: ws.slug } });
    expect((await call(invitee, 'GET', `/v1/workspace-invitations/${invitation.id}`)).json().status).toBe('accepted');
  });

  it('con otro email responde 404 con el mismo cuerpo que una invitación inexistente', async () => {
    const { owner, ws } = await setup();
    const invitee = await registerVerified(app);
    const other = await registerVerified(app);
    const invitation = await invite(owner, ws.slug, invitee.email);

    const missing = await call(other, 'GET', '/v1/workspace-invitations/no-existe');
    expect(missing.statusCode).toBe(404);
    const expected = errorBody(missing);
    expect(expected).toMatchObject({ code: 'INVITE_NOT_FOUND' });

    for (const [method, url] of [
      ['GET', `/v1/workspace-invitations/${invitation.id}`],
      ['POST', `/v1/workspace-invitations/${invitation.id}/accept`],
      ['POST', `/v1/workspace-invitations/${invitation.id}/reject`],
    ] as const) {
      const response = await call(other, method, url);
      expect(response.statusCode, url).toBe(404);
      expect(errorBody(response)).toEqual(expected);
    }
    expect(await app.db.member.count({ where: { organizationId: ws.id, userId: other.id } })).toBe(0);
    expect((await app.db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe('pending');
  });

  it('caducada responde 410 y rechazada 409', async () => {
    const { owner, ws } = await setup();
    const late = await registerVerified(app);
    const declines = await registerVerified(app);

    const expired = await invite(owner, ws.slug, late.email);
    await app.db.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await call(late, 'GET', `/v1/workspace-invitations/${expired.id}`)).json().status).toBe('expired');
    const response = await call(late, 'POST', `/v1/workspace-invitations/${expired.id}/accept`);
    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe('INVITE_EXPIRED');
    expect(await app.db.member.count({ where: { organizationId: ws.id, userId: late.id } })).toBe(0);

    const declined = await invite(owner, ws.slug, declines.email);
    expect((await call(declines, 'POST', `/v1/workspace-invitations/${declined.id}/reject`)).statusCode).toBe(204);
    expect((await app.db.invitation.findUniqueOrThrow({ where: { id: declined.id } })).status).toBe('rejected');
    const after = await call(declines, 'POST', `/v1/workspace-invitations/${declined.id}/accept`);
    expect(after.statusCode).toBe(409);
    expect(after.json().error.code).toBe('INVITE_ALREADY_HANDLED');
    expect((await call(declines, 'POST', `/v1/workspace-invitations/${declined.id}/reject`)).statusCode).toBe(409);
  });

  it('20 consultas por hora y usuario', async () => {
    const user = await registerVerified(app);
    for (let i = 0; i < 20; i++) expect((await call(user, 'GET', '/v1/workspace-invitations/no-existe')).statusCode).toBe(404);
    const limited = await call(user, 'POST', '/v1/workspace-invitations/no-existe/accept');
    expect(limited.statusCode).toBe(429);
  });

  it('sin sesión 401', async () => {
    for (const [method, url] of [
      ['GET', '/v1/workspace-invitations/abc'],
      ['POST', '/v1/workspace-invitations/abc/accept'],
      ['POST', '/v1/workspace-invitations/abc/reject'],
      ['GET', '/v1/workspaces/ws-x/invitations'],
      ['DELETE', '/v1/workspaces/ws-x/invitations/abc'],
    ] as const) {
      expect((await app.inject({ method, url, headers: { origin: CLIENT_ORIGIN } })).statusCode, url).toBe(401);
    }
  });
});
