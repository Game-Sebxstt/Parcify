import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addNode,
  addOrgMember,
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
  type SeedUser,
  type TestClient,
  type TestCollab,
} from '../../test/helpers/collab.js';
import { newNodeId } from '../shared/document/ids.js';
import { COLLAB_LIMITS, DOCUMENT_LIMITS } from '../shared/document/limits.js';
import type { CollabConnection } from './state.js';

let collab: TestCollab;
const clients: TestClient[] = [];

function track(client: TestClient): TestClient {
  clients.push(client);
  return client;
}

beforeAll(async () => {
  collab = await startCollab({ instanceId: 'collab-guard-a' });
});

afterAll(async () => {
  for (const client of clients) client.destroy();
  await collab.stop();
});

async function setup() {
  const owner = await seedUser(collab.db, 'Ana Dueña');
  const workspace = await seedWorkspace(collab.db, owner);
  const project = await seedProject(collab.db, workspace.id, owner);
  return { owner, workspace, project };
}

function presence(pageId: string, overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'falso', name: 'Impostor', color: '#000000', avatarAssetId: null },
    pageId,
    cursor: { x: 1, y: 2 },
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: Array.from({ length: DOCUMENT_LIMITS.maxSelectionIds }, () => newNodeId()),
    selectionBox: null,
    marquee: null,
    gesture: { ids: 'selection', matrix: [1, 0, 0, 1, 10, 0] },
    editingText: { nodeId: newNodeId(), anchor: 'a'.repeat(200), head: 'b'.repeat(200) },
    chatTyping: false,
    aiBusy: false,
    ...overrides,
  };
}

function serverConnection(projectId: string, userId: string): CollabConnection | undefined {
  const document = collab.document(projectId);
  return (document?.getConnections() as CollabConnection[] | undefined)?.find((c) => c.context?.userId === userId);
}

