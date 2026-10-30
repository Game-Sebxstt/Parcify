import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addOrgMember,
  addProjectMember,
  connect,
  seedProject,
  seedUser,
  seedWorkspace,
  startCollab,
  tokenFor,
  waitFor,
  type TestClient,
  type TestCollab,
} from '../../test/helpers/collab.js';
import { TEST_SECRET_A } from '../../test/helpers/env.js';
import { publishOrgEvent, publishProjectEvent } from '../core/events.js';
import { initDocument } from '../shared/document/init.js';
import { sessionCacheKey } from './extensions/auth.js';
import { acquireCompactLock, liveMembers, releaseCompactLock } from './registry.js';

let collab: TestCollab;
const clients: TestClient[] = [];

function track(client: TestClient): TestClient {
  clients.push(client);
  return client;
}

beforeAll(async () => {
  collab = await startCollab({ instanceId: 'collab-auth-a' });
});

afterAll(async () => {
  for (const client of clients) client.destroy();
  await collab.stop();
});

async function setup(orgAccess: 'none' | 'viewer' | 'editor' = 'editor') {
  const owner = await seedUser(collab.db, 'Ana Dueña');
  const workspace = await seedWorkspace(collab.db, owner);
  const project = await seedProject(collab.db, workspace.id, owner, orgAccess);
  return { owner, workspace, project };
}

