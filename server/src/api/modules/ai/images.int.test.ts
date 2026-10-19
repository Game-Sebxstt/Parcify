import { MockImageModelV4, MockLanguageModelV4 } from 'ai/test';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified, type TestUser } from '../../../../test/helpers/auth.js';
import { testConfig } from '../../../../test/helpers/env.js';
import { addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { AiJobs } from '../../../core/ai/jobs.js';
import { quotaWindow } from '../../../core/ai/quota.js';
import { uuidv7 } from '../../../core/ids.js';
import { aiModelsFrom } from '../../../core/ai/registry.js';
import { AiJobSchema, type AiJob } from '../../../shared/api/ai.js';
import { buildApp } from '../../app.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

// Lo que devolverá el modelo en la siguiente llamada y, si hay puerta, la espera antes de responder.
let nextImages: Uint8Array[] = [];
let gate: Promise<void> | null = null;
let openGate: (() => void) | null = null;
let calls = 0;

const imageModel = new MockImageModelV4({
  provider: 'mock',
  modelId: 'image',
  maxImagesPerCall: 4,
  doGenerate: async () => {
    calls++;
    if (gate) await gate;
    return { images: nextImages, warnings: [], response: { timestamp: new Date(0), modelId: 'image', headers: undefined } };
  },
});

let app: App;

beforeAll(async () => {
  const config = testConfig({ AI_MODEL_IMAGE: 'mock:image' });
  const aiModels = aiModelsFrom({ languageModel: () => new MockLanguageModelV4(), imageModel: () => imageModel }, config.ai.models);
  app = await buildApp(config, { logger: false, globalRateLimit: 100_000, aiModels });
  await app.ready();
});

afterEach(async () => {
  openGate?.();
  gate = null;
  openGate = null;
  await app.ai.jobs.idle();
  calls = 0;
});

afterAll(async () => {
  await app.close();
});

async function png(seed: number): Promise<Uint8Array> {
  const buffer = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: seed % 256, g: (seed * 7) % 256, b: 90 } } })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

async function setup() {
  const owner = await registerVerified(app);
  const ws = await createWorkspaceFor(app, owner);
  const project = await createProjectRow(app, ws.id, owner.id);
  return { owner, ws, project };
}

async function units(organizationId: string, userId: string) {
  return Number((await app.redis.get(quotaWindow(organizationId, userId).workspaceKey)) ?? 0);
}

async function job(user: TestUser, jobId: string): Promise<AiJob> {
  const response = await api(app, user, 'GET', `/v1/ai/jobs/${jobId}`);
  expect(response.statusCode, response.body).toBe(200);
  return AiJobSchema.parse(response.json());
}

const body = (count = 1, prompt = 'Un faro al atardecer') => ({ prompt, count, aspect: '16:9' });

