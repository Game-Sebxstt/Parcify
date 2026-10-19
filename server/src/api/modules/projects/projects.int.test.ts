import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified } from '../../../../test/helpers/auth.js';
import { addOrgMember, addProjectMember, api, createProjectRow, createWorkspaceFor, subscribe } from '../../../../test/helpers/seed.js';
import { createTestStorage, type TestStorage } from '../../../../test/helpers/storage.js';
import { projectChannel } from '../../../core/events.js';
import { ProjectDetailSchema, ProjectListResponseSchema, ProjectSummarySchema } from './schemas.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;
let testStorage: TestStorage;

beforeAll(async () => {
  testStorage = await createTestStorage('local');
  app = await buildTestApp({}, { storage: testStorage.storage });
});

afterAll(async () => {
  await app.close();
  await testStorage.cleanup();
});

describe('crear y leer proyectos', () => {
  it('POST crea el proyecto, registra project.created y da 404 con una plantilla inexistente', async () => {
    const owner = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, member, 'member');

    const created = await api(app, member, 'POST', `/v1/workspaces/${ws.slug}/projects`, { name: '  Plano  ' });
    expect(created.statusCode).toBe(201);
    const project = ProjectSummarySchema.strict().parse(created.json());
    expect(project).toMatchObject({ name: 'Plano', role: 'admin', workspaceSlug: ws.slug, favorite: false, deletedAt: null });
    expect(await app.db.activityEvent.count({ where: { type: 'project.created', projectId: project.id } })).toBe(1);

    const detail = await api(app, owner, 'GET', `/v1/projects/${project.id}`);
    expect(ProjectDetailSchema.strict().safeParse(detail.json()).success).toBe(true);
    expect(detail.json()).toMatchObject({ orgAccess: 'editor', role: 'admin' });

    const template = await api(app, owner, 'POST', `/v1/workspaces/${ws.slug}/projects`, {
      name: 'Con plantilla',
      templateId: randomUUID(),
    });
    expect(template.statusCode).toBe(404);
    expect(template.json().error.code).toBe('NOT_FOUND');

    const outsider = await registerVerified(app);
    expect((await api(app, outsider, 'POST', `/v1/workspaces/${ws.slug}/projects`, { name: 'x' })).statusCode).toBe(404);
    expect((await api(app, owner, 'GET', `/v1/projects/no-es-uuid`)).statusCode).toBe(400);
  });
});

