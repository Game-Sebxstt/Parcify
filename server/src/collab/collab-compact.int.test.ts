import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addNode,
  connect,
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
import { compactProject, type CompactDeps } from '../core/jobs/compact.js';
import { initDocument } from '../shared/document/init.js';
import { documentNameFor, ROOT_KEYS } from '../shared/document/keys.js';
import { liveMembers, pendingMember, registerPending, unregister } from './registry.js';
import type { CollabContext } from './state.js';

let a: TestCollab;
let b: TestCollab;
let deps: CompactDeps;
const clients: TestClient[] = [];

function track(client: TestClient): TestClient {
  clients.push(client);
  return client;
}

beforeAll(async () => {
  [a, b] = await Promise.all([
    startCollab({ instanceId: 'collab-compact-a' }),
    startCollab({ instanceId: 'collab-compact-b' }),
  ]);
  deps = { db: a.db, redis: a.redis, logger: pino({ level: 'silent' }), instanceId: 'compactador-test' };
});

afterAll(async () => {
  for (const client of clients) client.destroy();
  await Promise.all([a.stop(), b.stop()]);
});

const textOf = (doc: Y.Doc | undefined) => doc?.getMap<Y.Text>(ROOT_KEYS.texts).get('nota')?.toString();

// Documento con dos rectángulos y un texto reescrito muchas veces (historial que la compactación elimina).
async function setup() {
  const owner = await seedUser(a.db, 'Ana');
  const workspace = await seedWorkspace(a.db, owner);
  const project = await seedProject(a.db, workspace.id, owner);
  const doc = new Y.Doc();
  initDocument(doc);
  const pageId = [...doc.getMap(ROOT_KEYS.pages).keys()][0]!;
  const nodes = [addNode(doc, rectProps(pageId, owner.id)), addNode(doc, rectProps(pageId, owner.id, { index: 'a1' }))];
  const text = new Y.Text();
  doc.getMap(ROOT_KEYS.texts).set('nota', text);
  for (let i = 0; i < 40; i++) {
    doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, `texto ${i}`);
    });
  }
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  await a.db.projectDocument.create({
    data: {
      projectId: project.id,
      state: new Uint8Array(state),
      schemaVersion: 1,
      sizeBytes: state.byteLength,
      nodeCount: nodes.length,
      nodeCountByType: { rect: nodes.length },
      assetRefs: [],
    },
  });
  return { owner, project, state, nodes };
}

function epochOf(projectId: string) {
  return a.db.projectDocument.findUniqueOrThrow({ where: { projectId }, select: { epoch: true } }).then((row) => row.epoch);
}

// Bloquea la fila del documento para que el compactador quede esperando con su bloqueo de Redis tomado.
async function holdDocumentRow(projectId: string) {
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const ready = new Promise<void>((resolve) => (locked = resolve));
  const transaction = a.db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "ProjectDocument" WHERE "projectId" = ${projectId}::uuid FOR UPDATE`;
      locked();
      await gate;
    },
    { timeout: 20_000 },
  );
  await ready;
  return async () => {
    release();
    await transaction;
  };
}

async function compactorWaiting() {
  await waitFor(async () => {
    const rows = await a.db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query LIKE '%UPDATE "ProjectDocument"%"epoch" = "epoch" + 1%'`;
    return rows[0]!.n > 0;
  }, 'compactador esperando la fila');
}

async function unloaded(projectId: string) {
  await waitFor(async () => (await liveMembers(a.redis, projectId)).length === 0 && !a.document(projectId) && !b.document(projectId), 'documento descargado');
}

