import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
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
  type TestClient,
  type TestCollab,
} from '../../test/helpers/collab.js';
import { ROOT_KEYS } from '../shared/document/keys.js';
import { ActivityExtension, SESSION_MIN_MS } from './extensions/activity.js';

let a: TestCollab;
let b: TestCollab;
const clients: TestClient[] = [];

function track(client: TestClient): TestClient {
  clients.push(client);
  return client;
}

beforeAll(async () => {
  [a, b] = await Promise.all([startCollab({ instanceId: 'collab-act-a' }), startCollab({ instanceId: 'collab-act-b' })]);
});

afterAll(async () => {
  for (const client of clients) client.destroy();
  await Promise.all([a.stop(), b.stop()]);
});

async function setup() {
  const owner = await seedUser(a.db, 'Ana');
  const other = await seedUser(a.db, 'Beto');
  const workspace = await seedWorkspace(a.db, owner);
  await addOrgMember(a.db, workspace.id, other, 'member');
  const project = await seedProject(a.db, workspace.id, owner);
  return { owner, other, project };
}

async function totals(projectId: string, userId: string) {
  const rows = await a.db.activityDaily.findMany({ where: { projectId, userId } });
  return rows.reduce(
    (sum, row) => ({
      editOps: sum.editOps + row.editOps,
      nodesCreated: sum.nodesCreated + row.nodesCreated,
      nodesDeleted: sum.nodesDeleted + row.nodesDeleted,
      activeMinutes: sum.activeMinutes + row.activeMinutes,
      sessions: sum.sessions + row.sessions,
    }),
    { editOps: 0, nodesCreated: 0, nodesDeleted: 0, activeMinutes: 0, sessions: 0 },
  );
}

const minuteNow = () => Math.floor(Date.now() / 60_000);

describe('ActivityExtension con dos instancias', () => {
  it('un update de A cuenta una sola vez y las transacciones local y redis no cuentan', async () => {
    const { owner, other, project } = await setup();
    const onA = track(connect(a.url, project.id, () => tokenFor(owner, project.id)));
    const onB = track(connect(b.url, project.id, () => tokenFor(other, project.id)));
    await Promise.all([onA.synced(), onB.synced()]);

    const id = addNode(onA.doc, rectProps(firstPageId(onA.doc), owner.id));
    await waitFor(() => nodesOf(onB.doc)[id], 'nodo de A en B');
    a.document(project.id)!.transact(() => a.document(project.id)!.getMap('meta').set('servidor', 1), { source: 'local' });
    await waitFor(() => onB.doc.getMap('meta').get('servidor') === 1, 'cambio local en B');
    await Promise.all([a.activity.flush(), b.activity.flush()]);

    expect(await totals(project.id, owner.id)).toMatchObject({ editOps: 1, nodesCreated: 1, nodesDeleted: 0 });
    expect(await a.db.activityDaily.count({ where: { projectId: project.id, userId: other.id } })).toBe(0);

    onA.doc.getMap(ROOT_KEYS.nodes).delete(id);
    await waitFor(() => !nodesOf(onB.doc)[id], 'borrado en B');
    // Al descargar el documento se vuelca sin esperar al temporizador.
    onA.destroy();
    onB.destroy();
    await waitFor(() => !a.document(project.id) && !b.document(project.id), 'documento descargado', 8_000);
    await waitFor(async () => (await totals(project.id, owner.id)).editOps === 2, 'volcado al descargar');
    expect(await totals(project.id, owner.id)).toMatchObject({ editOps: 2, nodesCreated: 1, nodesDeleted: 1 });
  });

  it('dos pestañas del mismo usuario en instancias distintas no duplican minutos', async () => {
    const { owner, project } = await setup();
    const onA = track(connect(a.url, project.id, () => tokenFor(owner, project.id)));
    const onB = track(connect(b.url, project.id, () => tokenFor(owner, project.id)));
    await Promise.all([onA.synced(), onB.synced()]);

    const start = minuteNow();
    const first = addNode(onA.doc, rectProps(firstPageId(onA.doc), owner.id));
    await waitFor(() => nodesOf(onB.doc)[first], 'nodo de A en B');
    const second = addNode(onB.doc, rectProps(firstPageId(onB.doc), owner.id, { x: 200 }));
    await waitFor(() => nodesOf(onA.doc)[second], 'nodo de B en A');
    const end = minuteNow();
    await Promise.all([a.activity.flush(), b.activity.flush()]);

    const result = await totals(project.id, owner.id);
    expect(result.editOps).toBe(2);
    if (start === end) expect(result.activeMinutes).toBe(1);
    else expect(result.activeMinutes).toBeLessThanOrEqual(end - start + 1);
  });

  it('un movimiento del cursor cuenta como minuto activo sin sumar ediciones', async () => {
    const { owner, project } = await setup();
    const client = track(connect(a.url, project.id, () => tokenFor(owner, project.id)));
    await client.synced();
    client.provider.setAwarenessField('cursor', { x: 1, y: 2 });
    await waitFor(async () => {
      await a.activity.flush();
      return (await totals(project.id, owner.id)).activeMinutes === 1;
    }, 'minuto por cursor');
    expect(await totals(project.id, owner.id)).toMatchObject({ editOps: 0, activeMinutes: 1 });
  });
});

describe('sesiones', () => {
  it('cuenta conexiones de más de 60 s y no las reconexiones dentro de 10 min', async () => {
    let clock = Date.now() - 3 * 3_600_000;
    const extension = new ActivityExtension({ db: a.db, redis: a.redis, logger: pino({ level: 'silent' }), now: () => clock });
    const projectId = randomUUID();
    const userId = `u${randomUUID().slice(0, 8)}`;
    const session = async (durationMs: number, gapAfterMs: number) => {
      const socketId = randomUUID();
      const connection = { context: { projectId, userId } };
      await extension.connected({ connection, socketId } as never);
      clock += durationMs;
      await extension.onDisconnect({ socketId } as never);
      clock += gapAfterMs;
    };

    await session(SESSION_MIN_MS - 1_000, 1_000);
    await session(5 * 60_000, 2 * 60_000);
    await session(5 * 60_000, 20 * 60_000);
    await session(2 * 60_000, 0);
    await extension.onDestroy();

    expect((await totals(projectId, userId)).sessions).toBe(2);
  });
});
