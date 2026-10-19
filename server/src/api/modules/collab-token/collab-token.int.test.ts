import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { TEST_SECRET_B } from '../../../../test/helpers/env.js';
import { registerVerified } from '../../../../test/helpers/auth.js';
import { addOrgMember, addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { COLLAB_TOKEN_TTL_SECONDS, verifyCollabToken } from '../../../core/collab-token.js';
import { COLLAB_COLORS } from '../../../shared/collab-colors.js';
import { CollabTokenResponseSchema } from '../../../shared/api/projects.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

async function setup() {
  const owner = await registerVerified(app, { name: 'Ana Dueña' });
  const ws = await createWorkspaceFor(app, owner);
  const project = await createProjectRow(app, ws.id, owner.id, { orgAccess: 'viewer' });
  return { owner, ws, project };
}

describe('POST /projects/:id/collab-token', () => {
  it('devuelve el token con sub, pid, role, sid, ep, iat y exp de 120 s; ep es 1 sin documento', async () => {
    const { owner, project } = await setup();
    const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/collab-token`);
    expect(response.statusCode, response.body).toBe(200);
    const body = CollabTokenResponseSchema.strict().parse(response.json());
    expect(body).toMatchObject({
      url: 'ws://localhost:3001',
      documentName: `project:${project.id}`,
      role: 'admin',
      epoch: 1,
      user: { id: owner.id, name: 'Ana Dueña' },
    });
    expect(COLLAB_COLORS).toContain(body.user.color);

    const claims = await verifyCollabToken(TEST_SECRET_B, body.token);
    const session = await app.db.session.findFirstOrThrow({ where: { userId: owner.id } });
    expect(claims).toMatchObject({ sub: owner.id, pid: project.id, role: 'admin', sid: session.id, ep: 1 });
    expect(claims.exp - claims.iat).toBe(COLLAB_TOKEN_TTL_SECONDS);
    expect(Math.abs(claims.iat - Date.now() / 1000)).toBeLessThan(10);
  });

  it('ep refleja el epoch del documento', async () => {
    const { owner, project } = await setup();
    await app.db.projectDocument.create({
      data: {
        projectId: project.id,
        state: new Uint8Array([0, 0]),
        schemaVersion: 1,
        epoch: 3,
        sizeBytes: 2,
        nodeCount: 0,
        nodeCountByType: {},
        assetRefs: [],
      },
    });
    const body = (await api(app, owner, 'POST', `/v1/projects/${project.id}/collab-token`)).json();
    expect(body.epoch).toBe(3);
    expect((await verifyCollabToken(TEST_SECRET_B, body.token)).ep).toBe(3);
  });

  it('el color es estable entre llamadas y distinto para dos usuarios', async () => {
    const { owner, ws, project } = await setup();
    const member = await registerVerified(app);
    await addOrgMember(app, ws.id, member, 'member');

    const first = (await api(app, owner, 'POST', `/v1/projects/${project.id}/collab-token`)).json();
    const again = (await api(app, owner, 'POST', `/v1/projects/${project.id}/collab-token`)).json();
    const other = (await api(app, member, 'POST', `/v1/projects/${project.id}/collab-token`)).json();
    expect(again.user.color).toBe(first.user.color);
    expect(other.user.color).not.toBe(first.user.color);
    expect(other.role).toBe('viewer');
    expect(await app.db.projectColor.count({ where: { projectId: project.id } })).toBe(2);
  });

  it('404 sin acceso y 401 con la sesión revocada', async () => {
    const { owner, project } = await setup();
    const stranger = await registerVerified(app);
    const denied = await api(app, stranger, 'POST', `/v1/projects/${project.id}/collab-token`);
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe('PROJECT_NOT_FOUND');

    const guest = await registerVerified(app);
    await addProjectMember(app, project.id, guest.id, 'editor');
    expect((await api(app, guest, 'POST', `/v1/projects/${project.id}/collab-token`)).json().role).toBe('editor');

    await app.auth.api.revokeSessions({ headers: new Headers({ cookie: owner.jar.header() }) });
    const revoked = await api(app, owner, 'POST', `/v1/projects/${project.id}/collab-token`);
    expect(revoked.statusCode).toBe(401);
    expect(await app.db.projectColor.count({ where: { projectId: project.id, userId: owner.id } })).toBe(0);
  });

  it('límite de 30 por minuto y usuario', async () => {
    const { owner, project } = await setup();
    for (let i = 0; i < 30; i++) {
      const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/collab-token`);
      expect(response.statusCode, `petición ${i + 1}`).toBe(200);
    }
    const limited = await api(app, owner, 'POST', `/v1/projects/${project.id}/collab-token`);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');

    const other = await registerVerified(app);
    await addProjectMember(app, project.id, other.id, 'viewer');
    expect((await api(app, other, 'POST', `/v1/projects/${project.id}/collab-token`)).statusCode).toBe(200);
  });
});