describe('compactación con collab', () => {
  it('no compacta mientras alguna instancia tenga el documento registrado o una conexión autenticándose', async () => {
    const { owner, project } = await setup();
    const client = track(connect(b.url, project.id, () => tokenFor(owner, project.id)));
    await client.synced();
    expect(await liveMembers(a.redis, project.id)).toEqual([b.instanceId]);

    expect(await compactProject(deps, project.id, { requested: true })).toBe('loaded');
    expect(await epochOf(project.id)).toBe(1);

    client.destroy();
    await unloaded(project.id);
    await registerPending(a.redis, project.id, 'socket-prueba');
    expect(await compactProject(deps, project.id, { requested: true })).toBe('loaded');
    expect(await epochOf(project.id)).toBe(1);
    await unregister(a.redis, project.id, pendingMember('socket-prueba'));

    expect(await compactProject(deps, project.id, { requested: true })).toBe('compacted');
    expect(await epochOf(project.id)).toBe(2);
    expect(await a.db.projectVersion.count({ where: { projectId: project.id, kind: 'restore_point' } })).toBe(1);
  });

  it('un fetch durante la compactación espera y carga el epoch nuevo', async () => {
    const { project, nodes } = await setup();
    const releaseRow = await holdDocumentRow(project.id);
    const compaction = compactProject(deps, project.id, { requested: true });
    await compactorWaiting();

    let loaded = false;
    const direct = a.server.hocuspocus.openDirectConnection(documentNameFor(project.id), {} as CollabContext).then((connection) => {
      loaded = true;
      return connection;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(loaded).toBe(false);

    await releaseRow();
    expect(await compaction).toBe('compacted');
    const connection = await direct;
    expect(a.runtime.docs.get(documentNameFor(project.id))?.epoch).toBe(2);
    expect(Object.keys(nodesOf(a.document(project.id))).sort()).toEqual([...nodes].sort());
    expect(textOf(a.document(project.id))).toBe('texto 39');
    await connection.disconnect();
    await unloaded(project.id);
  });

  it('una conexión con ep viejo que espera a la compactación recibe epoch_changed y, con un Y.Doc nuevo, no duplica nada', async () => {
    const { owner, project, state, nodes } = await setup();
    const releaseRow = await holdDocumentRow(project.id);
    const compaction = compactProject(deps, project.id, { requested: true });
    await compactorWaiting();

    // El cliente trae en memoria el documento del epoch 1.
    const stale = track(connect(a.url, project.id, () => tokenFor(owner, project.id, { ep: 1 })));
    Y.applyUpdate(stale.doc, state);
    await waitFor(
      async () => (await a.redis.smembers(`parcify:doc:${project.id}:instances`)).some((member) => member.startsWith('pending:')),
      'registro provisional',
    );

    await releaseRow();
    expect(await compaction).toBe('compacted');
    expect(await stale.failed()).toBe('epoch_changed');
    expect(stale.scopes).toEqual([]);
    stale.destroy();

    const fresh = track(connect(a.url, project.id, () => tokenFor(owner, project.id, { ep: 2 })));
    expect(await fresh.authenticated()).toBe('read-write');
    await fresh.synced();
    expect(Object.keys(nodesOf(fresh.doc)).sort()).toEqual([...nodes].sort());
    expect(textOf(fresh.doc)).toBe('texto 39');
    expect(textOf(a.document(project.id))).toBe('texto 39');
    expect(Object.keys(nodesOf(a.document(project.id)))).toHaveLength(nodes.length);
    fresh.destroy();
    await unloaded(project.id);
  });

  it('si la conexión se registra antes de que el compactador lea el conjunto, este desiste y entra con su epoch', async () => {
    const { owner, project } = await setup();
    const client = track(connect(a.url, project.id, () => tokenFor(owner, project.id, { ep: 1 })));
    await waitFor(async () => (await liveMembers(a.redis, project.id)).length > 0, 'registro de la conexión');
    expect(await compactProject(deps, project.id, { requested: true })).toBe('loaded');
    expect(await client.authenticated()).toBe('read-write');
    await client.synced();
    expect(await epochOf(project.id)).toBe(1);
    expect(textOf(client.doc)).toBe('texto 39');
    client.destroy();
  });
});