describe('listado', () => {
  it('q, sort, dir, filter y cursor; un member no ve los proyectos con orgAccess none', async () => {
    const owner = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, member, 'member');

    const names = ['Casa', 'Árbol', 'Banco', 'Cocina'];
    const created = [];
    for (const name of names) created.push(await createProjectRow(app, ws.id, owner.id, { name }));
    const hidden = await createProjectRow(app, ws.id, owner.id, { name: 'Oculto', orgAccess: 'none' });
    const direct = await createProjectRow(app, ws.id, owner.id, { name: 'Directo', orgAccess: 'none' });
    await addProjectMember(app, direct.id, member.id, 'viewer');
    const mine = await createProjectRow(app, ws.id, member.id, { name: 'Mío' });
    await createProjectRow(app, ws.id, owner.id, { name: 'Borrado', deletedAt: new Date() });

    const list = async (query: string, user = member) => {
      const response = await api(app, user, 'GET', `/v1/workspaces/${ws.slug}/projects?${query}`);
      expect(response.statusCode, response.body).toBe(200);
      return ProjectListResponseSchema.parse(response.json());
    };

    const all = await list('sort=name&dir=asc&limit=50');
    expect(all.items.map((item) => item.name)).not.toContain('Oculto');
    expect(all.items.map((item) => item.name)).not.toContain('Borrado');
    expect(all.items.map((item) => item.name)).toContain('Directo');
    expect(all.items.find((item) => item.name === 'Casa')?.role).toBe('editor');
    expect(all.items.find((item) => item.name === 'Directo')?.role).toBe('viewer');
    expect((await list('limit=50', owner)).items.map((item) => item.name)).toContain('Oculto');

    const q = await list('q=COC');
    expect(q.items.map((item) => item.name).sort()).toEqual(['Cocina']);

    const pageOne = await list('sort=name&dir=asc&limit=2');
    const pageTwo = await list(`sort=name&dir=asc&limit=2&cursor=${pageOne.nextCursor}`);
    expect(pageOne.items).toHaveLength(2);
    const seen = [...pageOne.items, ...pageTwo.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(4);
    expect(seen.slice(0, 4)).toEqual(all.items.slice(0, 4).map((item) => item.id));

    expect((await list('filter=mine')).items.map((item) => item.id)).toEqual([mine.id]);
    expect((await list('filter=shared&limit=50')).items.map((item) => item.id)).not.toContain(mine.id);

    expect((await api(app, member, 'PUT', `/v1/favorites/project/${created[0]!.id}`)).statusCode).toBe(204);
    expect((await api(app, member, 'PUT', `/v1/favorites/project/${created[0]!.id}`)).statusCode).toBe(204);
    expect(await app.db.favorite.count({ where: { userId: member.id } })).toBe(1);
    const favorites = await list('filter=favorites');
    expect(favorites.items.map((item) => item.id)).toEqual([created[0]!.id]);
    expect(favorites.items[0]!.favorite).toBe(true);

    expect((await list('filter=trash', owner)).items.map((item) => item.name)).toEqual(['Borrado']);
    expect((await list('filter=trash')).items).toEqual([]);

    for (const bad of ['limit=51', 'limit=0', `q=${'x'.repeat(81)}`, 'sort=size', 'filter=otros', 'cursor=abc']) {
      const response = await api(app, member, 'GET', `/v1/workspaces/${ws.slug}/projects?${bad}`);
      expect(response.statusCode, bad).toBe(400);
    }
    expect(hidden.id).toBeTruthy();
  });

  it('GET /projects/shared devuelve los proyectos de otros espacios con acceso directo', async () => {
    const owner = await registerVerified(app);
    const guest = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const shared = await createProjectRow(app, ws.id, owner.id, { name: 'Compartido' });
    await createProjectRow(app, ws.id, owner.id, { name: 'No compartido' });
    await addProjectMember(app, shared.id, guest.id, 'editor');

    const response = await api(app, guest, 'GET', '/v1/projects/shared');
    expect(response.statusCode).toBe(200);
    const body = ProjectListResponseSchema.parse(response.json());
    expect(body.items.map((item) => [item.id, item.role, item.workspaceSlug])).toEqual([[shared.id, 'editor', ws.slug]]);
  });
});

describe('papelera y lotes', () => {
  it('borrar publica project.deleted y elimina los favoritos; batch no es todo o nada', async () => {
    const owner = await registerVerified(app);
    const fan = await registerVerified(app);
    const stranger = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, fan, 'member');
    const a = await createProjectRow(app, ws.id, owner.id);
    const b = await createProjectRow(app, ws.id, owner.id);
    const foreignWs = await createWorkspaceFor(app, stranger);
    const foreign = await createProjectRow(app, foreignWs.id, stranger.id);
    await api(app, fan, 'PUT', `/v1/favorites/project/${a.id}`);
    await api(app, owner, 'PUT', `/v1/favorites/project/${a.id}`);

    const events = await subscribe([projectChannel(a.id)]);
    try {
      const missing = randomUUID();
      const response = await api(app, owner, 'POST', '/v1/projects/batch', { action: 'delete', ids: [a.id, foreign.id, b.id, missing] });
      expect(response.statusCode).toBe(200);
      expect(response.json().results).toEqual({
        [a.id]: { ok: true },
        [b.id]: { ok: true },
        [foreign.id]: { ok: false, code: 'PROJECT_NOT_FOUND' },
        [missing]: { ok: false, code: 'PROJECT_NOT_FOUND' },
      });
      expect(await events.waitFor((m) => m.event.type === 'project.deleted')).toBeDefined();
      expect(await app.db.favorite.count({ where: { targetType: 'project', targetId: a.id } })).toBe(0);
      expect((await app.db.project.findUniqueOrThrow({ where: { id: foreign.id } })).deletedAt).toBeNull();

      const restore = await api(app, fan, 'POST', '/v1/projects/batch', { action: 'restore', ids: [a.id] });
      expect(restore.json().results[a.id]).toEqual({ ok: false, code: 'PROJECT_NOT_FOUND' });
      const restored = await api(app, owner, 'POST', '/v1/projects/batch', { action: 'restore', ids: [a.id, b.id] });
      expect(restored.json().results).toEqual({ [a.id]: { ok: true }, [b.id]: { ok: true } });
      expect((await app.db.project.findUniqueOrThrow({ where: { id: a.id } })).deletedAt).toBeNull();

      const duplicated = await api(app, owner, 'POST', '/v1/projects/batch', { action: 'duplicate', ids: [a.id, foreign.id] });
      const results = duplicated.json().results;
      expect(results[a.id]).toMatchObject({ ok: true, id: expect.any(String) });
      expect(results[foreign.id]).toEqual({ ok: false, code: 'PROJECT_NOT_FOUND' });
      expect(await app.db.project.count({ where: { id: results[a.id].id, organizationId: ws.id } })).toBe(1);

      expect((await api(app, owner, 'POST', '/v1/projects/batch', { action: 'delete', ids: [] })).statusCode).toBe(400);
      const tooMany = Array.from({ length: 51 }, () => randomUUID());
      expect((await api(app, owner, 'POST', '/v1/projects/batch', { action: 'delete', ids: tooMany })).statusCode).toBe(400);
    } finally {
      events.close();
    }
  });

  it('favoritos: 404 sin acceso y quitar es idempotente', async () => {
    const owner = await registerVerified(app);
    const stranger = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const project = await createProjectRow(app, ws.id, owner.id);
    expect((await api(app, stranger, 'PUT', `/v1/favorites/project/${project.id}`)).statusCode).toBe(404);
    expect((await api(app, stranger, 'PUT', `/v1/favorites/template/${randomUUID()}`)).statusCode).toBe(404);
    expect((await api(app, owner, 'DELETE', `/v1/favorites/project/${project.id}`)).statusCode).toBe(204);
    expect((await api(app, owner, 'PUT', `/v1/favorites/otro/${project.id}`)).statusCode).toBe(400);
  });
});

