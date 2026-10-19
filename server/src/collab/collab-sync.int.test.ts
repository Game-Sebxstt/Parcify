import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addNode,
  connect,
  firstPageId,
  nodesOf,
  rectProps,
  seedProject,
  seedUser,
  seedWorkspace,
  startCollab,
  tokenFor,
  waitFor,
  type TestClient,
  type TestCollab,
} from '../../test/helpers/collab.js';
import { publishOrgEvent, publishProjectEvent } from '../core/events.js';
import { documentNameFor } from '../shared/document/keys.js';
import { initialPageId } from './extensions/normalize.js';

let a: TestCollab;
let b: TestCollab;
const clients: TestClient[] = [];

function track(client: TestClient): TestClient {
  clients.push(client);
  return client;
}

beforeAll(async () => {
  [a, b] = await Promise.all([startCollab({ instanceId: 'collab-sync-a' }), startCollab({ instanceId: 'collab-sync-b' })]);
});

afterAll(async () => {
  for (const client of clients) client.destroy();
  await Promise.all([a.stop(), b.stop()]);
});

async function setup() {
  const owner = await seedUser(a.db, 'Ana Dueña');
  const workspace = await seedWorkspace(a.db, owner);
  const project = await seedProject(a.db, workspace.id, owner);
  return { owner, workspace, project };
}

describe('persistencia', () => {
  it('guarda en ProjectDocument y al recargar devuelve el mismo contenido', async () => {
    const { owner, project } = await setup();
    const before = await a.db.project.findUniqueOrThrow({ where: { id: project.id } });
    const client = track(connect(a.url, project.id, () => tokenFor(owner, project.id)));
    await client.authenticated();
    await client.synced();
    const pageId = firstPageId(client.doc);
    expect(pageId).toBe(initialPageId(project.id));

    const assetId = randomUUID();
    const rect = addNode(client.doc, rectProps(pageId, owner.id));
    const image = addNode(client.doc, {
      ...rectProps(pageId, owner.id),
      type: 'image',
      assetId,
      fit: 'cover',
      cornerRadius: 0,
    });

    const row = await waitFor(async () => {
      const stored = await a.db.projectDocument.findUnique({ where: { projectId: project.id } });
      return stored && stored.nodeCount === 2 ? stored : null;
    }, 'guardado con dos nodos');
    expect(row).toMatchObject({ epoch: 1, schemaVersion: 1, nodeCountByType: { rect: 1, image: 1 }, assetRefs: [assetId] });
    expect(row.sizeBytes).toBe(row.state.byteLength);
    const after = await a.db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after.lastEditedAt.getTime()).toBeGreaterThan(before.lastEditedAt.getTime());
    expect(after.lastEditedById).toBe(owner.id);

    client.destroy();
    await waitFor(() => !a.document(project.id), 'documento descargado', 8_000);
    expect(a.runtime.docs.has(documentNameFor(project.id))).toBe(false);

    const again = track(connect(a.url, project.id, () => tokenFor(owner, project.id)));
    await again.authenticated();
    await again.synced();
    await waitFor(() => Object.keys(nodesOf(again.doc)).length === 2, 'nodos recargados');
    expect(nodesOf(again.doc)[rect]).toMatchObject({ type: 'rect', x: 10, createdBy: owner.id });
    expect(nodesOf(again.doc)[image]).toMatchObject({ type: 'image', assetId });
    expect(again.doc.getMap('pages').size).toBe(1);
  });
});

describe('dos instancias con la extensión Redis', () => {
  it('sincronizan un mismo documento en las dos direcciones', async () => {
    const { owner, project } = await setup();
    const second = await seedUser(a.db, 'Beatriz');
    await a.db.member.create({
      data: { id: randomUUID(), organizationId: project.organizationId, userId: second.id, role: 'member' },
    });
    const onA = track(connect(a.url, project.id, () => tokenFor(owner, project.id)));
    const onB = track(connect(b.url, project.id, () => tokenFor(second, project.id)));
    await Promise.all([onA.synced(), onB.synced()]);
    expect(firstPageId(onA.doc)).toBe(firstPageId(onB.doc));
    expect(onA.doc.getMap('pages').size).toBe(1);

    const fromA = addNode(onA.doc, rectProps(firstPageId(onA.doc), owner.id));
    await waitFor(() => nodesOf(onB.doc)[fromA], 'nodo de A en B');
    const fromB = addNode(onB.doc, rectProps(firstPageId(onB.doc), second.id, { x: 300 }));
    await waitFor(() => nodesOf(onA.doc)[fromB], 'nodo de B en A');
    expect(Object.keys(nodesOf(a.document(project.id))).sort()).toEqual([fromA, fromB].sort());
    expect(Object.keys(nodesOf(b.document(project.id))).sort()).toEqual([fromA, fromB].sort());
  });

  it('un update que llega a A se normaliza una sola vez', async () => {
    const { owner, project } = await setup();
    const onA = track(connect(a.url, project.id, () => tokenFor(owner, project.id)));
    const onB = track(connect(b.url, project.id, () => tokenFor(owner, project.id)));
    await Promise.all([onA.synced(), onB.synced()]);
    const correctionsA = a.normalize.corrections;
    const correctionsB = b.normalize.corrections;

    const id = addNode(onA.doc, rectProps(firstPageId(onA.doc), 'impostor', { x: 5e7, opacity: 4 }));
    await waitFor(() => nodesOf(onB.doc)[id]?.x === 1e6, 'nodo reparado en B');
    expect(nodesOf(onB.doc)[id]).toMatchObject({ x: 1e6, opacity: 1, createdBy: owner.id });
    expect(nodesOf(b.document(project.id))[id]).toMatchObject({ x: 1e6, opacity: 1, createdBy: owner.id });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(a.normalize.corrections - correctionsA).toBe(3);
    expect(b.normalize.corrections - correctionsB).toBe(0);
  });
});

