import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { CLIENT_ORIGIN, registerVerified, uniqueIp, waitForMail, type TestUser } from '../../../../test/helpers/auth.js';
import {
  addOrgMember,
  addProjectMember,
  api,
  createProjectRow,
  createWorkspaceFor,
  subscribe,
} from '../../../../test/helpers/seed.js';
import { projectChannel } from '../../../core/events.js';
import { CreatedShareLinkSchema, ShareLinkInspectSchema, ShareLinkListResponseSchema } from './schemas.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

// Con la IP de cada usuario: el límite por IP no se comparte entre pruebas.
function call(target: App, user: TestUser, method: Method, url: string, body?: unknown, ip = user.ip) {
  return target.inject({
    method,
    url,
    remoteAddress: ip,
    headers: {
      cookie: user.jar.header(),
      origin: CLIENT_ORIGIN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

function tokenOf(url: string): string {
  const match = /#t=([A-Za-z0-9_-]+)$/.exec(url);
  if (!match) throw new Error(`URL sin token: ${url}`);
  return match[1]!;
}

async function setup(orgAccess: 'none' | 'viewer' | 'editor' = 'none') {
  const owner = await registerVerified(app);
  const ws = await createWorkspaceFor(app, owner);
  const project = await createProjectRow(app, ws.id, owner.id, { orgAccess });
  return { owner, ws, project };
}

async function createLink(
  owner: TestUser,
  projectId: string,
  body: { role: string; expiresInDays: number; maxUses?: number; email?: string },
  target = app,
) {
  const response = await call(target, owner, 'POST', `/v1/projects/${projectId}/share-links`, body);
  expect(response.statusCode, response.body).toBe(201);
  const link = CreatedShareLinkSchema.strict().parse(response.json());
  return { link, token: tokenOf(link.url) };
}

const accept = (user: TestUser, token: string, target = app) => call(target, user, 'POST', '/v1/share-links/accept', { token });
const inspect = (user: TestUser, token: string, target = app) => call(target, user, 'POST', '/v1/share-links/inspect', { token });

describe('crear, listar y revocar enlaces', () => {
  it('el token solo sale al crear y en la base de datos solo queda su SHA-256', async () => {
    const { owner, project } = await setup();
    const { link, token } = await createLink(owner, project.id, { role: 'editor', expiresInDays: 7, maxUses: 3 });
    expect(link.url).toBe(`${CLIENT_ORIGIN}/invitacion#t=${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(link).toMatchObject({ role: 'editor', maxUses: 3, uses: 0, email: null });
    const days = (Date.parse(link.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const row = await app.db.projectShareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(token);

    const list = await call(app, owner, 'GET', `/v1/projects/${project.id}/share-links`);
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(token);
    const items = ShareLinkListResponseSchema.parse(list.json()).items;
    expect(items.map((item) => item.id)).toEqual([link.id]);
    expect(items[0]).not.toHaveProperty('url');
    expect(items[0]).not.toHaveProperty('tokenHash');
  });

  it('valida el rol, la caducidad y los usos; nunca admin', async () => {
    const { owner, project } = await setup();
    const url = `/v1/projects/${project.id}/share-links`;
    for (const body of [
      { role: 'admin', expiresInDays: 7 },
      { role: 'editor', expiresInDays: 0 },
      { role: 'editor', expiresInDays: 31 },
      { role: 'editor', expiresInDays: 7, maxUses: 0 },
      { role: 'editor', expiresInDays: 7, maxUses: 501 },
      { role: 'editor', expiresInDays: 7, email: 'no-es-email' },
      { role: 'editor', expiresInDays: 7, token: 'elegido-por-el-cliente' },
    ]) {
      const response = await call(app, owner, 'POST', url, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await app.db.projectShareLink.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('solo un admin del proyecto gestiona enlaces; los demás reciben 403 o 404', async () => {
    const { owner, ws, project } = await setup('editor');
    const member = await registerVerified(app);
    const outsider = await registerVerified(app);
    const guestAdmin = await registerVerified(app);
    await addOrgMember(app, ws.id, member, 'member');
    await addProjectMember(app, project.id, guestAdmin.id, 'admin');
    const url = `/v1/projects/${project.id}/share-links`;
    const { link } = await createLink(owner, project.id, { role: 'viewer', expiresInDays: 1 });

    expect((await call(app, member, 'GET', url)).statusCode).toBe(403);
    expect((await call(app, member, 'POST', url, { role: 'viewer', expiresInDays: 1 })).statusCode).toBe(403);
    expect((await call(app, member, 'DELETE', `${url}/${link.id}`)).statusCode).toBe(403);
    expect((await call(app, member, 'POST', `/v1/projects/${project.id}/invitations`, { email: outsider.email, role: 'viewer' })).statusCode).toBe(403);
    expect((await call(app, outsider, 'GET', url)).statusCode).toBe(404);
    expect((await call(app, outsider, 'POST', url, { role: 'viewer', expiresInDays: 1 })).statusCode).toBe(404);
    expect((await call(app, outsider, 'DELETE', `${url}/${link.id}`)).statusCode).toBe(404);

    // Un invitado externo con rol admin sí puede, pero tampoco concede admin.
    expect((await call(app, guestAdmin, 'POST', url, { role: 'editor', expiresInDays: 1 })).statusCode).toBe(201);
    expect((await call(app, guestAdmin, 'POST', url, { role: 'admin', expiresInDays: 1 })).statusCode).toBe(400);

    expect((await call(app, owner, 'DELETE', `${url}/${randomUUID()}`)).statusCode).toBe(404);
    const otherProject = await createProjectRow(app, ws.id, owner.id);
    expect((await call(app, owner, 'DELETE', `/v1/projects/${otherProject.id}/share-links/${link.id}`)).statusCode).toBe(404);
  });
});

describe('aceptar un enlace', () => {
  it('crea el ProjectMember, consume un uso, registra member.added y publica access.changed', async () => {
    const { owner, project } = await setup();
    const guest = await registerVerified(app, { name: 'Bea Invitada' });
    const { link, token } = await createLink(owner, project.id, { role: 'editor', expiresInDays: 7, maxUses: 2 });

    const seen = await inspect(guest, token);
    expect(seen.statusCode, seen.body).toBe(200);
    expect(ShareLinkInspectSchema.strict().parse(seen.json())).toMatchObject({
      project: { id: project.id, name: project.name },
      workspace: { name: 'Estudio de pruebas' },
      role: 'editor',
      inviter: { name: owner.name },
      currentRole: null,
    });
    // inspect no concede nada.
    expect(await app.db.projectMember.count({ where: { projectId: project.id } })).toBe(0);
    expect((await app.db.projectShareLink.findUniqueOrThrow({ where: { id: link.id } })).uses).toBe(0);

    const events = await subscribe([projectChannel(project.id)]);
    try {
      const accepted = await accept(guest, token);
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(accepted.json()).toEqual({ projectId: project.id, role: 'editor' });
      expect(await events.waitFor((m) => m.event.type === 'access.changed' && m.event.userId === guest.id)).toBeDefined();
    } finally {
      events.close();
    }

    const member = await app.db.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: project.id, userId: guest.id } },
    });
    expect(member).toMatchObject({ role: 'editor', addedById: owner.id });
    expect((await app.db.projectShareLink.findUniqueOrThrow({ where: { id: link.id } })).uses).toBe(1);
    const activity = await app.db.activityEvent.findFirstOrThrow({ where: { projectId: project.id, type: 'member.added' } });
    expect(activity.data).toMatchObject({ userId: guest.id, role: 'editor', via: 'share_link', linkId: link.id });
    expect(JSON.stringify(activity.data)).not.toContain(token);
    expect((await call(app, guest, 'GET', `/v1/projects/${project.id}`)).statusCode).toBe(200);

    // Idempotente: aceptar otra vez no gasta usos.
    const again = await accept(guest, token);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ projectId: project.id, role: 'editor' });
    expect((await app.db.projectShareLink.findUniqueOrThrow({ where: { id: link.id } })).uses).toBe(1);
  });

  it('no rebaja un rol mayor y sube uno menor', async () => {
    const { owner, ws, project } = await setup('editor');
    const editor = await registerVerified(app);
    const viewer = await registerVerified(app);
    const orgMember = await registerVerified(app);
    await addProjectMember(app, project.id, editor.id, 'editor');
    await addProjectMember(app, project.id, viewer.id, 'viewer');
    await addOrgMember(app, ws.id, orgMember, 'member');

    const viewerLink = await createLink(owner, project.id, { role: 'viewer', expiresInDays: 1 });
    const keep = await accept(editor, viewerLink.token);
    expect(keep.json()).toEqual({ projectId: project.id, role: 'editor' });
    // El rol que da el espacio también cuenta: no se crea un acceso directo menor.
    const viaWorkspace = await accept(orgMember, viewerLink.token);
    expect(viaWorkspace.json()).toEqual({ projectId: project.id, role: 'editor' });
    expect(await app.db.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: orgMember.id } } })).toBeNull();
    expect((await app.db.projectShareLink.findUniqueOrThrow({ where: { id: viewerLink.link.id } })).uses).toBe(0);

    const editorLink = await createLink(owner, project.id, { role: 'editor', expiresInDays: 1 });
    const upgraded = await accept(viewer, editorLink.token);
    expect(upgraded.json()).toEqual({ projectId: project.id, role: 'editor' });
    const row = await app.db.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: project.id, userId: viewer.id } },
    });
    expect(row.role).toBe('editor');
    expect(await app.db.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: project.id, userId: editor.id } } })).toMatchObject({ role: 'editor' });
  });

  it('caducado, revocado y agotado devuelven su motivo sin conceder nada', async () => {
    const { owner, project } = await setup();
    const [a, b, c] = await Promise.all([registerVerified(app), registerVerified(app), registerVerified(app)]);

    const expired = await createLink(owner, project.id, { role: 'viewer', expiresInDays: 1 });
    await app.db.projectShareLink.update({ where: { id: expired.link.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    for (const response of [await inspect(a, expired.token), await accept(a, expired.token)]) {
      expect(response.statusCode).toBe(410);
      expect(response.json().error.code).toBe('INVITE_EXPIRED');
    }

    const revoked = await createLink(owner, project.id, { role: 'viewer', expiresInDays: 1 });
    expect((await call(app, owner, 'DELETE', `/v1/projects/${project.id}/share-links/${revoked.link.id}`)).statusCode).toBe(204);
    expect((await call(app, owner, 'DELETE', `/v1/projects/${project.id}/share-links/${revoked.link.id}`)).statusCode).toBe(204);
    for (const response of [await inspect(a, revoked.token), await accept(a, revoked.token)]) {
      expect(response.statusCode).toBe(410);
      expect(response.json().error.code).toBe('INVITE_REVOKED');
    }

    const single = await createLink(owner, project.id, { role: 'viewer', expiresInDays: 1, maxUses: 1 });
    expect((await accept(b, single.token)).statusCode).toBe(200);
    for (const response of [await inspect(c, single.token), await accept(c, single.token)]) {
      expect(response.statusCode).toBe(410);
      expect(response.json().error.code).toBe('INVITE_USED_UP');
    }

    const ids = (await app.db.projectMember.findMany({ where: { projectId: project.id } })).map((row) => row.userId);
    expect(ids).toEqual([b.id]);
    const list = ShareLinkListResponseSchema.parse((await call(app, owner, 'GET', `/v1/projects/${project.id}/share-links`)).json());
    expect(list.items).toEqual([]);
  });

  it('un enlace con email fijado solo sirve para esa cuenta', async () => {
    const { owner, project } = await setup();
    const invited = await registerVerified(app);
    const other = await registerVerified(app);
    const { token } = await createLink(owner, project.id, {
      role: 'editor',
      expiresInDays: 1,
      email: invited.email.toUpperCase(),
    });
    for (const response of [await inspect(other, token), await accept(other, token)]) {
      expect(response.json().error.code).toBe('INVITE_EMAIL_MISMATCH');
    }
    expect(await app.db.projectMember.count({ where: { projectId: project.id } })).toBe(0);
    expect((await accept(invited, token)).statusCode).toBe(200);
  });

  it('token inexistente, mal formado o de un proyecto en papelera: misma respuesta 404', async () => {
    const { owner, project } = await setup();
    const user = await registerVerified(app);
    const { token } = await createLink(owner, project.id, { role: 'viewer', expiresInDays: 1 });
    await app.db.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });

    const bodies = [];
    for (const candidate of [Buffer.alloc(32, 7).toString('base64url'), 'corto', `${token}x`, token]) {
      for (const response of [await inspect(user, candidate), await accept(user, candidate)]) {
        expect(response.statusCode, candidate).toBe(404);
        const { requestId: _requestId, ...rest } = response.json().error;
        bodies.push(JSON.stringify(rest));
      }
    }
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toMatchObject({ code: 'INVITE_NOT_FOUND' });
  });

  it('20 aceptaciones concurrentes de un enlace con maxUses = 5 dejan exactamente 5 miembros', async () => {
    const { owner, project } = await setup();
    const users = await Promise.all(Array.from({ length: 20 }, () => registerVerified(app)));
    const { link, token } = await createLink(owner, project.id, { role: 'editor', expiresInDays: 1, maxUses: 5 });

    const responses = await Promise.all(users.map((user) => accept(user, token)));
    const statuses = responses.map((response) => response.statusCode);
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    const failures = responses.filter((response) => response.statusCode !== 200);
    expect(failures).toHaveLength(15);
    for (const failure of failures) expect(failure.json().error.code).toBe('INVITE_USED_UP');

    expect(await app.db.projectMember.count({ where: { projectId: project.id } })).toBe(5);
    expect((await app.db.projectShareLink.findUniqueOrThrow({ where: { id: link.id } })).uses).toBe(5);
  });

  it('un enlace deja de valer si quien lo creó es degradado o expulsado', async () => {
    const { ws, project } = await setup();
    const projectAdmin = await registerVerified(app);
    const wsAdmin = await registerVerified(app);
    const third = await registerVerified(app);
    await addProjectMember(app, project.id, projectAdmin.id, 'admin');
    await addOrgMember(app, ws.id, wsAdmin, 'admin');

    const fromProjectAdmin = await createLink(projectAdmin, project.id, { role: 'editor', expiresInDays: 1 });
    const fromWsAdmin = await createLink(wsAdmin, project.id, { role: 'editor', expiresInDays: 1 });
    await app.db.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId: projectAdmin.id } },
      data: { role: 'viewer' },
    });
    await app.db.member.deleteMany({ where: { organizationId: ws.id, userId: wsAdmin.id } });

    for (const [creator, token] of [
      [projectAdmin, fromProjectAdmin.token],
      [wsAdmin, fromWsAdmin.token],
    ] as const) {
      for (const user of [creator, third]) {
        for (const response of [await inspect(user, token), await accept(user, token)]) {
          expect(response.statusCode, response.body).toBe(410);
          expect(response.json().error.code).toBe('INVITE_REVOKED');
        }
      }
    }

    expect(await app.db.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: project.id, userId: projectAdmin.id } } })).toMatchObject({ role: 'viewer' });
    const ids = (await app.db.projectMember.findMany({ where: { projectId: project.id } })).map((row) => row.userId);
    expect(ids).toEqual([projectAdmin.id]);
    for (const { link } of [fromProjectAdmin, fromWsAdmin]) {
      expect((await app.db.projectShareLink.findUniqueOrThrow({ where: { id: link.id } })).uses).toBe(0);
    }
  });

  it('quitar el acceso a quien entró por el enlace lo expulsa en vivo', async () => {
    const { owner, project } = await setup();
    const guest = await registerVerified(app);
    const { link, token } = await createLink(owner, project.id, { role: 'editor', expiresInDays: 1 });
    expect((await accept(guest, token)).statusCode).toBe(200);
    expect((await call(app, owner, 'DELETE', `/v1/projects/${project.id}/share-links/${link.id}`)).statusCode).toBe(204);

    const events = await subscribe([projectChannel(project.id)]);
    try {
      expect((await call(app, owner, 'DELETE', `/v1/projects/${project.id}/members/${guest.id}`)).statusCode).toBe(204);
      expect(await events.waitFor((m) => m.event.type === 'access.changed' && m.event.userId === guest.id)).toBeDefined();
    } finally {
      events.close();
    }
    expect((await call(app, guest, 'GET', `/v1/projects/${project.id}`)).statusCode).toBe(404);
    // Con el enlace revocado no puede volver a entrar.
    expect((await accept(guest, token)).json().error.code).toBe('INVITE_REVOKED');
  });
});

describe('invitar por email al proyecto', () => {
  it('a un miembro del espacio le da acceso directo sin correo', async () => {
    const { owner, ws, project } = await setup();
    const member = await registerVerified(app);
    await addOrgMember(app, ws.id, member, 'member');
    const before = await app.db.projectShareLink.count({ where: { projectId: project.id } });

    const response = await call(app, owner, 'POST', `/v1/projects/${project.id}/invitations`, {
      email: member.email.toUpperCase(),
      role: 'viewer',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ kind: 'direct', member: { userId: member.id, role: 'viewer', origin: 'direct' } });
    expect(await app.db.projectShareLink.count({ where: { projectId: project.id } })).toBe(before);
    expect((await call(app, member, 'GET', `/v1/projects/${project.id}`)).json().role).toBe('viewer');

    const admin = await call(app, owner, 'POST', `/v1/projects/${project.id}/invitations`, { email: member.email, role: 'admin' });
    expect(admin.statusCode).toBe(400);
  });

  it('a alguien de fuera le envía un enlace de un solo uso ligado a su email', async () => {
    const { owner, project } = await setup();
    const invitee = await registerVerified(app);
    const intruder = await registerVerified(app);

    const response = await call(app, owner, 'POST', `/v1/projects/${project.id}/invitations`, {
      email: invitee.email,
      role: 'editor',
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ kind: 'link', link: { role: 'editor', email: invitee.email, maxUses: 1, uses: 0 } });
    expect(body.link).not.toHaveProperty('url');

    const mail = (await waitForMail(app, invitee.email, 2)).at(-1);
    expect(mail!.subject).toContain(project.name);
    const url = /(http\S+\/invitacion#t=[A-Za-z0-9_-]+)/.exec(mail!.text)?.[1];
    expect(url).toBeDefined();
    const token = tokenOf(url!);
    expect(response.body).not.toContain(token);

    expect((await accept(intruder, token)).json().error.code).toBe('INVITE_EMAIL_MISMATCH');
    const accepted = await accept(invitee, token);
    expect(accepted.json()).toEqual({ projectId: project.id, role: 'editor' });
  });
});

describe('rate limit de inspect y accept', () => {
  it('20 por hora y usuario, contando también los fallos', async () => {
    const user = await registerVerified(app);
    const bogus = Buffer.alloc(32, 1).toString('base64url');
    for (let i = 0; i < 10; i++) {
      expect((await inspect(user, bogus)).statusCode).toBe(404);
      expect((await accept(user, bogus)).statusCode).toBe(404);
    }
    const limited = await inspect(user, bogus);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('60 por hora y por IP aunque cambie el usuario', async () => {
    const ip = uniqueIp();
    const users = await Promise.all(Array.from({ length: 4 }, () => registerVerified(app)));
    const bogus = Buffer.alloc(32, 2).toString('base64url');
    for (const user of users.slice(0, 3)) {
      for (let i = 0; i < 20; i++) expect((await call(app, user, 'POST', '/v1/share-links/inspect', { token: bogus }, ip)).statusCode).toBe(404);
    }
    const limited = await call(app, users[3]!, 'POST', '/v1/share-links/inspect', { token: bogus }, ip);
    expect(limited.statusCode).toBe(429);
    // Desde otra IP el cuarto usuario sigue pudiendo.
    expect((await inspect(users[3]!, bogus)).statusCode).toBe(404);
  });
});

describe('logs', () => {
  it('ningún token aparece en los logs', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logged = await buildTestApp({ LOG_LEVEL: 'trace' }, { logger: true, logStream: stream });
    try {
      const owner = await registerVerified(logged);
      const guest = await registerVerified(logged);
      const outsider = await registerVerified(logged);
      const ws = await createWorkspaceFor(logged, owner);
      const project = await createProjectRow(logged, ws.id, owner.id, { orgAccess: 'none' });

      const { token } = await createLink(owner, project.id, { role: 'editor', expiresInDays: 1, maxUses: 1 }, logged);
      expect((await inspect(guest, token, logged)).statusCode).toBe(200);
      expect((await accept(guest, token, logged)).statusCode).toBe(200);
      expect((await accept(outsider, token, logged)).statusCode).toBe(410);

      const invited = await call(logged, owner, 'POST', `/v1/projects/${project.id}/invitations`, {
        email: outsider.email,
        role: 'viewer',
      });
      expect(invited.statusCode).toBe(200);
      const mail = (await waitForMail(logged, outsider.email, 2)).at(-1);
      const emailToken = tokenOf(/(http\S+\/invitacion#t=[A-Za-z0-9_-]+)/.exec(mail!.text)![1]!);
      expect((await accept(outsider, emailToken, logged)).statusCode).toBe(200);

      const output = lines.join('');
      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('/v1/share-links/accept');
      expect(output).not.toContain(token);
      expect(output).not.toContain(emailToken);
    } finally {
      await logged.close();
    }
  });
});

describe('sin sesión', () => {
  it('todas las rutas piden sesión', async () => {
    const projectId = randomUUID();
    for (const [method, url] of [
      ['GET', `/v1/projects/${projectId}/share-links`],
      ['POST', `/v1/projects/${projectId}/share-links`],
      ['DELETE', `/v1/projects/${projectId}/share-links/${randomUUID()}`],
      ['POST', `/v1/projects/${projectId}/invitations`],
      ['POST', '/v1/share-links/inspect'],
      ['POST', '/v1/share-links/accept'],
    ] as const) {
      const body = method === 'POST' ? (url.endsWith('share-links') ? { role: 'viewer', expiresInDays: 1 } : url.endsWith('invitations') ? { email: 'a@example.com', role: 'viewer' } : { token: 'x' }) : undefined;
      const response = await api(app, null, method, url, body);
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