describe('Awareness', () => {
  it('el estado máximo pasa con el usuario real y uno de 33 KiB se descarta', async () => {
    const { owner, workspace, project } = await setup();
    const other = await seedUser(collab.db, 'Beatriz');
    await addOrgMember(collab.db, workspace.id, other, 'member');
    const sender = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    const receiver = track(connect(collab.url, project.id, () => tokenFor(other, project.id)));
    await Promise.all([sender.synced(), receiver.synced()]);
    const pageId = firstPageId(sender.doc);
    const awareness = sender.provider.awareness!;

    const state = presence(pageId);
    expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThan(DOCUMENT_LIMITS.maxAwarenessBytes);
    awareness.setLocalState(state);
    const seen = await waitFor(() => {
      const remote = receiver.provider.awareness!.getStates().get(sender.doc.clientID);
      return remote?.selection ? remote : null;
    }, 'estado remoto');
    expect(seen.user).toEqual({ id: owner.id, name: 'Ana Dueña', color: expect.stringMatching(/^#[0-9A-F]{6}$/i), avatarAssetId: null });
    expect(seen.selection).toHaveLength(DOCUMENT_LIMITS.maxSelectionIds);

    const huge = presence(pageId, { cursor: { x: 99, y: 99 }, filler: 'x'.repeat(33 * 1024) });
    awareness.setLocalState(huge);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const after = receiver.provider.awareness!.getStates().get(sender.doc.clientID);
    expect(after?.cursor).toEqual({ x: 1, y: 2 });
    expect(after?.filler).toBeUndefined();
    const onServer = collab.document(project.id)!.awareness.getStates().get(sender.doc.clientID);
    expect(onServer?.filler).toBeUndefined();
  });
});

describe('normalización y strikes', () => {
  it('un nodo inválido se repara en el servidor y cuenta un strike para su conexión', async () => {
    const { owner, project } = await setup();
    const client = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    await client.synced();
    const pageId = firstPageId(client.doc);
    const valid = addNode(client.doc, rectProps(pageId, owner.id));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const connection = await waitFor(() => serverConnection(project.id, owner.id), 'conexión en el servidor');
    expect(collab.runtime.strikes.count(connection.socketId)).toBe(0);

    const invalid = addNode(client.doc, rectProps(pageId, owner.id, { rotation: 10 }));
    await waitFor(() => {
      const rotation = nodesOf(client.doc)[invalid]?.rotation as number | undefined;
      return rotation !== undefined && Math.abs(rotation) <= Math.PI;
    }, 'rotación normalizada');
    expect(collab.runtime.strikes.count(connection.socketId)).toBe(1);

    const broken = addNode(client.doc, { ...rectProps(pageId, owner.id), type: 'hexagono' });
    await waitFor(() => !nodesOf(client.doc)[broken], 'nodo irrecuperable borrado');
    expect(nodesOf(client.doc)[valid]).toBeDefined();
    expect(collab.runtime.strikes.count(connection.socketId)).toBe(2);
  });

  it('ping recibe pong; cualquier otro stateless es un strike y con 20 se cierra con 4400', async () => {
    const { owner, project } = await setup();
    const client = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    await client.synced();
    client.provider.sendStateless(JSON.stringify({ type: 'ping' }));
    await waitFor(() => client.stateless.find((m) => m.type === 'pong'), 'pong');

    for (let i = 0; i < COLLAB_LIMITS.strikeLimit; i++) client.provider.sendStateless(JSON.stringify({ type: 'hola', i }));
    await client.closed(4400);
  });
});

describe('tamaño del documento', () => {
  it('por encima de 25 MiB las conexiones abiertas y las nuevas pasan a solo lectura', async () => {
    const { owner, project } = await setup();
    const client = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    await client.synced();
    expect(client.scopes.at(-1)).toBe('read-write');

    const document = collab.document(project.id)!;
    document.transact(() => document.getMap('meta').set('relleno', 'x'.repeat(DOCUMENT_LIMITS.sizeReadOnlyBytes + 1024)), {
      source: 'local',
    });
    await waitFor(() => client.stateless.find((m) => m.type === 'limit' && m.what === 'size'), 'aviso de solo lectura', 20_000);
    const row = await collab.db.projectDocument.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(row.sizeBytes).toBeGreaterThan(DOCUMENT_LIMITS.sizeReadOnlyBytes);
    expect(serverConnection(project.id, owner.id)?.readOnly).toBe(true);

    client.doc.getMap('meta').set('despues', true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.getMap('meta').get('despues')).toBeUndefined();

    const late = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    expect(await late.authenticated(20_000)).toBe('readonly');
    late.destroy();
    client.destroy();
  }, 60_000);
});

describe('límites de conexiones', () => {
  it('la 9.ª pestaña de un usuario recibe too_many_tabs', async () => {
    const { owner, project } = await setup();
    const tabs = Array.from({ length: COLLAB_LIMITS.maxConnectionsPerUserPerDocument }, () =>
      track(connect(collab.url, project.id, () => tokenFor(owner, project.id))),
    );
    await Promise.all(tabs.map((tab) => tab.authenticated(15_000)));
    const extra = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    expect(await extra.failed()).toBe('too_many_tabs');
    for (const tab of [...tabs, extra]) tab.destroy();
  });

  it('la conexión 101 a un documento recibe document_full', async () => {
    const { owner, workspace, project } = await setup();
    const perUser = COLLAB_LIMITS.maxConnectionsPerUserPerDocument;
    const users: SeedUser[] = [owner];
    while (users.length * perUser < COLLAB_LIMITS.defaultMaxConnectionsPerDocument) {
      const user = await seedUser(collab.db, `Persona ${users.length}`);
      await addOrgMember(collab.db, workspace.id, user, 'member');
      users.push(user);
    }
    const opened: TestClient[] = [];
    for (let i = 0; i < COLLAB_LIMITS.defaultMaxConnectionsPerDocument; i++) {
      const user = users[Math.floor(i / perUser)]!;
      opened.push(track(connect(collab.url, project.id, () => tokenFor(user, project.id))));
    }
    await Promise.all(opened.map((client) => client.authenticated(30_000)));
    await waitFor(() => collab.document(project.id)?.getConnectionsCount() === COLLAB_LIMITS.defaultMaxConnectionsPerDocument, '100 conexiones', 15_000);

    const extraUser = await seedUser(collab.db, 'La 101');
    await addOrgMember(collab.db, workspace.id, extraUser, 'member');
    const extra = track(connect(collab.url, project.id, () => tokenFor(extraUser, project.id)));
    expect(await extra.failed()).toBe('document_full');
    for (const client of [...opened, extra]) client.destroy();
  }, 90_000);
});