describe('autenticación de la conexión', () => {
  it('rechaza el token caducado, el de otro documento y la versión de esquema antigua', async () => {
    const { owner, workspace, project } = await setup();
    const other = await seedProject(collab.db, workspace.id, owner);
    const now = Math.floor(Date.now() / 1000);

    const expired = track(connect(collab.url, project.id, () => tokenFor(owner, project.id, { nowSeconds: now - 600 })));
    expect(await expired.failed()).toBe('invalid_token');

    const forged = track(connect(collab.url, project.id, () => tokenFor(owner, project.id, { secret: TEST_SECRET_A })));
    expect(await forged.failed()).toBe('invalid_token');

    const wrongDoc = track(connect(collab.url, project.id, () => tokenFor(owner, other.id)));
    expect(await wrongDoc.failed()).toBe('no_access');

    const outdated = track(connect(collab.url, project.id, () => tokenFor(owner, project.id), { schemaVersion: '0' }));
    expect(await outdated.failed()).toBe('client_outdated');
    const v1Client = track(connect(collab.url, project.id, () => tokenFor(owner, project.id), { schemaVersion: '1' }));
    expect(await v1Client.failed()).toBe('client_outdated');
    const withoutVersion = track(connect(collab.url, project.id, () => tokenFor(owner, project.id), { schemaVersion: null }));
    expect(await withoutVersion.failed()).toBe('client_outdated');

    for (const client of [expired, forged, wrongDoc, outdated, v1Client, withoutVersion]) expect(client.scopes).toEqual([]);

    const ok = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    expect(await ok.authenticated()).toBe('read-write');
    await ok.synced();
    expect(ok.doc.getMap('pages').size).toBe(1);
    expect(await liveMembers(collab.redis, project.id)).toEqual([collab.instanceId]);
  });

  it('un lector entra en solo lectura y sus cambios no llegan al servidor ni a los demás', async () => {
    const { owner, workspace, project } = await setup('viewer');
    const reader = await seedUser(collab.db, 'Lectora');
    await addOrgMember(collab.db, workspace.id, reader, 'member');

    const editor = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    const viewer = track(connect(collab.url, project.id, () => tokenFor(reader, project.id, { role: 'viewer' })));
    expect(await editor.authenticated()).toBe('read-write');
    expect(await viewer.authenticated()).toBe('readonly');
    await viewer.synced();

    viewer.doc.getMap('meta').set('pirata', true);
    editor.doc.getMap('meta').set('legal', true);
    const server = await waitFor(() => collab.document(project.id), 'documento cargado');
    await waitFor(() => server.getMap('meta').get('legal'), 'cambio del editor');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.getMap('meta').get('pirata')).toBeUndefined();
    expect(editor.doc.getMap('meta').get('pirata')).toBeUndefined();
  });

  it('access.changed degrada a solo lectura y expulsar del espacio deja sin acceso', async () => {
    const { owner, workspace, project } = await setup('editor');
    const guest = await seedUser(collab.db, 'Invitada');
    await addProjectMember(collab.db, project.id, guest, 'editor');
    const member = await seedUser(collab.db, 'Miembro');
    const membership = await addOrgMember(collab.db, workspace.id, member, 'member');

    const guestClient = track(connect(collab.url, project.id, () => tokenFor(guest, project.id)));
    const memberClient = track(connect(collab.url, project.id, () => tokenFor(member, project.id)));
    const ownerClient = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    expect(await guestClient.authenticated()).toBe('read-write');
    expect(await memberClient.authenticated()).toBe('read-write');
    expect(await ownerClient.authenticated()).toBe('read-write');
    await Promise.all([guestClient.synced(), memberClient.synced(), ownerClient.synced()]);

    await collab.db.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId: guest.id } },
      data: { role: 'viewer' },
    });
    await publishProjectEvent(collab.redis, project.id, { type: 'access.changed', userId: guest.id });
    await guestClient.closed(4401);
    await waitFor(() => guestClient.scopes.length >= 2 && guestClient.scopes.at(-1) === 'readonly', 'reconexión en solo lectura');

    await collab.db.member.delete({ where: { id: membership.id } });
    await publishOrgEvent(collab.redis, workspace.id, { type: 'access.changed', userId: member.id });
    await memberClient.closed(4401);
    expect(await memberClient.failed()).toBe('no_access');

    expect(ownerClient.closes).toEqual([]);
  });

  it('un access.changed que llega mientras la conexión se autentica también la cierra', async () => {
    const { workspace, project } = await setup('editor');
    const member = await seedUser(collab.db, 'Miembro');
    await addOrgMember(collab.db, workspace.id, member, 'member');
    // El bloqueo de compactación detiene la autenticación después de leer el acceso.
    expect(await acquireCompactLock(collab.redis, project.id, 'compactador-test')).toBe(true);
    const client = track(connect(collab.url, project.id, () => tokenFor(member, project.id)));
    await waitFor(
      async () => (await collab.redis.smembers(`parcify:doc:${project.id}:instances`)).some((m) => m.startsWith('pending:')),
      'autenticación en espera',
    );
    await collab.db.project.update({ where: { id: project.id }, data: { orgAccess: 'viewer' } });
    await publishProjectEvent(collab.redis, project.id, { type: 'access.changed', userId: member.id });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await releaseCompactLock(collab.redis, project.id, 'compactador-test');

    await client.closed(4401);
    await waitFor(() => client.scopes.at(-1) === 'readonly', 'reconexión en solo lectura');
    expect(client.scopes[0]).toBe('read-write');
  });

  it('una sesión revocada no reconecta', async () => {
    const { owner, project } = await setup();
    const client = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    expect(await client.authenticated()).toBe('read-write');
    // `authenticated` llega antes de que la conexión quede registrada en el documento.
    await client.synced();
    expect(await collab.redis.get(sessionCacheKey(owner.sessionId))).toBe(owner.id);

    await collab.db.session.delete({ where: { id: owner.sessionId } });
    // La caché positiva dura 30 s; se simula que ya caducó.
    await collab.redis.del(sessionCacheKey(owner.sessionId));
    await publishProjectEvent(collab.redis, project.id, { type: 'access.changed', userId: owner.id });
    await client.closed(4401);
    expect(await client.failed()).toBe('session_revoked');
  });

  it('con el espacio en la papelera solo entra el owner', async () => {
    const { owner, workspace, project } = await setup('editor');
    const admin = await seedUser(collab.db, 'Admin');
    const member = await seedUser(collab.db, 'Miembro');
    const guest = await seedUser(collab.db, 'Invitado');
    await addOrgMember(collab.db, workspace.id, admin, 'admin');
    await addOrgMember(collab.db, workspace.id, member, 'member');
    await addProjectMember(collab.db, project.id, guest, 'editor');
    await collab.db.organization.update({ where: { id: workspace.id }, data: { deletedAt: new Date() } });

    for (const user of [admin, member, guest]) {
      const client = track(connect(collab.url, project.id, () => tokenFor(user, project.id)));
      expect(await client.failed()).toBe('no_access');
    }
    const ownerClient = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    expect(await ownerClient.authenticated()).toBe('read-write');
  });
});