describe('POST /v1/projects/:id/ai/images', () => {
  it('guarda las imágenes como assets listos con variantes y cobra 4 unidades por imagen', async () => {
    const { owner, ws, project } = await setup();
    nextImages = [await png(1), await png(2)];
    const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/images`, body(2));
    expect(response.statusCode, response.body).toBe(202);
    const { jobId } = response.json() as { jobId: string };
    await app.ai.jobs.idle();

    const done = await job(owner, jobId);
    expect(done).toMatchObject({ status: 'done', count: 2, error: null, projectId: project.id });
    expect(done.assetIds).toHaveLength(2);
    const assets = await app.db.asset.findMany({ where: { id: { in: done.assetIds } } });
    for (const asset of assets) {
      expect(asset).toMatchObject({ source: 'ai', status: 'ready', inGallery: true, aiPrompt: 'Un faro al atardecer', width: 40, height: 30 });
      const variants = asset.variants as Record<string, { key: string }>;
      expect(Object.keys(variants)).toEqual(expect.arrayContaining(['thumb', 'full']));
      expect(await app.storage.head(asset.storageKey)).not.toBeNull();
      expect(await app.storage.head(variants.full!.key)).not.toBeNull();
    }
    expect(await units(ws.id, owner.id)).toBe(8);
    expect(await app.db.aiUsage.findFirstOrThrow({ where: { organizationId: ws.id, feature: 'image' } })).toMatchObject({ status: 'ok', units: 8, images: 2 });

    const gallery = await api(app, owner, 'GET', `/v1/projects/${project.id}/assets?source=ai`);
    expect(gallery.json().items.map((item: { id: string }) => item.id).sort()).toEqual([...done.assetIds].sort());
  });

  it('no cobra las imágenes que no se pudieron guardar', async () => {
    const { owner, ws, project } = await setup();
    nextImages = [await png(3), new TextEncoder().encode('<html>no es una imagen</html>')];
    const partial = await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/images`, body(2));
    expect(partial.statusCode).toBe(202);
    await app.ai.jobs.idle();
    const saved = await job(owner, partial.json().jobId);
    expect(saved.status).toBe('done');
    expect(saved.assetIds).toHaveLength(1);
    expect(await units(ws.id, owner.id)).toBe(4);

    nextImages = [new Uint8Array([1, 2, 3])];
    const none = await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/images`, body(1));
    await app.ai.jobs.idle();
    const failed = await job(owner, none.json().jobId);
    expect(failed).toMatchObject({ status: 'failed', assetIds: [], error: { code: 'AI_BAD_OUTPUT' } });
    expect(await units(ws.id, owner.id)).toBe(4);
    const usage = await app.db.aiUsage.findMany({ where: { organizationId: ws.id }, orderBy: { createdAt: 'asc' } });
    expect(usage.map((row) => [row.status, row.units, row.images])).toEqual([
      ['ok', 4, 1],
      ['error', 0, 0],
    ]);
  });

  it('el trabajo solo lo ve quien lo creó', async () => {
    const { owner, project } = await setup();
    const editor = await registerVerified(app);
    await addProjectMember(app, project.id, editor.id, 'editor');
    nextImages = [await png(4)];
    const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/images`, body(1));
    const { jobId } = response.json() as { jobId: string };
    await app.ai.jobs.idle();
    expect((await api(app, editor, 'GET', `/v1/ai/jobs/${jobId}`)).statusCode).toBe(404);
    expect((await api(app, null, 'GET', `/v1/ai/jobs/${jobId}`)).statusCode).toBe(401);
    expect((await api(app, owner, 'GET', '/v1/ai/jobs/0190a000-0000-7000-8000-000000000000')).statusCode).toBe(404);
    expect((await job(owner, jobId)).status).toBe('done');
  });

  it('un trabajo sin latido (el proceso cayó) se da por fallido y devuelve su reserva una sola vez', async () => {
    const { owner, ws, project } = await setup();
    nextImages = [await png(5)];
    const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/images`, body(1));
    const { jobId } = response.json() as { jobId: string };
    await app.ai.jobs.idle();
    expect(await units(ws.id, owner.id)).toBe(4);
    const key = `parcify:ai:job:${jobId}`;
    const stored = JSON.parse((await app.redis.get(key))!) as Record<string, unknown>;
    expect(stored.reservation).toMatchObject({ units: 4 });
    // Como si el proceso hubiera caído con la generación en marcha y la reserva sin cobrar ni devolver.
    await app.redis.set(key, JSON.stringify({ ...stored, status: 'running' }), 'EX', 3600);
    expect(await job(owner, jobId)).toMatchObject({ status: 'failed', error: { code: 'AI_JOB_LOST' } });
    expect(await units(ws.id, owner.id)).toBe(0);
    expect(await job(owner, jobId)).toMatchObject({ status: 'failed', error: { code: 'AI_JOB_LOST' } });
    expect(await units(ws.id, owner.id)).toBe(0);
    expect(JSON.parse((await app.redis.get(key))!)).toMatchObject({ status: 'failed' });
    expect(await app.redis.ttl(key)).toBeGreaterThan(3500);
  });

  it('al cerrar, los trabajos en cola se dan por fallidos y devuelven su reserva', async () => {
    const jobs = new AiJobs({ redis: app.redis, logger: app.log }, { concurrency: 1, queue: 1 });
    const { owner, project } = await setup();
    let finish: (() => void) | null = null;
    const blocked = new Promise<void>((resolve) => (finish = resolve));
    const reservation = { keys: ['parcify:test:none:ws', 'parcify:test:none:u'] as [string, string], units: 4 };
    const runningCancel = vi.fn(async () => undefined);
    const queuedCancel = vi.fn(async () => undefined);
    const queuedWork = vi.fn(async () => ['x']);
    const [first, second] = [uuidv7(), uuidv7()];
    await jobs.start({ jobId: first, userId: owner.id, projectId: project.id, count: 1, reservation }, jobs.admit(), async () => {
      await blocked;
      return [];
    }, runningCancel);
    await jobs.start({ jobId: second, userId: owner.id, projectId: project.id, count: 1, reservation }, jobs.admit(), queuedWork, queuedCancel);

    await jobs.close();
    expect(queuedCancel).toHaveBeenCalledTimes(1);
    expect(runningCancel).not.toHaveBeenCalled();
    expect(await job(owner, second)).toMatchObject({ status: 'failed', error: { code: 'AI_JOB_LOST' } });
    expect(() => jobs.admit()).toThrow();

    finish!();
    await jobs.idle();
    expect(queuedWork).not.toHaveBeenCalled();
    expect(queuedCancel).toHaveBeenCalledTimes(1);
  });

  it('con 2 en marcha y 20 en cola responde 503 AI_BUSY sin cobrar', async () => {
    const { owner, ws, project } = await setup();
    // El límite de 10 por minuto es por usuario: la cola se llena entre tres.
    const others = await Promise.all([registerVerified(app), registerVerified(app)]);
    for (const user of others) await addProjectMember(app, project.id, user.id, 'editor');
    const users = [owner, ...others];
    gate = new Promise<void>((resolve) => (openGate = resolve));
    nextImages = [await png(6)];

    for (let i = 0; i < 22; i++) {
      const response = await api(app, users[i % 3]!, 'POST', `/v1/projects/${project.id}/ai/images`, body(1, `imagen ${i}`));
      expect(response.statusCode, response.body).toBe(202);
    }
    expect(await units(ws.id, owner.id)).toBe(88);

    const busy = await api(app, others[1]!, 'POST', `/v1/projects/${project.id}/ai/images`, body(1));
    expect(busy.statusCode).toBe(503);
    expect(busy.json().error.code).toBe('AI_BUSY');
    expect(await units(ws.id, owner.id)).toBe(88);
    expect(calls).toBe(2);

    openGate?.();
    await app.ai.jobs.idle();
    expect(calls).toBe(22);
    // Al soltar la cola, el siguiente se acepta.
    nextImages = [await png(7)];
    expect((await api(app, others[1]!, 'POST', `/v1/projects/${project.id}/ai/images`, body(1))).statusCode).toBe(202);
  });

  it('permisos y validación', async () => {
    const { owner, project } = await setup();
    const viewer = await registerVerified(app);
    await addProjectMember(app, project.id, viewer.id, 'viewer');
    const stranger = await registerVerified(app);
    expect((await api(app, null, 'POST', `/v1/projects/${project.id}/ai/images`, body())).statusCode).toBe(401);
    expect((await api(app, viewer, 'POST', `/v1/projects/${project.id}/ai/images`, body())).statusCode).toBe(403);
    expect((await api(app, stranger, 'POST', `/v1/projects/${project.id}/ai/images`, body())).statusCode).toBe(404);
    expect((await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/images`, body(5))).statusCode).toBe(400);
    expect((await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/images`, { ...body(), aspect: '2:1' })).statusCode).toBe(400);
    // Sin URLs: un campo de más se rechaza.
    expect((await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/images`, { ...body(), url: 'http://169.254.169.254/' })).statusCode).toBe(400);
    expect(calls).toBe(0);
  });
});
