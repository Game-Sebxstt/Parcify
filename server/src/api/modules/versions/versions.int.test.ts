import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified, type TestUser } from '../../../../test/helpers/auth.js';
import {
  addNode,
  connect,
  firstPageId,
  nodesOf,
  rectProps,
  startCollab,
  waitFor,
  type TestClient,
  type TestCollab,
} from '../../../../test/helpers/collab.js';
import { addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { utcDay } from '../../../core/activity.js';
import { documentNameFor, ROOT_KEYS } from '../../../shared/document/keys.js';
import { RestoreVersionResponseSchema, VersionListResponseSchema, VersionSchema } from './schemas.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;
let a: TestCollab;
let b: TestCollab;
let collabStopped = false;
const clients: TestClient[] = [];

beforeAll(async () => {
  [app, a, b] = await Promise.all([
    buildTestApp(),
    startCollab({ instanceId: 'collab-versions-a' }),
    startCollab({ instanceId: 'collab-versions-b' }),
  ]);
});

afterAll(async () => {
  for (const client of clients) client.destroy();
  await Promise.all([app.close(), ...(collabStopped ? [] : [a.stop(), b.stop()])]);
});

async function setup() {
  const owner = await registerVerified(app, { name: 'Ana' });
  const ws = await createWorkspaceFor(app, owner);
  const project = await createProjectRow(app, ws.id, owner.id, { orgAccess: 'none' });
  return { owner, project };
}

async function open(collab: TestCollab, user: TestUser, projectId: string): Promise<TestClient> {
  const client = connect(collab.url, projectId, async () => {
    const response = await api(app, user, 'POST', `/v1/projects/${projectId}/collab-token`);
    return response.json().token as string;
  });
  clients.push(client);
  await client.synced();
  return client;
}

function setText(doc: Y.Doc, id: string, value: string) {
  doc.transact(() => {
    const texts = doc.getMap<Y.Text>(ROOT_KEYS.texts);
    let text = texts.get(id);
    if (!text) {
      text = new Y.Text();
      texts.set(id, text);
    }
    text.delete(0, text.length);
    text.insert(0, value);
  });
}

const textOf = (doc: Y.Doc | undefined, id: string) => doc?.getMap<Y.Text>(ROOT_KEYS.texts).get(id)?.toString();

function versionsOf(projectId: string, kind: 'manual' | 'restore_point' | 'auto') {
  return app.db.projectVersion.findMany({ where: { projectId, kind } });
}

async function storedWith(projectId: string, check: (doc: Y.Doc) => boolean) {
  return waitFor(async () => {
    const row = await app.db.projectDocument.findUnique({ where: { projectId } });
    if (!row) return null;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.state);
    return check(doc) ? row : null;
  }, 'estado guardado');
}