describe('eventos de la API', () => {
  it('project.deleted cierra con 4410 sin guardar y doc.readonly llega a las conexiones de la otra instancia', async () => {
    const { owner, project } = await setup();
    const onA = track(connect(a.url, project.id, () => tokenFor(owner, project.id)));
    const onB = track(connect(b.url, project.id, () => tokenFor(owner, project.id)));
    await Promise.all([onA.synced(), onB.synced()]);

    await publishProjectEvent(a.redis, project.id, { type: 'doc.readonly', reason: 'size' });
    await waitFor(() => onB.stateless.find((m) => m.type === 'limit' && m.what === 'size'), 'aviso de tamaño en B');
    const assetId = randomUUID();
    await publishProjectEvent(a.redis, project.id, { type: 'asset.ready', assetId });
    await waitFor(() => onA.stateless.find((m) => m.type === 'asset.ready' && m.assetId === assetId), 'asset.ready en A');
    await waitFor(() => onB.stateless.find((m) => m.type === 'asset.ready' && m.assetId === assetId), 'asset.ready en B');

    await a.db.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
    await publishProjectEvent(a.redis, project.id, { type: 'project.deleted' });
    await Promise.all([onA.closed(4410), onB.closed(4410)]);
    // Un cambio posterior al descarte no llega a Postgres.
    a.document(project.id)?.transact(() => a.document(project.id)!.getMap('meta').set('tarde', true), { source: 'local' });
    await waitFor(() => !a.document(project.id) && !b.document(project.id), 'documento descargado', 8_000);
    expect(await onA.failed()).toBe('not_found');
    const row = await a.db.projectDocument.findUnique({ where: { projectId: project.id } });
    if (row) {
      const stored = new Y.Doc();
      Y.applyUpdate(stored, row.state);
      expect(stored.getMap('meta').get('tarde')).toBeUndefined();
    }
  });

  it('workspace.deleted cierra con 4410 las conexiones de los documentos del espacio', async () => {
    const { owner, workspace, project } = await setup();
    const client = track(connect(b.url, project.id, () => tokenFor(owner, project.id)));
    await client.synced();
    await publishOrgEvent(a.redis, workspace.id, { type: 'workspace.deleted' });
    await client.closed(4410);
  });
});

describe('salud y métricas', () => {
  it('/health y /ready responden y /metrics exige el token', async () => {
    expect((await fetch(`${a.httpUrl}/health`)).status).toBe(200);
    const ready = await fetch(`${a.httpUrl}/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ checks: { postgres: 'ok', redis: 'ok', documents: 'ok' } });
    expect((await fetch(`${a.httpUrl}/metrics`)).status).toBe(401);
    const metrics = await fetch(`${a.httpUrl}/metrics`, { headers: { authorization: 'Bearer metrics-token-0123456789' } });
    expect(metrics.status).toBe(200);
    const body = await metrics.text();
    for (const name of ['collab_connections', 'collab_documents_loaded', 'collab_store_duration_seconds', 'collab_strikes_total']) {
      expect(body).toContain(name);
    }
  });
});

describe('estado del servidor', () => {
  it('el estado inicial no duplica la página si dos instancias cargan a la vez', async () => {
    const { owner, project } = await setup();
    const docA = new Y.Doc();
    const onA = track(connect(a.url, project.id, () => tokenFor(owner, project.id)));
    const onB = track(connect(b.url, project.id, () => tokenFor(owner, project.id)));
    await Promise.all([onA.synced(), onB.synced()]);
    await waitFor(() => onA.doc.getMap('pages').size === 1 && onB.doc.getMap('pages').size === 1, 'una página');
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(onA.doc));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(onB.doc));
    expect(docA.getMap('pages').size).toBe(1);
  });
});
