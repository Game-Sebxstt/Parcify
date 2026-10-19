import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { png } from '../../../../test/fixtures/images/index.js';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified, type TestUser } from '../../../../test/helpers/auth.js';
import { addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { createTestStorage, driverUnderTest, transfer, uploadTo, type TestStorage } from '../../../../test/helpers/storage.js';
import { collectAssetRefs } from '../../../core/document/remap-assets.js';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { copyName } from './duplicate.js';

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

function documentWithImages(assetIds: string[]): Uint8Array<ArrayBuffer> {
  const doc = new Y.Doc();
  doc.transact(() => {
    assetIds.forEach((assetId, index) => {
      const node = new Y.Map<unknown>();
      doc.getMap(ROOT_KEYS.nodes).set(`img${index}`, node);
      node.set('type', 'image');
      node.set('assetId', assetId);
      node.set('x', index * 10);
    });
    const rect = new Y.Map<unknown>();
    doc.getMap(ROOT_KEYS.nodes).set('rect', rect);
    rect.set('type', 'rect');
  });
  return new Uint8Array(Y.encodeStateAsUpdate(doc));
}

describe('duplicar proyectos', () => {
  it('copia el documento y los assets con ids nuevos; borrar el original no rompe el duplicado', async () => {
    const owner = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const project = await createProjectRow(app, ws.id, owner.id, { name: 'Plano de la casa' });
    const a = await uploadImage(owner, project.id, '#aa1111');
    const b = await uploadImage(owner, project.id, '#11aa11');
    const preview = await uploadImage(owner, project.id, '#1111aa', 'preview');
    await app.db.project.update({ where: { id: project.id }, data: { previewAssetId: preview } });
    const state = documentWithImages([a, b, a]);
    await app.db.projectDocument.create({
      data: {
        projectId: project.id,
        state,
        schemaVersion: 1,
        epoch: 4,
        sizeBytes: state.byteLength,
        nodeCount: 4,
        nodeCountByType: { image: 3, rect: 1 },
        assetRefs: [a, b],
      },
    });

    const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/duplicate`, {});
    expect(response.statusCode, response.body).toBe(201);
    const copy = response.json();
    expect(copy).toMatchObject({ name: 'Plano de la casa (copia)', role: 'admin', workspaceSlug: ws.slug });
    expect(copy.id).not.toBe(project.id);
    expect(await app.db.activityEvent.count({ where: { projectId: copy.id, type: 'project.duplicated' } })).toBe(1);

    const document = await app.db.projectDocument.findUniqueOrThrow({ where: { projectId: copy.id } });
    expect(document).toMatchObject({ epoch: 1, schemaVersion: 1, nodeCount: 4 });
    expect(document.assetRefs).toHaveLength(2);
    expect(document.assetRefs).not.toContain(a);
    expect(document.assetRefs).not.toContain(b);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, document.state);
    expect(collectAssetRefs(doc).sort()).toEqual([...document.assetRefs].sort());
    const nodes = doc.getMap(ROOT_KEYS.nodes);
    expect((nodes.get('img0') as Y.Map<unknown>).get('assetId')).toBe((nodes.get('img2') as Y.Map<unknown>).get('assetId'));

    const copies = await app.db.asset.findMany({ where: { id: { in: document.assetRefs } } });
    expect(copies).toHaveLength(2);
    for (const asset of copies) {
      expect(asset).toMatchObject({ projectId: copy.id, organizationId: ws.id, ownerId: owner.id, status: 'ready' });
      expect(asset.storageKey).toContain(asset.id);
    }
    const copiedProject = await app.db.project.findUniqueOrThrow({ where: { id: copy.id } });
    expect(copiedProject.previewAssetId).not.toBeNull();
    expect(copiedProject.previewAssetId).not.toBe(preview);

    // Purga simulada del original: proyecto, filas y objetos.
    const originals = await app.db.asset.findMany({ where: { projectId: project.id } });
    const originalKeys = originals.flatMap((asset) => [
      asset.storageKey,
      ...Object.values(asset.variants as Record<string, { key: string }>).map((variant) => variant.key),
    ]);
    await testStorage.storage.delete(originalKeys);
    await app.db.project.delete({ where: { id: project.id } });

    const resolved = await api(app, owner, 'POST', '/v1/assets/resolve', { ids: document.assetRefs, variant: 'full' });
    const urls = resolved.json().assets as Record<string, { url: string }>;
    expect(Object.keys(urls).sort()).toEqual([...document.assetRefs].sort());
    for (const { url } of Object.values(urls)) expect((await transfer(app, url)).status).toBe(200);
  });

  it('el invitado externo duplica en su espacio personal; el destino exige ser miembro', async () => {
    const owner = await registerVerified(app);
    const guest = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const project = await createProjectRow(app, ws.id, owner.id);
    await addProjectMember(app, project.id, guest.id, 'viewer');

    const response = await api(app, guest, 'POST', `/v1/projects/${project.id}/duplicate`, {});
    expect(response.statusCode, response.body).toBe(201);
    const personal = await app.db.organization.findFirstOrThrow({
      where: { personal: true, members: { some: { userId: guest.id } } },
    });
    expect(response.json()).toMatchObject({ workspaceSlug: personal.slug, role: 'admin', createdById: guest.id });

    const into = await api(app, guest, 'POST', `/v1/projects/${project.id}/duplicate`, { targetWorkspaceSlug: ws.slug });
    expect(into.statusCode).toBe(404);
  });

  it('acorta el nombre para que quepa el sufijo', () => {
    expect(copyName('x'.repeat(80))).toHaveLength(80);
    expect(copyName('x'.repeat(80)).endsWith(' (copia)')).toBe(true);
  });
});