describe('miembros del proyecto', () => {
  it('PUT y DELETE publican access.changed después del commit y registran la actividad', async () => {
    const owner = await registerVerified(app);
    const member = await registerVerified(app);
    const stranger = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, member, 'member');
    const project = await createProjectRow(app, ws.id, owner.id, { orgAccess: 'viewer' });

    const events = await subscribe([projectChannel(project.id)]);
    try {
      const added = await api(app, owner, 'PUT', `/v1/projects/${project.id}/members/${member.id}`, { role: 'editor' });
      expect(added.statusCode).toBe(200);
      expect(added.json()).toMatchObject({ userId: member.id, role: 'editor', origin: 'direct' });
      const event = await events.waitFor((m) => m.event.type === 'access.changed' && m.event.userId === member.id);
      expect(event).toBeDefined();
      expect(await app.db.projectMember.count({ where: { projectId: project.id, userId: member.id } })).toBe(1);
      expect(await app.db.activityEvent.count({ where: { projectId: project.id, type: 'member.added' } })).toBe(1);

      const changed = await api(app, owner, 'PUT', `/v1/projects/${project.id}/members/${member.id}`, { role: 'admin' });
      expect(changed.json().role).toBe('admin');
      expect(await app.db.activityEvent.count({ where: { projectId: project.id, type: 'member.role_changed' } })).toBe(1);

      const members = await api(app, owner, 'GET', `/v1/projects/${project.id}/members`);
      const items = members.json().items as Array<{ userId: string; role: string; origin: string }>;
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: owner.id, role: 'admin', origin: 'workspace' }),
          expect.objectContaining({ userId: member.id, role: 'admin', origin: 'direct' }),
        ]),
      );

      const strangerPut = await api(app, owner, 'PUT', `/v1/projects/${project.id}/members/${stranger.id}`, { role: 'viewer' });
      expect(strangerPut.statusCode).toBe(404);

      events.messages.length = 0;
      const left = await api(app, member, 'DELETE', `/v1/projects/${project.id}/members/${member.id}`);
      expect(left.statusCode).toBe(204);
      expect(await events.waitFor((m) => m.event.type === 'access.changed' && m.event.userId === member.id)).toBeDefined();
      expect((await api(app, member, 'GET', `/v1/projects/${project.id}`)).json().role).toBe('viewer');
    } finally {
      events.close();
    }
  });

  it('nadie da más rol del que tiene', async () => {
    const owner = await registerVerified(app);
    const editor = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, member, 'member');
    const project = await createProjectRow(app, ws.id, owner.id, { orgAccess: 'viewer' });
    await addProjectMember(app, project.id, editor.id, 'editor');

    const response = await api(app, editor, 'PUT', `/v1/projects/${project.id}/members/${member.id}`, { role: 'editor' });
    expect(response.statusCode).toBe(403);
    const kick = await api(app, editor, 'DELETE', `/v1/projects/${project.id}/members/${owner.id}`);
    expect(kick.statusCode).toBe(403);
  });
});