describe('compactación y epoch', () => {
  async function seedDocument(projectId: string, epoch: number) {
    const doc = new Y.Doc();
    initDocument(doc);
    const state = new Uint8Array(Y.encodeStateAsUpdate(doc));
    await collab.db.projectDocument.upsert({
      where: { projectId },
      create: {
        projectId,
        state,
        schemaVersion: 1,
        epoch,
        sizeBytes: state.byteLength,
        nodeCount: 0,
        nodeCountByType: {},
        assetRefs: [],
      },
      update: { state, epoch, sizeBytes: state.byteLength },
    });
  }

  it('un store con epoch antiguo no sobrescribe y cierra con 4409', async () => {
    const { owner, project } = await setup();
    const client = track(connect(collab.url, project.id, () => tokenFor(owner, project.id)));
    await client.authenticated();
    await client.synced();
    client.doc.getMap('meta').set('primero', 1);
    const saved = await waitFor(async () => {
      const row = await collab.db.projectDocument.findUnique({ where: { projectId: project.id } });
      if (!row) return null;
      const stored = new Y.Doc();
      Y.applyUpdate(stored, row.state);
      return stored.getMap('meta').get('primero') === 1 ? row : null;
    }, 'primer guardado');
    await collab.db.projectDocument.update({ where: { projectId: project.id }, data: { epoch: 2 } });

    client.doc.getMap('meta').set('segundo', 2);
    await client.closed(4409);
    const after = await collab.db.projectDocument.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(after.epoch).toBe(2);
    expect(Buffer.from(after.state).equals(Buffer.from(saved.state))).toBe(true);
  });

  it('con el bloqueo tomado, una conexión con ep viejo espera y recibe epoch_changed', async () => {
    const { owner, project } = await setup();
    await seedDocument(project.id, 1);
    expect(await acquireCompactLock(collab.redis, project.id, 'compactador-test')).toBe(true);
    // Nadie tiene el documento: el compactador sigue adelante.
    expect(await liveMembers(collab.redis, project.id)).toEqual([]);

    const startedAt = Date.now();
    const client = track(connect(collab.url, project.id, () => tokenFor(owner, project.id, { ep: 1 })));
    await waitFor(
      async () => (await collab.redis.smembers(`parcify:doc:${project.id}:instances`)).some((m) => m.startsWith('pending:')),
      'registro provisional',
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    await seedDocument(project.id, 2);
    expect(await releaseCompactLock(collab.redis, project.id, 'compactador-test')).toBe(true);

    expect(await client.failed()).toBe('epoch_changed');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(400);
    expect(client.scopes).toEqual([]);
    expect(await liveMembers(collab.redis, project.id)).toEqual([]);

    const fresh = track(connect(collab.url, project.id, () => tokenFor(owner, project.id, { ep: 2 })));
    expect(await fresh.authenticated()).toBe('read-write');
  });

  it('si el registro provisional llega antes de que el compactador lea el conjunto, este desiste', async () => {
    const { owner, project } = await setup();
    await seedDocument(project.id, 1);
    expect(await acquireCompactLock(collab.redis, project.id, 'compactador-test')).toBe(true);

    const client = track(connect(collab.url, project.id, () => tokenFor(owner, project.id, { ep: 1 })));
    const members = await waitFor(async () => {
      const live = await liveMembers(collab.redis, project.id);
      return live.some((member) => member.startsWith('pending:')) ? live : null;
    }, 'registro provisional');
    // El compactador ve a alguien registrado: suelta el bloqueo sin tocar el epoch.
    expect(members.length).toBeGreaterThan(0);
    expect(await releaseCompactLock(collab.redis, project.id, 'compactador-test')).toBe(true);

    expect(await client.authenticated()).toBe('read-write');
    const stored = await collab.db.projectDocument.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(stored.epoch).toBe(1);
    await waitFor(async () => {
      const live = await liveMembers(collab.redis, project.id);
      return live.length === 1 && live[0] === collab.instanceId;
    }, 'registro provisional borrado al conectar');
  });
});
