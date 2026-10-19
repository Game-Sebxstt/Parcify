import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified } from '../../../../test/helpers/auth.js';
import { addOrgMember, addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { addEditCounters, incrementDaily, recordActivity, utcDay } from '../../../core/activity.js';
import { ActivityEventsResponseSchema, ProjectActivityResponseSchema, WorkspaceActivityResponseSchema } from './schemas.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

const today = utcDay(new Date());
const yesterday = utcDay(new Date(Date.now() - 86_400_000));

function edits(editOps: number, extra: Partial<Parameters<typeof addEditCounters>[1]['counters']> = {}) {
  return { editOps, nodesCreated: 0, nodesDeleted: 0, activeMinutes: 0, sessions: 0, ...extra };
}

async function setup() {
  const owner = await registerVerified(app, { name: 'Ana' });
  const member = await registerVerified(app, { name: 'Beto' });
  const outsider = await registerVerified(app, { name: 'Ciro' });
  const ws = await createWorkspaceFor(app, owner);
  await addOrgMember(app, ws.id, member, 'member');
  const hidden = await createProjectRow(app, ws.id, owner.id, { name: 'Oculto', orgAccess: 'none' });
  const shared = await createProjectRow(app, ws.id, owner.id, { name: 'Abierto', orgAccess: 'viewer' });
  const trashed = await createProjectRow(app, ws.id, owner.id, { name: 'Papelera', deletedAt: new Date() });

  await addEditCounters(app.db, { projectId: hidden.id, userId: owner.id, day: today, counters: edits(5, { activeMinutes: 3 }) });
  await addEditCounters(app.db, { projectId: shared.id, userId: owner.id, day: today, counters: edits(2, { nodesCreated: 1 }) });
  await addEditCounters(app.db, { projectId: shared.id, userId: owner.id, day: today, counters: edits(1, { sessions: 1 }) });
  await addEditCounters(app.db, { projectId: shared.id, userId: member.id, day: yesterday, counters: edits(4, { nodesDeleted: 2 }) });
  await incrementDaily(app.db, { projectId: shared.id, userId: member.id, counter: 'chatMessages' });
  await addEditCounters(app.db, { projectId: trashed.id, userId: owner.id, day: today, counters: edits(50) });
  await app.db.projectDocument.create({
    data: {
      projectId: shared.id,
      state: Buffer.from([0, 0]),
      schemaVersion: 1,
      sizeBytes: 2,
      nodeCount: 3,
      nodeCountByType: { rect: 2, text: 1 },
      assetRefs: [],
    },
  });
  return { owner, member, outsider, ws, hidden, shared, trashed };
}

describe('actividad del proyecto', () => {
  it('devuelve series por usuario y día, totales y el recuento por tipo', async () => {
    const { owner, member, shared } = await setup();
    const response = await api(app, member, 'GET', `/v1/projects/${shared.id}/activity?from=${yesterday}&to=${today}`);
    expect(response.statusCode, response.body).toBe(200);
    const body = ProjectActivityResponseSchema.parse(response.json());
    expect(body.from).toBe(yesterday);
    expect(body.to).toBe(today);
    expect(body.totals).toMatchObject({ editOps: 7, nodesCreated: 1, nodesDeleted: 2, sessions: 1, chatMessages: 1 });
    expect(body.series).toHaveLength(3);
    expect(body.series.find((point) => point.userId === owner.id && point.day === today)).toMatchObject({ editOps: 3, sessions: 1 });
    expect(body.series.find((point) => point.userId === member.id && point.day === yesterday)).toMatchObject({ editOps: 4 });
    expect(body.byUser.find((row) => row.userId === member.id)).toMatchObject({ editOps: 4, chatMessages: 1 });
    expect(body.users.map((user) => user.name).sort()).toEqual(['Ana', 'Beto']);
    expect(body.nodeCountByType).toEqual({ rect: 2, text: 1 });
  });

  it('rechaza rangos de más de 90 días, invertidos o con fechas inválidas', async () => {
    const { owner, shared } = await setup();
    const tooLong = await api(app, owner, 'GET', `/v1/projects/${shared.id}/activity?from=2026-01-01&to=2026-04-01`);
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.code).toBe('VALIDATION_FAILED');
    const ninety = await api(app, owner, 'GET', `/v1/projects/${shared.id}/activity?from=2026-01-01&to=2026-03-31`);
    expect(ninety.statusCode).toBe(200);
    expect((await api(app, owner, 'GET', `/v1/projects/${shared.id}/activity?from=2026-02-02&to=2026-02-01`)).statusCode).toBe(400);
    expect((await api(app, owner, 'GET', `/v1/projects/${shared.id}/activity?from=2026-02-30`)).statusCode).toBe(400);
  });

  it('quien no ve el proyecto recibe 404', async () => {
    const { member, outsider, hidden, shared } = await setup();
    const forMember = await api(app, member, 'GET', `/v1/projects/${hidden.id}/activity`);
    expect(forMember.statusCode).toBe(404);
    expect(forMember.json().error.code).toBe('PROJECT_NOT_FOUND');
    expect((await api(app, member, 'GET', `/v1/projects/${hidden.id}/activity/events`)).statusCode).toBe(404);
    expect((await api(app, outsider, 'GET', `/v1/projects/${shared.id}/activity`)).statusCode).toBe(404);
    expect((await api(app, null, 'GET', `/v1/projects/${shared.id}/activity`)).statusCode).toBe(401);
  });

  it('pagina el historial de eventos del más reciente al más antiguo', async () => {
    const { owner, member, shared, hidden } = await setup();
    for (const type of ['project.created', 'member.added', 'version.created'] as const) {
      await recordActivity(app.db, { type, actorId: owner.id, projectId: shared.id, data: { kind: type } });
    }
    await recordActivity(app.db, { type: 'project.created', actorId: owner.id, projectId: hidden.id });

    const first = ActivityEventsResponseSchema.parse(
      (await api(app, member, 'GET', `/v1/projects/${shared.id}/activity/events?limit=2`)).json(),
    );
    expect(first.items.map((item) => item.type)).toEqual(['version.created', 'member.added']);
    expect(first.items[0]!.actor).toMatchObject({ id: owner.id, name: 'Ana' });
    expect(first.nextCursor).toBe(first.items[1]!.id);

    const second = ActivityEventsResponseSchema.parse(
      (await api(app, member, 'GET', `/v1/projects/${shared.id}/activity/events?limit=2&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items.map((item) => item.type)).toEqual(['project.created']);
    expect(second.nextCursor).toBeNull();
  });
});

describe('actividad del espacio', () => {
  it('solo agrega los proyectos que el usuario puede ver', async () => {
    const { owner, member, outsider, ws, hidden, shared } = await setup();
    const range = `from=${yesterday}&to=${today}`;

    const forMember = WorkspaceActivityResponseSchema.parse(
      (await api(app, member, 'GET', `/v1/workspaces/${ws.slug}/activity?${range}`)).json(),
    );
    expect(forMember.projects.map((project) => project.id)).toEqual([shared.id]);
    expect(forMember.totals.editOps).toBe(7);
    expect(forMember.nodeCountByType).toEqual({ rect: 2, text: 1 });

    const forOwner = WorkspaceActivityResponseSchema.parse(
      (await api(app, owner, 'GET', `/v1/workspaces/${ws.slug}/activity?${range}`)).json(),
    );
    expect(forOwner.projects.map((project) => project.id).sort()).toEqual([hidden.id, shared.id].sort());
    // Sin el proyecto de la papelera.
    expect(forOwner.totals.editOps).toBe(12);
    expect(forOwner.series.find((point) => point.userId === owner.id && point.day === today)).toMatchObject({
      editOps: 8,
      activeMinutes: 3,
    });
    expect(forOwner.projects.find((project) => project.id === hidden.id)!.totals.editOps).toBe(5);

    await addProjectMember(app, hidden.id, member.id, 'viewer');
    const withDirect = WorkspaceActivityResponseSchema.parse(
      (await api(app, member, 'GET', `/v1/workspaces/${ws.slug}/activity?${range}`)).json(),
    );
    expect(withDirect.totals.editOps).toBe(12);

    const forOutsider = await api(app, outsider, 'GET', `/v1/workspaces/${ws.slug}/activity`);
    expect(forOutsider.statusCode).toBe(404);
    expect(forOutsider.json().error.code).toBe('WORKSPACE_NOT_FOUND');
    expect((await api(app, member, 'GET', `/v1/workspaces/${ws.slug}/activity?from=2026-01-01&to=2026-06-01`)).statusCode).toBe(400);
  });
});