describe('versiones del proyecto', () => {
  it('con el documento en dos instancias, crear una versión produce una sola ProjectVersion con el estado vivo', async () => {
    const { owner, project } = await setup();
    const onA = await open(a, owner, project.id);
    const onB = await open(b, owner, project.id);
    const rect = addNode(onA.doc, rectProps(firstPageId(onA.doc), owner.id));
    await waitFor(() => nodesOf(a.document(project.id))[rect] && nodesOf(b.document(project.id))[rect], 'nodo en las dos instancias');

    const created = await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: 'Primera' });
    expect(created.statusCode, created.body).toBe(201);
    const version = VersionSchema.strict().parse(created.json());
    expect(version).toMatchObject({ kind: 'manual', name: 'Primera', createdBy: { id: owner.id, name: 'Ana' }, nodeCount: 1 });

    // Las dos instancias reciben la petición: un tiempo de margen para que una segunda copia apareciera.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const manual = await versionsOf(project.id, 'manual');
    expect(manual).toHaveLength(1);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, manual[0]!.state);
    expect(Object.keys(nodesOf(copy))).toEqual([rect]);

    const daily = await app.db.activityDaily.findUniqueOrThrow({
      where: { projectId_userId_day: { projectId: project.id, userId: owner.id, day: new Date(`${utcDay(new Date())}T00:00:00Z`) } },
    });
    expect(daily.versionsCreated).toBe(1);
    expect(await app.db.activityEvent.count({ where: { projectId: project.id, type: 'version.created' } })).toBe(1);

    const list = VersionListResponseSchema.parse((await api(app, owner, 'GET', `/v1/projects/${project.id}/versions?limit=50`)).json());
    expect(list.items.find((item) => item.id === version.id)).toEqual(version);
    const state = await api(app, owner, 'GET', `/v1/projects/${project.id}/versions/${version.id}/state`);
    expect(state.statusCode).toBe(200);
    expect(state.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.compare(state.rawPayload, Buffer.from(manual[0]!.state))).toBe(0);
    onA.destroy();
    onB.destroy();
  });

  it('restaurar con dos instancias deja el texto sin duplicar, un solo restore_point y llega a los clientes', async () => {
    const { owner, project } = await setup();
    const onA = await open(a, owner, project.id);
    const onB = await open(b, owner, project.id);
    const pageId = firstPageId(onA.doc);
    const rect = addNode(onA.doc, rectProps(pageId, owner.id));
    setText(onA.doc, rect, 'Hola');
    await waitFor(() => textOf(b.document(project.id), rect) === 'Hola', 'texto en B');

    const version = (await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: 'Antes' })).json();
    setText(onA.doc, rect, 'Hola mundo');
    const extra = addNode(onB.doc, rectProps(pageId, owner.id, { x: 400 }));
    await waitFor(() => textOf(a.document(project.id), rect) === 'Hola mundo' && nodesOf(a.document(project.id))[extra], 'cambios en A');
    await waitFor(() => textOf(b.document(project.id), rect) === 'Hola mundo', 'cambios en B');

    const restored = await api(app, owner, 'POST', `/v1/projects/${project.id}/versions/${version.id}/restore`);
    expect(restored.statusCode, restored.body).toBe(200);
    const { restorePointId } = RestoreVersionResponseSchema.parse(restored.json());

    for (const client of [onA, onB]) {
      await waitFor(() => textOf(client.doc, rect) === 'Hola' && !nodesOf(client.doc)[extra], 'restauración en el cliente');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const doc of [onA.doc, onB.doc, a.document(project.id), b.document(project.id)]) {
      expect(textOf(doc, rect)).toBe('Hola');
      expect(Object.keys(nodesOf(doc))).toEqual([rect]);
    }
    const points = await versionsOf(project.id, 'restore_point');
    expect(points.map((point) => point.id)).toEqual([restorePointId]);
    const before = new Y.Doc();
    Y.applyUpdate(before, points[0]!.state);
    expect(textOf(before, rect)).toBe('Hola mundo');
    expect(await app.db.activityEvent.count({ where: { projectId: project.id, type: 'version.restored' } })).toBe(1);
    await storedWith(project.id, (doc) => textOf(doc, rect) === 'Hola' && !nodesOf(doc)[extra]);
    onA.destroy();
    onB.destroy();
  });

  it('sin ninguna instancia con el documento, la API copia ProjectDocument.state', async () => {
    const { owner, project } = await setup();
    const client = await open(a, owner, project.id);
    const rect = addNode(client.doc, rectProps(firstPageId(client.doc), owner.id));
    await storedWith(project.id, (doc) => Boolean(nodesOf(doc)[rect]));
    client.destroy();
    await waitFor(() => !a.document(project.id) && !b.document(project.id), 'documento descargado', 8_000);
    const stored = await app.db.projectDocument.findUniqueOrThrow({ where: { projectId: project.id } });

    const created = await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, {});
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ kind: 'manual', name: null, nodeCount: 1 });
    const manual = await versionsOf(project.id, 'manual');
    expect(manual).toHaveLength(1);
    expect(Buffer.compare(Buffer.from(manual[0]!.state), Buffer.from(stored.state))).toBe(0);
    expect(a.runtime.docs.has(documentNameFor(project.id))).toBe(false);
  });

  it('dos restauraciones a la vez: una de ellas recibe 409 RESTORE_IN_PROGRESS', async () => {
    const { owner, project } = await setup();
    const onA = await open(a, owner, project.id);
    await open(b, owner, project.id);
    const pageId = firstPageId(onA.doc);
    for (let i = 0; i < 200; i++) addNode(onA.doc, rectProps(pageId, owner.id, { x: i * 10 }));
    await waitFor(() => Object.keys(nodesOf(b.document(project.id))).length === 200, 'nodos en B');
    const version = (await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: 'Base' })).json();
    addNode(onA.doc, rectProps(pageId, owner.id, { x: 5_000 }));

    const responses = await Promise.all([
      api(app, owner, 'POST', `/v1/projects/${project.id}/versions/${version.id}/restore`),
      api(app, owner, 'POST', `/v1/projects/${project.id}/versions/${version.id}/restore`),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([200, 409]);
    expect(responses.find((response) => response.statusCode === 409)!.json().error.code).toBe('RESTORE_IN_PROGRESS');
    expect(await versionsOf(project.id, 'restore_point')).toHaveLength(1);
  });

  it('permisos, versión ajena y paginación', async () => {
    const { owner, project } = await setup();
    const viewer = await registerVerified(app, { name: 'Lectora' });
    const stranger = await registerVerified(app);
    await addProjectMember(app, project.id, viewer.id, 'viewer');
    const first = (await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: 'Uno' })).json();
    await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: 'Dos' });

    expect((await api(app, viewer, 'POST', `/v1/projects/${project.id}/versions`, {})).statusCode).toBe(403);
    expect((await api(app, viewer, 'POST', `/v1/projects/${project.id}/versions/${first.id}/restore`)).statusCode).toBe(403);
    expect((await api(app, stranger, 'GET', `/v1/projects/${project.id}/versions`)).statusCode).toBe(404);
    expect((await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: ' ' })).statusCode).toBe(400);

    const other = await setup();
    const foreign = await api(app, owner, 'POST', `/v1/projects/${project.id}/versions/${(await api(app, other.owner, 'POST', `/v1/projects/${other.project.id}/versions`, {})).json().id}/restore`);
    expect(foreign.statusCode).toBe(404);

    const page = VersionListResponseSchema.parse((await api(app, viewer, 'GET', `/v1/projects/${project.id}/versions?limit=1`)).json());
    expect(page.items.map((item) => item.name)).toEqual(['Dos']);
    const next = VersionListResponseSchema.parse(
      (await api(app, viewer, 'GET', `/v1/projects/${project.id}/versions?limit=1&cursor=${page.nextCursor}`)).json(),
    );
    expect(next.items.map((item) => item.name)).toEqual(['Uno']);
    expect(next.nextCursor).toBeNull();
  });

  it('con el documento en dos instancias, los guardados de las dos producen una sola versión automática', async () => {
    const { owner, project } = await setup();
    const onA = await open(a, owner, project.id);
    const onB = await open(b, owner, project.id);
    const pageId = firstPageId(onA.doc);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(addNode((i % 2 ? onB : onA).doc, rectProps(pageId, owner.id, { x: i * 50 })));
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await storedWith(project.id, (doc) => ids.every((id) => nodesOf(doc)[id]));
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const auto = await versionsOf(project.id, 'auto');
    expect(auto).toHaveLength(1);
    expect(auto[0]!.createdById).toBeNull();
    onA.destroy();
    onB.destroy();
  });

  it('poda: se conservan las 48 automáticas y las 200 manuales más recientes', async () => {
    const { owner, project } = await setup();
    const empty = new Uint8Array(Y.encodeStateAsUpdate(new Y.Doc()));
    const base = Date.now() - 3 * 3_600_000;
    const seed = (kind: 'auto' | 'manual', count: number) =>
      app.db.projectVersion.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          projectId: project.id,
          kind,
          state: empty,
          schemaVersion: 1,
          sizeBytes: empty.byteLength,
          nodeCount: 0,
          createdById: kind === 'manual' ? owner.id : null,
          createdAt: new Date(base + i * 1_000),
        })),
      });
    await seed('auto', 48);
    await seed('manual', 200);
    const oldest = (kind: 'auto' | 'manual') =>
      app.db.projectVersion.findFirstOrThrow({ where: { projectId: project.id, kind }, orderBy: { createdAt: 'asc' } });
    const oldestAuto = await oldest('auto');
    const oldestManual = await oldest('manual');

    // Margen frente a la hora de Postgres; las sembradas son de hace tres horas.
    const opened = new Date(Date.now() - 60_000);
    const client = await open(a, owner, project.id);
    addNode(client.doc, rectProps(firstPageId(client.doc), owner.id));
    await waitFor(
      () => app.db.projectVersion.findFirst({ where: { projectId: project.id, kind: 'auto', createdAt: { gte: opened } } }),
      'versión automática nueva',
    );
    const auto = await versionsOf(project.id, 'auto');
    expect(auto).toHaveLength(48);
    expect(auto.some((version) => version.id === oldestAuto.id)).toBe(false);

    const created = await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: 'Nueva' });
    expect(created.statusCode, created.body).toBe(201);
    const manual = await versionsOf(project.id, 'manual');
    expect(manual).toHaveLength(200);
    expect(manual.some((version) => version.id === oldestManual.id)).toBe(false);
    expect(manual.some((version) => version.id === created.json().id)).toBe(true);
    client.destroy();
  });

  it('si el epoch cambió al forzar el guardado, crear una versión responde 409 DOCUMENT_RELOADED', async () => {
    const { owner, project } = await setup();
    const client = await open(a, owner, project.id);
    const rect = addNode(client.doc, rectProps(firstPageId(client.doc), owner.id));
    await storedWith(project.id, (doc) => Boolean(nodesOf(doc)[rect]));
    // Sin cambios pendientes: el único guardado que ve el epoch nuevo es el forzado.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await app.db.projectDocument.update({ where: { projectId: project.id }, data: { epoch: { increment: 1 } } });

    const created = await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: 'Tarde' });
    expect(created.statusCode, created.body).toBe(409);
    expect(created.json().error.code).toBe('DOCUMENT_RELOADED');
    expect(await versionsOf(project.id, 'manual')).toHaveLength(0);
    client.destroy();
  });

  it('restaurar sin ninguna instancia con el documento lo carga, lo sustituye y guarda el resultado', async () => {
    const { owner, project } = await setup();
    const client = await open(a, owner, project.id);
    const rect = addNode(client.doc, rectProps(firstPageId(client.doc), owner.id));
    setText(client.doc, rect, 'Hola');
    await storedWith(project.id, (doc) => textOf(doc, rect) === 'Hola');
    const version = (await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: 'Antes' })).json();
    setText(client.doc, rect, 'Hola mundo');
    const extra = addNode(client.doc, rectProps(firstPageId(client.doc), owner.id, { x: 400 }));
    await storedWith(project.id, (doc) => textOf(doc, rect) === 'Hola mundo' && Boolean(nodesOf(doc)[extra]));
    client.destroy();
    await waitFor(() => !a.document(project.id) && !b.document(project.id), 'documento descargado', 8_000);

    const restored = await api(app, owner, 'POST', `/v1/projects/${project.id}/versions/${version.id}/restore`);
    expect(restored.statusCode, restored.body).toBe(200);
    const { restorePointId } = RestoreVersionResponseSchema.parse(restored.json());
    const points = await versionsOf(project.id, 'restore_point');
    expect(points.map((point) => point.id)).toEqual([restorePointId]);
    const before = new Y.Doc();
    Y.applyUpdate(before, points[0]!.state);
    expect(textOf(before, rect)).toBe('Hola mundo');
    await storedWith(project.id, (doc) => textOf(doc, rect) === 'Hola' && !nodesOf(doc)[extra] && Boolean(nodesOf(doc)[rect]));
    await waitFor(() => !a.document(project.id) && !b.document(project.id), 'conexión directa cerrada', 8_000);
  });

  // Último caso: detiene las dos instancias de collab.
  it('sin ninguna instancia de collab escuchando, restaurar responde 503 COLLAB_UNAVAILABLE', async () => {
    const { owner, project } = await setup();
    await Promise.all([a.stop(), b.stop()]);
    collabStopped = true;

    const created = await api(app, owner, 'POST', `/v1/projects/${project.id}/versions`, { name: 'Sin collab' });
    expect(created.statusCode, created.body).toBe(201);
    const restored = await api(app, owner, 'POST', `/v1/projects/${project.id}/versions/${created.json().id}/restore`);
    expect(restored.statusCode).toBe(503);
    expect(restored.json().error.code).toBe('COLLAB_UNAVAILABLE');
    expect(await versionsOf(project.id, 'restore_point')).toHaveLength(0);
  });
});
