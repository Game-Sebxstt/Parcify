import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { png } from '../../../../test/fixtures/images/index.js';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified, type TestUser } from '../../../../test/helpers/auth.js';
import { addOrgMember, addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { createTestStorage, driverUnderTest, transfer, uploadTo, type TestStorage } from '../../../../test/helpers/storage.js';
import { collectAssetRefs } from '../../../core/document/remap-assets.js';
import { objectKeysOf, purgeTrashedProjects } from '../../../core/jobs/purge.js';
import { ROOT_KEYS } from '../../../shared/document/keys.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;
let testStorage: TestStorage;

beforeAll(async () => {
  testStorage = await createTestStorage(driverUnderTest());
  app = await buildTestApp({}, { storage: testStorage.storage });
});

afterAll(async () => {
  await app.close();
  await testStorage.cleanup();
});

async function uploadImage(user: TestUser, projectId: string, color: string, purpose: 'canvas' | 'preview' = 'canvas') {
  const body = await png(40, 30, { color });
  const created = await api(app, user, 'POST', '/v1/assets/uploads', {
    purpose,
    projectId,
    fileName: 'foto.png',
    contentType: 'image/png',
    size: body.length,
  });
  await uploadTo(app, created.json().upload, body);
  const complete = await api(app, user, 'POST', `/v1/assets/uploads/${created.json().assetId}/complete`);
  expect(complete.statusCode, complete.body).toBe(200);
  return complete.json().id as string;
}

async function storeDocument(projectId: string, assetIds: string[]) {
  const doc = new Y.Doc();
  doc.transact(() => {
    assetIds.forEach((assetId, index) => {
      const node = new Y.Map<unknown>();
      doc.getMap(ROOT_KEYS.nodes).set(`img${index}`, node);
      node.set('type', 'image');
      node.set('assetId', assetId);
    });
    const rect = new Y.Map<unknown>();
    doc.getMap(ROOT_KEYS.nodes).set('rect', rect);
    rect.set('type', 'rect');
  });
  const state = new Uint8Array(Y.encodeStateAsUpdate(doc));
  await app.db.projectDocument.create({
    data: {
      projectId,
      state,
      schemaVersion: 1,
      sizeBytes: state.byteLength,
      nodeCount: assetIds.length + 1,
      nodeCountByType: { image: assetIds.length, rect: 1 },
      assetRefs: [...new Set(assetIds)],
    },
  });
}

function refsOf(state: Uint8Array): string[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return collectAssetRefs(doc).sort();
}

async function objectKeys(where: { templateId?: string; projectId?: string }) {
  const assets = await app.db.asset.findMany({ where, select: { storageKey: true, variants: true } });
  return assets.flatMap(objectKeysOf);
}

async function seedProjectWithImages(owner: TestUser, organizationId: string) {
  const project = await createProjectRow(app, organizationId, owner.id, { name: 'Plano base' });
  const a = await uploadImage(owner, project.id, '#aa1111');
  const b = await uploadImage(owner, project.id, '#11aa11');
  const preview = await uploadImage(owner, project.id, '#1111aa', 'preview');
  await app.db.project.update({ where: { id: project.id }, data: { previewAssetId: preview } });
  await storeDocument(project.id, [a, b, a]);
  return { project, a, b, preview };
}

describe('plantillas del espacio', () => {
  it('la plantilla y los proyectos creados desde ella sobreviven a la purga del origen y al borrado de la plantilla', async () => {
    const owner = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, member, 'member');
    const { project, a, b, preview } = await seedProjectWithImages(owner, ws.id);

    const published = await api(app, owner, 'POST', `/v1/projects/${project.id}/template`, {
      name: 'Plano tipo',
      description: 'Base para casas\nde una planta',
    });
    expect(published.statusCode, published.body).toBe(201);
    const summary = published.json();
    expect(summary).toMatchObject({ name: 'Plano tipo', scope: 'workspace', likesCount: 0, liked: false, favorite: false });

    const template = await app.db.template.findUniqueOrThrow({ where: { id: summary.id } });
    expect(template.organizationId).toBe(ws.id);
    expect(template.schemaVersion).toBe(1);
    expect(template.assetRefs).toHaveLength(2);
    expect(template.assetRefs).not.toContain(a);
    expect(template.assetRefs).not.toContain(b);
    expect(refsOf(template.state)).toEqual([...template.assetRefs].sort());
    expect(template.previewAssetId).not.toBeNull();
    expect(template.previewAssetId).not.toBe(preview);
    expect(summary.previewAssetId).toBe(template.previewAssetId);

    const own = await app.db.asset.findMany({ where: { templateId: template.id } });
    expect(own).toHaveLength(3);
    for (const asset of own) {
      expect(asset).toMatchObject({ source: 'template', projectId: null, organizationId: ws.id, status: 'ready' });
      expect(asset.storageKey).toContain(asset.id);
    }

    // Purga del proyecto de origen con el trabajo diario.
    await app.db.project.update({ where: { id: project.id }, data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) } });
    await purgeTrashedProjects({ db: app.db, storage: testStorage.storage, logger: app.log });
    expect(await app.db.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await app.db.asset.count({ where: { id: { in: [a, b, preview] } } })).toBe(0);
    for (const key of await objectKeys({ templateId: template.id })) expect(await testStorage.storage.head(key)).not.toBeNull();

    // Un member del espacio crea un proyecto desde la plantilla.
    const created = await api(app, member, 'POST', `/v1/workspaces/${ws.slug}/projects`, {
      name: 'Casa de Ana',
      templateId: template.id,
    });
    expect(created.statusCode, created.body).toBe(201);
    const fromTemplate = created.json();
    expect(fromTemplate).toMatchObject({ name: 'Casa de Ana', role: 'admin', createdById: member.id });
    const row = await app.db.project.findUniqueOrThrow({ where: { id: fromTemplate.id } });
    expect(row.templateId).toBe(template.id);

    const document = await app.db.projectDocument.findUniqueOrThrow({ where: { projectId: fromTemplate.id } });
    expect(document).toMatchObject({ epoch: 1, schemaVersion: 1, nodeCount: 4 });
    expect(document.assetRefs).toHaveLength(2);
    for (const id of document.assetRefs) expect(template.assetRefs).not.toContain(id);
    expect(refsOf(document.state)).toEqual([...document.assetRefs].sort());

    const copies = await app.db.asset.findMany({ where: { projectId: fromTemplate.id } });
    expect(copies).toHaveLength(3);
    for (const asset of copies) {
      expect(asset.templateId).toBeNull();
      expect(asset.source).toBe(asset.id === row.previewAssetId ? 'preview' : 'upload');
    }
    expect(row.previewAssetId).not.toBeNull();
    expect(fromTemplate.previewAssetId).toBe(row.previewAssetId);

    // Borrar la plantilla borra antes sus objetos; el proyecto creado sigue con sus imágenes.
    const deleted = await api(app, owner, 'DELETE', `/v1/templates/${template.id}`);
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect(await app.db.template.findUnique({ where: { id: template.id } })).toBeNull();
    expect(await app.db.asset.count({ where: { templateId: template.id } })).toBe(0);
    for (const asset of own) {
      for (const key of objectKeysOf(asset)) expect(await testStorage.storage.head(key)).toBeNull();
    }

    const resolved = await api(app, member, 'POST', '/v1/assets/resolve', { ids: document.assetRefs, variant: 'full' });
    const urls = resolved.json().assets as Record<string, { url: string }>;
    expect(Object.keys(urls).sort()).toEqual([...document.assetRefs].sort());
    for (const { url } of Object.values(urls)) expect((await transfer(app, url)).status).toBe(200);
  });

  it('solo el admin del proyecto que es miembro del espacio publica; borrar exige admin del espacio', async () => {
    const owner = await registerVerified(app);
    const admin = await registerVerified(app);
    const member = await registerVerified(app);
    const projectAdmin = await registerVerified(app);
    const guest = await registerVerified(app);
    const stranger = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, admin, 'admin');
    await addOrgMember(app, ws.id, member, 'member');
    await addOrgMember(app, ws.id, projectAdmin, 'member');
    const project = await createProjectRow(app, ws.id, owner.id, { orgAccess: 'editor' });
    await addProjectMember(app, project.id, projectAdmin.id, 'admin');
    await addProjectMember(app, project.id, guest.id, 'admin');

    const publish = (user: TestUser) => api(app, user, 'POST', `/v1/projects/${project.id}/template`, { name: 'Plantilla' });
    expect((await publish(member)).statusCode).toBe(403);
    expect((await publish(guest)).statusCode).toBe(403);
    expect((await publish(stranger)).statusCode).toBe(404);
    const byProjectAdmin = await publish(projectAdmin);
    expect(byProjectAdmin.statusCode, byProjectAdmin.body).toBe(201);
    const templateId = byProjectAdmin.json().id as string;

    expect((await api(app, guest, 'GET', `/v1/workspaces/${ws.slug}/templates`)).statusCode).toBe(404);
    expect((await api(app, member, 'DELETE', `/v1/templates/${templateId}`)).statusCode).toBe(403);
    expect((await api(app, projectAdmin, 'DELETE', `/v1/templates/${templateId}`)).statusCode).toBe(403);
    expect((await api(app, stranger, 'DELETE', `/v1/templates/${templateId}`)).statusCode).toBe(404);
    expect((await api(app, guest, 'PUT', `/v1/templates/${templateId}/like`)).statusCode).toBe(404);
    expect((await api(app, guest, 'PUT', `/v1/favorites/template/${templateId}`)).statusCode).toBe(404);
    expect((await api(app, admin, 'DELETE', `/v1/templates/${templateId}`)).statusCode).toBe(204);
    expect((await api(app, admin, 'DELETE', `/v1/templates/${templateId}`)).statusCode).toBe(404);
  });

  it('las plantillas no se ven ni se usan desde otro espacio', async () => {
    const owner = await registerVerified(app);
    const other = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const otherWs = await createWorkspaceFor(app, other);
    await addOrgMember(app, otherWs.id, owner, 'member');
    const project = await createProjectRow(app, ws.id, owner.id);
    const published = await api(app, owner, 'POST', `/v1/projects/${project.id}/template`, { name: 'Solo de aquí' });
    expect(published.statusCode, published.body).toBe(201);
    const templateId = published.json().id as string;

    // Otros archivos de la suite pueden sembrar plantillas de Parcify en la misma base.
    const ofWorkspace = (body: { items: Array<{ id: string; scope: string }> }) =>
      body.items.filter((item) => item.scope === 'workspace').map((item) => item.id);
    const mine = await api(app, owner, 'GET', `/v1/workspaces/${ws.slug}/templates`);
    expect(ofWorkspace(mine.json())).toEqual([templateId]);
    const theirs = await api(app, owner, 'GET', `/v1/workspaces/${otherWs.slug}/templates`);
    expect(theirs.statusCode).toBe(200);
    expect(ofWorkspace(theirs.json())).toEqual([]);

    // Ni el miembro de los dos espacios puede crear en otro espacio desde ella.
    const cross = await api(app, owner, 'POST', `/v1/workspaces/${otherWs.slug}/projects`, { name: 'Copia', templateId });
    expect(cross.statusCode).toBe(404);
    const byOther = await api(app, other, 'POST', `/v1/workspaces/${otherWs.slug}/projects`, { name: 'Copia', templateId });
    expect(byOther.statusCode).toBe(404);
    expect(await app.db.project.count({ where: { organizationId: otherWs.id } })).toBe(0);
    expect((await api(app, other, 'PUT', `/v1/templates/${templateId}/like`)).statusCode).toBe(404);
  });

  it('el like es único por usuario y el contador coincide con las filas', async () => {
    const owner = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, member, 'member');
    const project = await createProjectRow(app, ws.id, owner.id);
    const templateId = (await api(app, owner, 'POST', `/v1/projects/${project.id}/template`, { name: 'Con likes' })).json()
      .id as string;

    const like = (user: TestUser, method: 'PUT' | 'DELETE') => api(app, user, method, `/v1/templates/${templateId}/like`);
    expect((await like(owner, 'PUT')).json()).toEqual({ liked: true, likesCount: 1 });
    expect((await like(owner, 'PUT')).json()).toEqual({ liked: true, likesCount: 1 });
    const concurrent = await Promise.all([like(member, 'PUT'), like(member, 'PUT')]);
    expect(concurrent.map((response) => response.statusCode)).toEqual([200, 200]);
    expect((await like(member, 'DELETE')).json()).toEqual({ liked: false, likesCount: 1 });
    expect((await like(member, 'DELETE')).json()).toEqual({ liked: false, likesCount: 1 });
    const row = await app.db.template.findUniqueOrThrow({ where: { id: templateId } });
    expect(row.likesCount).toBe(await app.db.templateLike.count({ where: { templateId } }));

    expect((await api(app, member, 'PUT', `/v1/favorites/template/${templateId}`)).statusCode).toBe(204);
    const favorites = await api(app, member, 'GET', `/v1/workspaces/${ws.slug}/templates?filter=favorites`);
    expect(favorites.json().items).toMatchObject([{ id: templateId, favorite: true, liked: false, likesCount: 1 }]);
    expect((await api(app, owner, 'DELETE', `/v1/templates/${templateId}`)).statusCode).toBe(204);
    expect(await app.db.favorite.count({ where: { targetType: 'template', targetId: templateId } })).toBe(0);
  });

  it('un fallo de copia al publicar responde 502 y no deja plantilla ni objetos', async () => {
    const owner = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const { project } = await seedProjectWithImages(owner, ws.id);
    const storage = testStorage.storage;
    const original = storage.put.bind(storage);
    const written: string[] = [];
    let calls = 0;
    const spy = vi.spyOn(storage, 'put').mockImplementation(async (key, body, opts) => {
      calls++;
      if (calls === 5) throw new Error('disco lleno');
      written.push(key);
      return original(key, body, opts);
    });
    try {
      const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/template`, { name: 'Rota' });
      expect(response.statusCode, response.body).toBe(502);
      expect(response.json().error.code).toBe('STORAGE_ERROR');
    } finally {
      spy.mockRestore();
    }
    expect(written.length).toBeGreaterThan(0);
    for (const key of written) expect(await storage.head(key)).toBeNull();
    expect(await app.db.template.count({ where: { organizationId: ws.id } })).toBe(0);
    expect(await app.db.asset.count({ where: { source: 'template', organizationId: ws.id } })).toBe(0);
  });
});
