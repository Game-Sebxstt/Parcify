import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { documentJson, documentState, frameNode, imageNode, nodeId, rectNode, textNode } from '../../../../test/fixtures/document.js';
import { htmlPretendingToBePng, png } from '../../../../test/fixtures/images/index.js';
import { patchDeclaredSize, zip } from '../../../../test/fixtures/zip.js';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { CLIENT_ORIGIN, registerVerified, type TestUser } from '../../../../test/helpers/auth.js';
import { addOrgMember, addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { createTestStorage, driverUnderTest, uploadTo, type TestStorage } from '../../../../test/helpers/storage.js';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { buildManifest, type DocumentJson } from '../../../shared/document/to-json.js';

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

const BOUNDARY = '----parcify-pruebas';

function importArchive(user: TestUser, slug: string, archive: Buffer) {
  const payload = Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="p.parcify"\r\nContent-Type: application/zip\r\n\r\n`,
    ),
    archive,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  return app.inject({
    method: 'POST',
    url: `/v1/workspaces/${slug}/import`,
    headers: { cookie: user.jar.header(), origin: CLIENT_ORIGIN, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload,
  });
}

async function uploadImage(user: TestUser, projectId: string, color: string) {
  const body = await png(40, 30, { color });
  const created = await api(app, user, 'POST', '/v1/assets/uploads', {
    purpose: 'canvas',
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

async function seedDocument(projectId: string, data: DocumentJson, assetRefs: string[] = []) {
  const state = documentState(data);
  await app.db.projectDocument.create({
    data: {
      projectId,
      state,
      schemaVersion: 1,
      epoch: 1,
      sizeBytes: state.byteLength,
      nodeCount: Object.keys(data.nodes).length,
      nodeCountByType: {},
      assetRefs,
    },
  });
}

function manifest(name = 'Importado') {
  return JSON.stringify(buildManifest({ name, schemaVersion: 1 }));
}

async function importedDocument(projectId: string) {
  const row = await app.db.projectDocument.findUniqueOrThrow({ where: { projectId } });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.state);
  return { row, doc };
}

describe('.parcify', () => {
  it('exportar e importar da el mismo número de nodos y assets', async () => {
    const owner = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const project = await createProjectRow(app, ws.id, owner.id, { name: 'Plano "final"' });
    const a = await uploadImage(owner, project.id, '#aa1111');
    const b = await uploadImage(owner, project.id, '#11aa11');
    const data = documentJson([rectNode(), textNode(), frameNode(), imageNode('img1', a), imageNode('img2', b), imageNode('img3', a)], {
      [nodeId('text')]: 'Hola </text><script>alert(1)</script>',
    });
    await seedDocument(project.id, data, [a, b]);

    const exported = await api(app, owner, 'GET', `/v1/projects/${project.id}/export.parcify`);
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers['content-type']).toBe('application/zip');
    expect(exported.headers['content-disposition']).toContain('.parcify');
    const files = unzipSync(new Uint8Array(exported.rawPayload));
    const names = Object.keys(files);
    expect(names.filter((name) => !name.startsWith('assets/')).sort()).toEqual(['document.json', 'manifest.json']);
    expect(names.filter((name) => name.startsWith('assets/')).map((name) => name.slice(7, 43)).sort()).toEqual([a, b].sort());
    const exportedManifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    expect(exportedManifest).toMatchObject({ format: 'parcify', formatVersion: 1, schemaVersion: 1, name: 'Plano "final"' });

    const imported = await importArchive(owner, ws.slug, exported.rawPayload);
    expect(imported.statusCode, imported.body).toBe(201);
    const result = imported.json();
    expect(result).toMatchObject({ droppedNodes: 0, droppedAssets: 0 });
    const copy = await app.db.project.findUniqueOrThrow({ where: { id: result.projectId } });
    expect(copy).toMatchObject({ name: 'Plano "final"', organizationId: ws.id, createdById: owner.id });

    const { row, doc } = await importedDocument(result.projectId);
    expect(row.nodeCount).toBe(6);
    expect(row.assetRefs).toHaveLength(2);
    expect(row.assetRefs).not.toContain(a);
    const assets = await app.db.asset.findMany({ where: { id: { in: row.assetRefs } } });
    expect(assets.map((asset) => asset.source)).toEqual(['import', 'import']);
    expect(assets.every((asset) => asset.projectId === result.projectId)).toBe(true);
    expect((doc.getMap(ROOT_KEYS.texts).get(nodeId('text')) as Y.Text).toString()).toContain('<script>');
  });

  it('un ZIP con ../x, uno con 3.000 entradas y una bomba de descompresión → 400 INVALID_ARCHIVE', async () => {
    const owner = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const document = JSON.stringify(documentJson([rectNode()]));

    const traversal = zip({ 'manifest.json': manifest(), 'document.json': document, '../x': 'fuera' });
    const many: Record<string, string> = { 'manifest.json': manifest(), 'document.json': document };
    for (let i = 0; i < 3_000; i++) many[`assets/${i}.png`] = 'x';
    const bomb = patchDeclaredSize(
      zip({ 'manifest.json': manifest(), 'document.json': new Uint8Array(32 * 1024 * 1024).fill(32) }, 9),
      'document.json',
      2_000,
    );
    for (const [label, archive, reason] of [
      ['traversal', traversal, 'unsafe_path'],
      ['entradas', zip(many, 0), 'too_many_entries'],
      ['bomba', bomb, 'bomb'],
    ] as const) {
      const response = await importArchive(owner, ws.slug, archive);
      expect(response.statusCode, label).toBe(400);
      expect(response.json().error, label).toMatchObject({ code: 'INVALID_ARCHIVE', details: { reason } });
    }
    expect(await app.db.project.count({ where: { organizationId: ws.id } })).toBe(0);
  });

  it('descarta y cuenta los nodos inválidos y los assets que no son imágenes', async () => {
    const owner = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const fake = '01890a5d-ac96-774b-bcce-b302099a8057';
    const data = documentJson([rectNode('ok'), rectNode('mal', { x: 'no' }), { ...rectNode('raro'), type: 'iframe' }, imageNode('img', fake)]);
    const archive = zip({
      'manifest.json': manifest(),
      'document.json': JSON.stringify(data),
      [`assets/${fake}.png`]: htmlPretendingToBePng(),
    });
    const response = await importArchive(owner, ws.slug, archive);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ droppedNodes: 3, droppedAssets: 1 });
    const { row, doc } = await importedDocument(response.json().projectId);
    expect(row.nodeCount).toBe(1);
    expect([...doc.getMap(ROOT_KEYS.nodes).keys()]).toEqual([nodeId('ok')]);
    expect(await app.db.asset.count({ where: { projectId: response.json().projectId } })).toBe(0);
  });

  it('manifest o document.json inválidos → 400 sin crear el proyecto', async () => {
    const owner = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const document = JSON.stringify(documentJson([rectNode()]));
    const cases = [
      ['missing_manifest', zip({ 'document.json': document })],
      ['manifest', zip({ 'manifest.json': '{"format":"otro"}', 'document.json': document })],
      ['schema_too_new', zip({ 'manifest.json': JSON.stringify(buildManifest({ name: 'x', schemaVersion: 99 })), 'document.json': document })],
      ['document', zip({ 'manifest.json': manifest(), 'document.json': '{no es json' })],
      ['not_zip', Buffer.from('esto no es un zip pero tiene bastantes bytes')],
    ] as const;
    for (const [reason, archive] of cases) {
      const response = await importArchive(owner, ws.slug, archive);
      expect(response.statusCode, reason).toBe(400);
      expect(response.json().error, reason).toMatchObject({ code: 'INVALID_ARCHIVE', details: { reason } });
    }
    expect(await app.db.project.count({ where: { organizationId: ws.id } })).toBe(0);
  });

  it('la copia local sin assets incrustados copia solo los que quien importa puede ver', async () => {
    const owner = await registerVerified(app);
    const stranger = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    const other = await createWorkspaceFor(app, stranger, 'Ajeno');
    const mine = await createProjectRow(app, ws.id, owner.id);
    const theirs = await createProjectRow(app, other.id, stranger.id, { orgAccess: 'none' });
    const visible = await uploadImage(owner, mine.id, '#123456');
    const hidden = await uploadImage(stranger, theirs.id, '#654321');
    const data = documentJson([imageNode('a', visible), imageNode('b', hidden), rectNode()]);
    const archive = zip({ 'manifest.json': manifest('Copia local'), 'document.json': JSON.stringify(data) });

    const response = await importArchive(owner, ws.slug, archive);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ droppedNodes: 1, droppedAssets: 1 });
    const { row } = await importedDocument(response.json().projectId);
    expect(row.assetRefs).toHaveLength(1);
    expect(row.assetRefs).not.toContain(visible);
    expect(row.assetRefs).not.toContain(hidden);
  });

  it('autorización: exportar exige ver el proyecto e importar ser miembro del espacio', async () => {
    const owner = await registerVerified(app);
    const viewer = await registerVerified(app);
    const outsider = await registerVerified(app);
    const member = await registerVerified(app);
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, member, 'member');
    const project = await createProjectRow(app, ws.id, owner.id, { orgAccess: 'none' });
    await addProjectMember(app, project.id, viewer.id, 'viewer');

    expect((await api(app, outsider, 'GET', `/v1/projects/${project.id}/export.parcify`)).statusCode).toBe(404);
    expect((await api(app, member, 'GET', `/v1/projects/${project.id}/export.parcify`)).statusCode).toBe(404);
    expect((await api(app, null, 'GET', `/v1/projects/${project.id}/export.parcify`)).statusCode).toBe(401);
    const asViewer = await api(app, viewer, 'GET', `/v1/projects/${project.id}/export.parcify`);
    expect(asViewer.statusCode, asViewer.body).toBe(200);

    expect((await importArchive(outsider, ws.slug, asViewer.rawPayload)).statusCode).toBe(404);
    expect((await importArchive(viewer, ws.slug, asViewer.rawPayload)).statusCode).toBe(404);
    const asMember = await importArchive(member, ws.slug, asViewer.rawPayload);
    expect(asMember.statusCode, asMember.body).toBe(201);
    const membership = await app.db.projectMember.findFirst({ where: { projectId: asMember.json().projectId, userId: member.id } });
    expect(membership?.role).toBe('admin');
    const notMultipart = await api(app, member, 'POST', `/v1/workspaces/${ws.slug}/import`, {});
    expect(notMultipart.statusCode).toBe(400);
  });
});
