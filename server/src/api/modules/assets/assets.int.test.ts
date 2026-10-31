import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decompressionBomb,
  gif,
  htmlPretendingToBePng,
  jpegWithGps,
  png,
  svg,
} from '../../../../test/fixtures/images/index.js';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified, type TestUser } from '../../../../test/helpers/auth.js';
import { addOrgMember, addProjectMember, api, createProjectRow, createWorkspaceFor, subscribe } from '../../../../test/helpers/seed.js';
import {
  createTestStorage,
  driverUnderTest,
  transfer,
  uploadTo,
  type TestStorage,
} from '../../../../test/helpers/storage.js';
import { projectChannel } from '../../../core/events.js';
import { assetKey } from '../../../core/storage/index.js';
import { AssetSchema } from './schemas.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

// TEST_STORAGE_DRIVER=s3 repite este archivo contra SeaweedFS sin tocar el código.
const kind = driverUnderTest();

let app: App;
let testStorage: TestStorage;

beforeAll(async () => {
  testStorage = await createTestStorage(kind);
  app = await buildTestApp({}, { storage: testStorage.storage });
});

afterAll(async () => {
  await app.close();
  await testStorage.cleanup();
});

type Purpose = 'canvas' | 'gallery' | 'chat' | 'preview' | 'avatar' | 'logo';

async function upload(
  user: TestUser,
  body: Buffer,
  options: { purpose?: Purpose; projectId?: string; workspaceSlug?: string; contentType?: string; fileName?: string } = {},
) {
  const purpose = options.purpose ?? 'canvas';
  const created = await api(app, user, 'POST', '/v1/assets/uploads', {
    purpose,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.workspaceSlug ? { workspaceSlug: options.workspaceSlug } : {}),
    fileName: options.fileName ?? 'imagen.png',
    contentType: options.contentType ?? 'image/png',
    size: body.length,
  });
  expect(created.statusCode, created.body).toBe(201);
  const { assetId, upload: target } = created.json();
  const put = await uploadTo(app, target, body);
  expect(put.status, put.body.toString()).toBeLessThan(300);
  const complete = await api(app, user, 'POST', `/v1/assets/uploads/${assetId}/complete`);
  return { assetId: assetId as string, complete };
}

async function setup() {
  const owner = await registerVerified(app);
  const ws = await createWorkspaceFor(app, owner);
  const project = await createProjectRow(app, ws.id, owner.id);
  return { owner, ws, project };
}

async function resolve(user: TestUser, ids: string[], variant: 'thumb' | 'medium' | 'full' = 'thumb') {
  const response = await api(app, user, 'POST', '/v1/assets/resolve', { ids, variant });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().assets as Record<string, { url: string; expiresAt: string }>;
}

