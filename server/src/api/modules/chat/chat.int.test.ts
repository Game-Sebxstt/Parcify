import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified, type TestUser } from '../../../../test/helpers/auth.js';
import { connect, startCollab, waitFor, type TestCollab } from '../../../../test/helpers/collab.js';
import { addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { utcDay } from '../../../core/activity.js';
import { ChatListResponseSchema, ChatMessageSchema } from './schemas.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;
let collab: TestCollab;

beforeAll(async () => {
  [app, collab] = await Promise.all([buildTestApp(), startCollab({ instanceId: 'collab-chat-a' })]);
});

afterAll(async () => {
  await Promise.all([app.close(), collab.stop()]);
});

async function setup() {
  const owner = await registerVerified(app, { name: 'Ana' });
  const ws = await createWorkspaceFor(app, owner);
  const project = await createProjectRow(app, ws.id, owner.id, { orgAccess: 'none' });
  return { owner, ws, project };
}

async function readyAsset(projectId: string, organizationId: string, ownerId: string) {
  const id = randomUUID();
  await app.db.asset.create({
    data: {
      id,
      projectId,
      organizationId,
      ownerId,
      source: 'upload',
      status: 'ready',
      storageKey: `${organizationId}/${id}/original.png`,
      mime: 'image/png',
      sizeBytes: 10,
      inGallery: false,
    },
  });
  return id;
}

function send(user: TestUser, projectId: string, body: Record<string, unknown>) {
  return api(app, user, 'POST', `/v1/projects/${projectId}/chat`, body);
}

describe('chat del proyecto', () => {
  it('pagina hacia atrás con before y devuelve cada página en orden cronológico', async () => {
    const { owner, project } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await send(owner, project.id, { body: `mensaje ${i}` });
      expect(response.statusCode, response.body).toBe(201);
      ids.push(response.json().id);
    }

    const first = ChatListResponseSchema.parse((await api(app, owner, 'GET', `/v1/projects/${project.id}/chat?limit=2`)).json());
    expect(first.items.map((item) => item.body)).toEqual(['mensaje 3', 'mensaje 4']);
    expect(first.nextCursor).toBe(ids[3]);

    const second = ChatListResponseSchema.parse(
      (await api(app, owner, 'GET', `/v1/projects/${project.id}/chat?limit=2&before=${first.nextCursor}`)).json(),
    );
    expect(second.items.map((item) => item.body)).toEqual(['mensaje 1', 'mensaje 2']);

    const last = ChatListResponseSchema.parse(
      (await api(app, owner, 'GET', `/v1/projects/${project.id}/chat?limit=2&before=${second.nextCursor}`)).json(),
    );
    expect(last.items.map((item) => item.body)).toEqual(['mensaje 0']);
    expect(last.nextCursor).toBeNull();
  });

  it('un lector chatea; quien no ve el proyecto recibe 404', async () => {
    const { project } = await setup();
    const viewer = await registerVerified(app, { name: 'Lectora' });
    const stranger = await registerVerified(app);
    await addProjectMember(app, project.id, viewer.id, 'viewer');
    expect((await send(viewer, project.id, { body: 'hola' })).statusCode).toBe(201);
    expect((await send(stranger, project.id, { body: 'hola' })).statusCode).toBe(404);
    expect((await api(app, stranger, 'GET', `/v1/projects/${project.id}/chat`)).statusCode).toBe(404);
  });

  it('valida cuerpo, adjuntos y menciones', async () => {
    const { owner, ws, project } = await setup();
    const viewer = await registerVerified(app, { name: 'Lectora' });
    const stranger = await registerVerified(app);
    await addProjectMember(app, project.id, viewer.id, 'viewer');

    expect((await send(owner, project.id, { body: '   ' })).statusCode).toBe(400);
    expect((await send(owner, project.id, { body: 'x'.repeat(4001) })).statusCode).toBe(400);

    const other = await createProjectRow(app, ws.id, owner.id);
    const foreign = await readyAsset(other.id, ws.id, owner.id);
    const ownAsset = await readyAsset(project.id, ws.id, owner.id);
    const withForeign = await send(owner, project.id, { body: 'mira', attachments: [ownAsset, foreign] });
    expect(withForeign.statusCode).toBe(400);
    expect(withForeign.json().error.code).toBe('INVALID_ATTACHMENT');
    expect((await send(owner, project.id, { body: 'mira', attachments: [randomUUID()] })).json().error.code).toBe(
      'INVALID_ATTACHMENT',
    );

    const noAccess = await send(owner, project.id, { body: '@alguien', mentions: [viewer.id, stranger.id] });
    expect(noAccess.statusCode).toBe(400);
    expect(noAccess.json().error.code).toBe('VALIDATION_FAILED');
    expect(noAccess.json().error.details.issues).toEqual([{ path: 'body.mentions.1', message: 'sin acceso al proyecto' }]);

    const ok = await send(owner, project.id, { body: '@Lectora mira', attachments: [ownAsset], mentions: [viewer.id] });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ChatMessageSchema.strict().parse(ok.json())).toMatchObject({
      attachments: [ownAsset],
      mentions: [viewer.id],
      author: { id: owner.id, name: 'Ana' },
    });
    expect(await app.db.chatMessage.count({ where: { projectId: project.id } })).toBe(1);
  });

  it('el mensaje llega a un cliente de collab conectado y cuenta en ActivityDaily', async () => {
    const { owner, project } = await setup();
    const tokenResponse = await api(app, owner, 'POST', `/v1/projects/${project.id}/collab-token`);
    expect(tokenResponse.statusCode, tokenResponse.body).toBe(200);
    const token = tokenResponse.json().token as string;
    const client = connect(collab.url, project.id, async () => token);
    try {
      await client.synced();
      const first = await send(owner, project.id, { body: 'en vivo' });
      expect(first.statusCode).toBe(201);
      const event = await waitFor(
        () => client.stateless.find((m) => m.type === 'chat.message' && (m.message as { id?: string }).id === first.json().id),
        'chat.message en collab',
      );
      expect(ChatMessageSchema.parse(event.message)).toEqual(first.json());

      const reply = await send(owner, project.id, { body: 'respuesta', replyToId: first.json().id });
      expect(reply.json().replyTo).toEqual({ id: first.json().id, authorName: 'Ana', excerpt: 'en vivo', deleted: false });

      const daily = await app.db.activityDaily.findUniqueOrThrow({
        where: {
          projectId_userId_day: { projectId: project.id, userId: owner.id, day: new Date(`${utcDay(new Date())}T00:00:00Z`) },
        },
      });
      expect(daily.chatMessages).toBe(2);
    } finally {
      client.destroy();
    }
  });

  it('editar es del autor; borrar es lógico, del autor o de un admin, y se anuncia', async () => {
    const { owner, project } = await setup();
    const editor = await registerVerified(app, { name: 'Edu' });
    await addProjectMember(app, project.id, editor.id, 'editor');
    const created = (await send(editor, project.id, { body: 'borrador' })).json();
    const reply = (await send(owner, project.id, { body: 'cito', replyToId: created.id })).json();

    expect((await api(app, owner, 'PATCH', `/v1/projects/${project.id}/chat/${created.id}`, { body: 'no' })).statusCode).toBe(403);
    const edited = await api(app, editor, 'PATCH', `/v1/projects/${project.id}/chat/${created.id}`, { body: 'final' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ body: 'final' });
    expect(edited.json().editedAt).not.toBeNull();

    expect((await api(app, editor, 'DELETE', `/v1/projects/${project.id}/chat/${reply.id}`)).statusCode).toBe(403);
    expect((await api(app, owner, 'DELETE', `/v1/projects/${project.id}/chat/${created.id}`)).statusCode).toBe(204);
    expect((await api(app, owner, 'DELETE', `/v1/projects/${project.id}/chat/${created.id}`)).statusCode).toBe(204);

    const row = await app.db.chatMessage.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.body).toBe('final');

    const page = ChatListResponseSchema.parse((await api(app, owner, 'GET', `/v1/projects/${project.id}/chat`)).json());
    const [gone, quoting] = page.items;
    expect(gone).toMatchObject({ id: created.id, body: '', attachments: [], mentions: [] });
    expect(gone!.deletedAt).not.toBeNull();
    expect(quoting!.replyTo).toEqual({ id: created.id, authorName: 'Edu', excerpt: '', deleted: true });
    expect((await api(app, editor, 'PATCH', `/v1/projects/${project.id}/chat/${created.id}`, { body: 'x' })).statusCode).toBe(404);
  });
});