describe(`subida y procesado (${kind})`, () => {
  it('PNG al lienzo: ready con variantes, se resuelve y publica asset.ready', async () => {
    const { owner, project } = await setup();
    const events = await subscribe([projectChannel(project.id)]);
    try {
      const { assetId, complete } = await upload(owner, await png(300, 200), { projectId: project.id });
      expect(complete.statusCode, complete.body).toBe(200);
      const asset = AssetSchema.strict().parse(complete.json());
      expect(asset).toMatchObject({ id: assetId, status: 'ready', source: 'upload', inGallery: false, width: 300, height: 200 });
      expect(Object.keys(asset.variants).sort()).toEqual(['full', 'thumb']);
      expect(await events.waitFor((m) => m.event.type === 'asset.ready' && m.event.assetId === assetId)).toBeDefined();

      const resolved = await resolve(owner, [assetId], 'medium');
      const file = await transfer(app, resolved[assetId]!.url);
      expect(file.status).toBe(200);
      expect((await sharp(file.body).metadata()).width).toBe(300);
      expect(Date.parse(resolved[assetId]!.expiresAt) - Date.now()).toBeGreaterThan(3_500_000);
    } finally {
      events.close();
    }
  });

  it('un PNG declarado que es HTML → 422 UNSUPPORTED_FILE y el objeto se borra', async () => {
    const { owner, project } = await setup();
    const { assetId, complete } = await upload(owner, htmlPretendingToBePng(), { projectId: project.id });
    expect(complete.statusCode).toBe(422);
    expect(complete.json().error.code).toBe('UNSUPPORTED_FILE');
    const row = await app.db.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(row.status).toBe('failed');
    expect(await testStorage.storage.head(row.storageKey)).toBeNull();
    expect(await resolve(owner, [assetId])).toEqual({});
  });

  it('una bomba de descompresión se rechaza por limitInputPixels', async () => {
    const { owner, project } = await setup();
    const { assetId, complete } = await upload(owner, decompressionBomb(), { projectId: project.id });
    expect(complete.statusCode).toBe(422);
    expect(complete.json().error.code).toBe('UNSUPPORTED_FILE');
    expect((await app.db.asset.findUniqueOrThrow({ where: { id: assetId } })).status).toBe('failed');
  });

  it('un JPEG con GPS sale sin EXIF', async () => {
    const { owner, project } = await setup();
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const { assetId, complete } = await upload(owner, input, { projectId: project.id, contentType: 'image/jpeg' });
    expect(complete.statusCode, complete.body).toBe(200);
    for (const variant of ['thumb', 'full'] as const) {
      const url = (await resolve(owner, [assetId], variant))[assetId]!.url;
      const file = await transfer(app, url);
      expect((await sharp(file.body).metadata()).exif).toBeUndefined();
    }
  });

  it('SVG rasterizado: el original pasa a PNG y el SVG desaparece', async () => {
    const { owner, project } = await setup();
    const { assetId, complete } = await upload(owner, svg(), { projectId: project.id, contentType: 'image/svg+xml' });
    expect(complete.statusCode, complete.body).toBe(200);
    expect(complete.json()).toMatchObject({ mime: 'image/png', width: 2048, height: 1024 });
    const row = await app.db.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(row.storageKey.endsWith('/original.png')).toBe(true);
    expect(await testStorage.storage.head(row.storageKey.replace(/\.png$/, '.svg'))).toBeNull();
    expect(Object.keys(complete.json().variants).sort()).toEqual(['full', 'medium', 'thumb']);
  });

  it('GIF: se usa el primer fotograma', async () => {
    const { owner, project } = await setup();
    const { complete } = await upload(owner, await gif(), { projectId: project.id, contentType: 'image/gif' });
    expect(complete.statusCode, complete.body).toBe(200);
    expect(complete.json()).toMatchObject({ mime: 'image/gif', width: 32, height: 32 });
  });

  it('deduplica por sha256 dentro del proyecto', async () => {
    const { owner, project } = await setup();
    const body = await png(40, 40, { color: '#123456' });
    const first = await upload(owner, body, { projectId: project.id });
    const second = await upload(owner, body, { projectId: project.id });
    expect(second.complete.json().id).toBe(first.assetId);
    expect(await app.db.asset.count({ where: { id: second.assetId } })).toBe(0);
  });

  it('un campo que sobra o falta para su purpose → 400', async () => {
    const { owner, project, ws } = await setup();
    const base = { fileName: 'a.png', contentType: 'image/png', size: 10 };
    const cases: unknown[] = [
      { purpose: 'avatar', projectId: project.id, ...base },
      { purpose: 'canvas', ...base },
      { purpose: 'logo', ...base },
      { purpose: 'logo', workspaceSlug: ws.slug, projectId: project.id, ...base },
      { purpose: 'canvas', projectId: project.id, ...base, contentType: 'text/html' },
      { purpose: 'canvas', projectId: project.id, ...base, size: 20 * 1024 * 1024 + 1 },
      { purpose: 'avatar', ...base, size: 2 * 1024 * 1024 + 1 },
      { purpose: 'canvas', projectId: project.id, ...base, fileName: 'x'.repeat(121) },
      { purpose: 'otro', projectId: project.id, ...base },
    ];
    for (const body of cases) {
      const response = await api(app, owner, 'POST', '/v1/assets/uploads', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('permisos de subida: lector no sube al lienzo pero sí al chat; logo exige admin', async () => {
    const { owner, project, ws } = await setup();
    const viewer = await registerVerified(app);
    const member = await registerVerified(app);
    await addProjectMember(app, project.id, viewer.id, 'viewer');
    await addOrgMember(app, ws.id, member, 'member');
    const base = { fileName: 'a.png', contentType: 'image/png', size: 10 };
    expect((await api(app, viewer, 'POST', '/v1/assets/uploads', { purpose: 'canvas', projectId: project.id, ...base })).statusCode).toBe(403);
    expect((await api(app, viewer, 'POST', '/v1/assets/uploads', { purpose: 'chat', projectId: project.id, ...base })).statusCode).toBe(201);
    expect((await api(app, member, 'POST', '/v1/assets/uploads', { purpose: 'logo', workspaceSlug: ws.slug, ...base })).statusCode).toBe(403);
    expect((await api(app, owner, 'POST', '/v1/assets/uploads', { purpose: 'logo', workspaceSlug: ws.slug, ...base })).statusCode).toBe(201);
    const stranger = await registerVerified(app);
    expect((await api(app, stranger, 'POST', '/v1/assets/uploads', { purpose: 'canvas', projectId: project.id, ...base })).statusCode).toBe(404);
  });

  it('solo quien subió completa la subida', async () => {
    const { owner, project } = await setup();
    const other = await registerVerified(app);
    const created = await api(app, owner, 'POST', '/v1/assets/uploads', {
      purpose: 'canvas',
      projectId: project.id,
      fileName: 'a.png',
      contentType: 'image/png',
      size: 10,
    });
    const assetId = created.json().assetId;
    expect((await api(app, other, 'POST', `/v1/assets/uploads/${assetId}/complete`)).statusCode).toBe(404);
    const notUploaded = await api(app, owner, 'POST', `/v1/assets/uploads/${assetId}/complete`);
    expect(notUploaded.statusCode).toBe(400);
    expect(notUploaded.json().error.details.reason).toBe('not_uploaded');
  });

  it('avatar: subida con sesión, clave u-{userId} y utilizable en PATCH /me', async () => {
    const user = await registerVerified(app);
    const { assetId, complete } = await upload(user, await png(64, 64), { purpose: 'avatar' });
    expect(complete.statusCode, complete.body).toBe(200);
    const row = await app.db.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(row.storageKey.startsWith(`a/u-${user.id}/${assetId}/`)).toBe(true);
    expect(row).toMatchObject({ source: 'avatar', projectId: null, organizationId: null });
    const me = await api(app, user, 'PATCH', '/v1/me', { avatarAssetId: assetId });
    expect(me.statusCode).toBe(200);
  });

  it('límite de 60 subidas por hora y usuario', async () => {
    const { owner, project } = await setup();
    const body = { purpose: 'canvas', projectId: project.id, fileName: 'a.png', contentType: 'image/png', size: 10 };
    for (let i = 0; i < 60; i++) {
      const response = await api(app, owner, 'POST', '/v1/assets/uploads', body);
      expect(response.statusCode, `subida ${i + 1}`).toBe(201);
    }
    const limited = await api(app, owner, 'POST', '/v1/assets/uploads', body);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe.runIf(kind === 'local')('driver local: PUT /content y /files/*', () => {
  it('rechaza más bytes de los declarados con 413', async () => {
    const { owner, project } = await setup();
    const created = await api(app, owner, 'POST', '/v1/assets/uploads', {
      purpose: 'canvas',
      projectId: project.id,
      fileName: 'a.png',
      contentType: 'image/png',
      size: 10,
    });
    const target = created.json().upload;
    const response = await uploadTo(app, target, Buffer.alloc(11));
    expect(response.status).toBe(413);
    const row = await app.db.asset.findUniqueOrThrow({ where: { id: created.json().assetId } });
    expect(await testStorage.storage.head(row.storageKey)).toBeNull();
  });

  it('/files/* no se sirve con la firma caducada o alterada y lleva las cabeceras de seguridad', async () => {
    const { owner, project } = await setup();
    const { assetId } = await upload(owner, await png(20, 20), { projectId: project.id });
    const row = await app.db.asset.findUniqueOrThrow({ where: { id: assetId } });
    const key = (row.variants as { thumb: { key: string } }).thumb.key;

    const ok = await transfer(app, await testStorage.storage.createDownloadUrl(key, { expiresIn: 60 }));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/^image\//);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['content-security-policy']).toBe("default-src 'none'");
    expect(ok.headers['content-disposition']).toBe('inline');
    expect(ok.headers['cache-control']).toBe('private, max-age=3600');
    expect(ok.headers.etag).toBeTruthy();

    const url = new URL(await testStorage.storage.createDownloadUrl(key, { expiresIn: 60 }));
    url.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 10));
    expect((await transfer(app, url.toString())).status).toBe(403);

    const expired = await testStorage.storage.createDownloadUrl(key, { expiresIn: 1 });
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect((await transfer(app, expired)).status).toBe(403);

    const noSig = await app.inject({ url: `/v1/files/${key}` });
    expect(noSig.statusCode).toBe(403);
  });
});

describe(`resolve: una prueba por fila de la tabla (${kind})`, () => {
  async function readyAsset(data: {
    ownerId: string;
    source: 'upload' | 'avatar' | 'logo' | 'template' | 'preview';
    projectId?: string;
    organizationId?: string;
    templateId?: string;
    status?: 'ready' | 'pending';
    deletedAt?: Date;
  }) {
    const id = randomUUID();
    const scope = data.source === 'avatar' ? `u-${data.ownerId}` : (data.organizationId ?? 'parcify');
    const key = assetKey(scope, id, 'thumb', 'webp');
    await testStorage.storage.put(key, await sharp(await png(8, 8)).webp().toBuffer(), { contentType: 'image/webp' });
    await app.db.asset.create({
      data: {
        id,
        ownerId: data.ownerId,
        source: data.source,
        status: data.status ?? 'ready',
        projectId: data.projectId ?? null,
        organizationId: data.organizationId ?? null,
        templateId: data.templateId ?? null,
        deletedAt: data.deletedAt ?? null,
        storageKey: assetKey(scope, id, 'original', 'png'),
        mime: 'image/png',
        sizeBytes: 10,
        variants: { thumb: { key, w: 8, h: 8 }, full: { key, w: 8, h: 8 } },
      },
    });
    return id;
  }

  it('asset de proyecto: lo resuelve quien ve el proyecto', async () => {
    const { owner, ws, project } = await setup();
    const member = await registerVerified(app);
    const blocked = await registerVerified(app);
    const guest = await registerVerified(app);
    const stranger = await registerVerified(app);
    await addOrgMember(app, ws.id, member, 'member');
    await addOrgMember(app, ws.id, blocked, 'member');
    await addProjectMember(app, project.id, guest.id, 'viewer');
    const hidden = await createProjectRow(app, ws.id, owner.id, { orgAccess: 'none' });

    const visible = await readyAsset({ ownerId: owner.id, source: 'upload', projectId: project.id, organizationId: ws.id });
    const inHidden = await readyAsset({ ownerId: owner.id, source: 'upload', projectId: hidden.id, organizationId: ws.id });
    const pending = await readyAsset({ ownerId: owner.id, source: 'upload', projectId: project.id, organizationId: ws.id, status: 'pending' });
    const deleted = await readyAsset({ ownerId: owner.id, source: 'upload', projectId: project.id, organizationId: ws.id, deletedAt: new Date() });
    const ids = [visible, inHidden, pending, deleted];

    expect(Object.keys(await resolve(owner, ids)).sort()).toEqual([visible, inHidden].sort());
    expect(Object.keys(await resolve(member, ids))).toEqual([visible]);
    expect(Object.keys(await resolve(guest, ids))).toEqual([visible]);
    expect(Object.keys(await resolve(stranger, ids))).toEqual([]);
    expect(blocked).toBeTruthy();

    const url = (await resolve(guest, [visible]))[visible]!.url;
    expect((await transfer(app, url)).status).toBe(200);
  });

  it('avatar: su dueño, quien comparte espacio y quien comparte proyecto', async () => {
    const { owner, ws, project } = await setup();
    const colleague = await registerVerified(app);
    const guest = await registerVerified(app);
    const stranger = await registerVerified(app);
    await addOrgMember(app, ws.id, colleague, 'member');
    await addProjectMember(app, project.id, guest.id, 'viewer');

    const ownerAvatar = await readyAsset({ ownerId: owner.id, source: 'avatar' });
    const guestAvatar = await readyAsset({ ownerId: guest.id, source: 'avatar' });
    const strangerAvatar = await readyAsset({ ownerId: stranger.id, source: 'avatar' });
    const ids = [ownerAvatar, guestAvatar, strangerAvatar];

    expect(Object.keys(await resolve(owner, ids)).sort()).toEqual([ownerAvatar, guestAvatar].sort());
    expect(Object.keys(await resolve(colleague, ids)).sort()).toEqual([ownerAvatar, guestAvatar].sort());
    expect(Object.keys(await resolve(guest, ids)).sort()).toEqual([ownerAvatar, guestAvatar].sort());
    expect(Object.keys(await resolve(stranger, ids))).toEqual([strangerAvatar]);
  });

  it('logo: miembros del espacio y quien tiene acceso directo a un proyecto del espacio', async () => {
    const { owner, ws, project } = await setup();
    const member = await registerVerified(app);
    const guest = await registerVerified(app);
    const stranger = await registerVerified(app);
    await addOrgMember(app, ws.id, member, 'member');
    await addProjectMember(app, project.id, guest.id, 'viewer');
    const logo = await readyAsset({ ownerId: owner.id, source: 'logo', organizationId: ws.id });

    for (const user of [owner, member, guest]) expect(Object.keys(await resolve(user, [logo]))).toEqual([logo]);
    expect(Object.keys(await resolve(stranger, [logo]))).toEqual([]);
  });

  it('plantilla: miembros del espacio de la plantilla, o todos si es global', async () => {
    const { owner, ws } = await setup();
    const member = await registerVerified(app);
    const stranger = await registerVerified(app);
    await addOrgMember(app, ws.id, member, 'member');
    const local = await app.db.template.create({
      data: { organizationId: ws.id, name: 'Del espacio', state: new Uint8Array([0]), schemaVersion: 1 },
    });
    const global = await app.db.template.create({
      data: { organizationId: null, name: 'De Parcify', state: new Uint8Array([0]), schemaVersion: 1 },
    });
    const localAsset = await readyAsset({ ownerId: owner.id, source: 'template', templateId: local.id, organizationId: ws.id });
    try {
      const globalAsset = await readyAsset({ ownerId: owner.id, source: 'template', templateId: global.id });

      expect(Object.keys(await resolve(member, [localAsset, globalAsset])).sort()).toEqual([localAsset, globalAsset].sort());
      expect(Object.keys(await resolve(stranger, [localAsset, globalAsset]))).toEqual([globalAsset]);
    } finally {
      // Una plantilla de Parcify la ven todas las cuentas: si se queda, los e2e que usan la misma base dejan de ver un
      // espacio nuevo sin plantillas.
      await app.db.asset.deleteMany({ where: { templateId: global.id } });
      await app.db.template.delete({ where: { id: global.id } });
    }
  });

  it('valida el lote: 1–200 ids', async () => {
    const user = await registerVerified(app);
    expect((await api(app, user, 'POST', '/v1/assets/resolve', { ids: [], variant: 'thumb' })).statusCode).toBe(400);
    const ids = Array.from({ length: 201 }, () => randomUUID());
    expect((await api(app, user, 'POST', '/v1/assets/resolve', { ids, variant: 'thumb' })).statusCode).toBe(400);
    expect((await api(app, user, 'POST', '/v1/assets/resolve', { ids: ids.slice(0, 200), variant: 'thumb' })).statusCode).toBe(200);
  });
});

describe(`galería, edición, vista previa y copia (${kind})`, () => {
  it('lista la galería, renombra, oculta y borra', async () => {
    const { owner, project } = await setup();
    const viewer = await registerVerified(app);
    await addProjectMember(app, project.id, viewer.id, 'viewer');
    const a = await upload(owner, await png(10, 10, { color: '#010101' }), { projectId: project.id, purpose: 'gallery' });
    const b = await upload(owner, await png(10, 10, { color: '#020202' }), { projectId: project.id, purpose: 'gallery' });
    await upload(owner, await png(10, 10, { color: '#030303' }), { projectId: project.id, purpose: 'canvas' });

    const list = await api(app, viewer, 'GET', `/v1/projects/${project.id}/assets?limit=1`);
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toEqual([b.assetId]);
    const next = await api(app, viewer, 'GET', `/v1/projects/${project.id}/assets?limit=1&cursor=${list.json().nextCursor}`);
    expect(next.json().items.map((item: { id: string }) => item.id)).toEqual([a.assetId]);
    expect(next.json().nextCursor).toBeNull();

    expect((await api(app, viewer, 'PATCH', `/v1/assets/${a.assetId}`, { name: 'No' })).statusCode).toBe(403);
    const renamed = await api(app, owner, 'PATCH', `/v1/assets/${a.assetId}`, { name: 'Fachada', inGallery: false });
    expect(renamed.json()).toMatchObject({ name: 'Fachada', inGallery: false });

    expect((await api(app, viewer, 'DELETE', `/v1/assets/${b.assetId}`)).statusCode).toBe(403);
    expect((await api(app, owner, 'DELETE', `/v1/assets/${b.assetId}`)).statusCode).toBe(204);
    expect((await api(app, viewer, 'GET', `/v1/projects/${project.id}/assets`)).json().items).toEqual([]);
    expect(await resolve(owner, [b.assetId])).toEqual({});
    const stranger = await registerVerified(app);
    expect((await api(app, stranger, 'PATCH', `/v1/assets/${a.assetId}`, { name: 'x' })).statusCode).toBe(404);
  });

  it('descarga la variante full como archivo y el borrado avisa al proyecto', async () => {
    const { owner, project } = await setup();
    const stranger = await registerVerified(app);
    const { assetId } = await upload(owner, await png(30, 30, { color: '#0a0b0c' }), {
      projectId: project.id,
      purpose: 'gallery',
      fileName: 'Plano "final"/v2.png',
    });

    expect((await api(app, stranger, 'POST', `/v1/assets/${assetId}/download`)).statusCode).toBe(404);
    const download = await api(app, owner, 'POST', `/v1/assets/${assetId}/download`);
    expect(download.statusCode, download.body).toBe(200);
    const file = await transfer(app, download.json().url);
    expect(file.status).toBe(200);
    if (kind === 'local') {
      expect(file.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''Plano%20final%20v2\.(webp|png)$/);
    }

    const events = await subscribe([projectChannel(project.id)]);
    try {
      expect((await api(app, owner, 'DELETE', `/v1/assets/${assetId}`)).statusCode).toBe(204);
      expect(await events.waitFor((m) => m.event.type === 'asset.deleted' && m.event.assetId === assetId)).toBeDefined();
    } finally {
      events.close();
    }
    expect((await api(app, owner, 'POST', `/v1/assets/${assetId}/download`)).statusCode).toBe(404);
  });

  it('POST /projects/:id/preview fija la vista previa con un asset preview', async () => {
    const { owner, project } = await setup();
    const first = await upload(owner, await png(30, 20, { color: '#aa0000' }), { projectId: project.id, purpose: 'preview' });
    const canvas = await upload(owner, await png(30, 20, { color: '#00aa00' }), { projectId: project.id });
    expect((await api(app, owner, 'POST', `/v1/projects/${project.id}/preview`, { assetId: canvas.assetId })).json().error.code).toBe(
      'INVALID_ASSET',
    );
    expect((await api(app, owner, 'POST', `/v1/projects/${project.id}/preview`, { assetId: first.assetId })).statusCode).toBe(204);
    const second = await upload(owner, await png(30, 20, { color: '#0000aa' }), { projectId: project.id, purpose: 'preview' });
    await api(app, owner, 'POST', `/v1/projects/${project.id}/preview`, { assetId: second.assetId });
    expect((await app.db.project.findUniqueOrThrow({ where: { id: project.id } })).previewAssetId).toBe(second.assetId);
    expect((await app.db.asset.findUniqueOrThrow({ where: { id: first.assetId } })).deletedAt).toBeInstanceOf(Date);
  });

  it('POST /assets/copy copia los visibles al proyecto destino con ids nuevos', async () => {
    const { owner, ws, project } = await setup();
    const target = await createProjectRow(app, ws.id, owner.id);
    const stranger = await setup();
    const own = await upload(owner, await png(12, 12, { color: '#445566' }), { projectId: project.id, purpose: 'gallery' });
    const foreign = await upload(stranger.owner, await png(12, 12), { projectId: stranger.project.id });

    const response = await api(app, owner, 'POST', '/v1/assets/copy', {
      ids: [own.assetId, foreign.assetId],
      targetProjectId: target.id,
    });
    expect(response.statusCode, response.body).toBe(200);
    const ids = response.json().ids as Record<string, string>;
    expect(Object.keys(ids)).toEqual([own.assetId]);
    const copy = await app.db.asset.findUniqueOrThrow({ where: { id: ids[own.assetId]! } });
    expect(copy).toMatchObject({ projectId: target.id, organizationId: ws.id, status: 'ready', ownerId: owner.id });
    expect(copy.storageKey).toContain(copy.id);
    expect(await testStorage.storage.head(copy.storageKey)).not.toBeNull();
    expect(Object.keys(await resolve(owner, [copy.id]))).toEqual([copy.id]);

    const viewer = await registerVerified(app);
    await addProjectMember(app, target.id, viewer.id, 'viewer');
    await addProjectMember(app, project.id, viewer.id, 'viewer');
    expect((await api(app, viewer, 'POST', '/v1/assets/copy', { ids: [own.assetId], targetProjectId: target.id })).statusCode).toBe(403);
  });
});
