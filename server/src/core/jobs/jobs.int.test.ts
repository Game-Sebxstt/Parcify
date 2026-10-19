import { randomBytes, randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildTestApp } from '../../../test/helpers/app.js';
import { registerVerified } from '../../../test/helpers/auth.js';
import { seedProject, seedUser, seedWorkspace, type SeedUser } from '../../../test/helpers/collab.js';
import { testConfig } from '../../../test/helpers/env.js';
import { api, createProjectRow, createWorkspaceFor } from '../../../test/helpers/seed.js';
import { createTestStorage, type TestStorage } from '../../../test/helpers/storage.js';
import { initDocument } from '../../shared/document/init.js';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { createDb, type Db } from '../db.js';
import { uuidv7 } from '../ids.js';
import { createRedis, type Redis } from '../redis.js';
import { assetKey } from '../storage/index.js';
import { COMPACT_REQUESTED_KEY, runCompaction } from './compact.js';
import { purgeOldActivity, purgePendingAssets, runDailyPurge } from './purge.js';
import { cronLockKey, Scheduler, type JobDefinition } from './scheduler.js';

const DAY = 86_400_000;
const logger = pino({ level: 'silent' });

let db: Db;
let redis: Redis;
let testStorage: TestStorage;

beforeAll(async () => {
  const config = testConfig();
  db = createDb(config);
  redis = createRedis(config.redisUrl, { name: 'test-jobs' });
  testStorage = await createTestStorage('local');
});

afterAll(async () => {
  await db.$disconnect();
  redis.disconnect();
  await testStorage.cleanup();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ago = (ms: number) => new Date(Date.now() - ms);

describe('planificador', () => {
  function trackedJob(name: string, durationMs: number, lockTtlMs = 5_000) {
    const stats = { runs: 0, active: 0, maxActive: 0 };
    const job: JobDefinition = {
      name,
      schedule: { everyMs: 60_000 },
      lockTtlMs,
      run: async () => {
        stats.runs++;
        stats.active++;
        stats.maxActive = Math.max(stats.maxActive, stats.active);
        await sleep(durationMs);
        stats.active--;
      },
    };
    return { job, stats };
  }

  it('dos instancias no ejecutan el mismo trabajo a la vez', async () => {
    const { job, stats } = trackedJob(`prueba-${randomUUID()}`, 300);
    const a = new Scheduler({ redis, logger, owner: 'instancia-a' }, [job]);
    const b = new Scheduler({ redis, logger, owner: 'instancia-b' }, [job]);

    const results = await Promise.all([a.runNow(job.name), b.runNow(job.name), a.runNow(job.name)]);
    expect([...results].sort()).toEqual(['busy', 'locked', 'ran']);
    expect(stats).toEqual({ runs: 1, active: 0, maxActive: 1 });
    // El bloqueo se deja caducar: la otra instancia no repite la ejecución recién terminada.
    expect(await b.runNow(job.name)).toBe('locked');

    await redis.del(cronLockKey(job.name));
    expect(await b.runNow(job.name)).toBe('ran');
    expect(stats.runs).toBe(2);
    await Promise.all([a.stop(), b.stop()]);
  });

  it('el bloqueo se renueva mientras el trabajo sigue aunque dure más que su vida', async () => {
    const { job, stats } = trackedJob(`prueba-${randomUUID()}`, 2_600, 1_500);
    const a = new Scheduler({ redis, logger, owner: 'instancia-a' }, [job]);
    const b = new Scheduler({ redis, logger, owner: 'instancia-b' }, [job]);
    const first = a.runNow(job.name);
    await sleep(2_000);
    expect(await b.runNow(job.name)).toBe('locked');
    expect(await first).toBe('ran');
    expect(stats.maxActive).toBe(1);
    await Promise.all([a.stop(), b.stop()]);
  });
});

async function seedDocument(projectId: string, options: { assetRefs?: string[]; edits?: number } = {}) {
  const doc = new Y.Doc();
  initDocument(doc);
  const text = new Y.Text();
  doc.getMap(ROOT_KEYS.texts).set('nota', text);
  for (let i = 0; i < (options.edits ?? 0); i++) {
    doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, `versión ${i}`);
      doc.getMap(ROOT_KEYS.meta).set('contador', i);
    });
  }
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  await db.projectDocument.create({
    data: {
      projectId,
      state: new Uint8Array(state),
      schemaVersion: 1,
      sizeBytes: state.byteLength,
      nodeCount: 0,
      nodeCountByType: {},
      assetRefs: options.assetRefs ?? [],
    },
  });
  return state;
}

interface AssetSeed {
  ownerId: string;
  organizationId?: string | null;
  projectId?: string | null;
  templateId?: string | null;
  source?: 'upload' | 'avatar' | 'logo' | 'template';
  status?: 'pending' | 'ready';
  deletedAt?: Date | null;
  createdAt?: Date;
}

// Fila de asset con su original y una variante en el storage.
async function seedAsset(seed: AssetSeed) {
  const id = uuidv7();
  const scope = seed.organizationId ?? `u-${seed.ownerId}`;
  const original = assetKey(scope, id, 'original', 'png');
  const thumb = assetKey(scope, id, 'thumb', 'webp');
  const { storage } = testStorage;
  await storage.put(original, Buffer.from('original'), { contentType: 'image/png' });
  await storage.put(thumb, Buffer.from('thumb'), { contentType: 'image/webp' });
  await db.asset.create({
    data: {
      id,
      ownerId: seed.ownerId,
      organizationId: seed.organizationId ?? null,
      projectId: seed.projectId ?? null,
      templateId: seed.templateId ?? null,
      source: seed.source ?? 'upload',
      status: seed.status ?? 'ready',
      storageKey: original,
      mime: 'image/png',
      sizeBytes: 8,
      variants: { thumb: { key: thumb, w: 1, h: 1 } },
      deletedAt: seed.deletedAt ?? null,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    },
  });
  return { id, keys: [original, thumb] };
}

async function assetState(asset: { id: string; keys: string[] }) {
  const row = await db.asset.findUnique({ where: { id: asset.id }, select: { id: true } });
  const objects = await Promise.all(asset.keys.map((key) => testStorage.storage.head(key)));
  return { row: row !== null, objects: objects.filter(Boolean).length };
}

const KEPT = { row: true, objects: 2 };
const GONE = { row: false, objects: 0 };

function seedTemplate(organizationId: string, owner: SeedUser) {
  return db.template.create({
    data: { organizationId, name: 'Plantilla', createdById: owner.id, state: new Uint8Array([0]), schemaVersion: 1, assetRefs: [] },
  });
}

describe('purgas', () => {
  it('borra proyectos y espacios caducados con sus objetos, el avatar de una cuenta borrada y no toca assets de plantilla', async () => {
    const owner = await seedUser(db, 'Dueña');
    const workspace = await seedWorkspace(db, owner);

    const expired = await seedProject(db, workspace.id, owner);
    await db.project.update({ where: { id: expired.id }, data: { deletedAt: ago(31 * DAY) } });
    await seedDocument(expired.id);
    await db.projectVersion.create({
      data: { projectId: expired.id, kind: 'manual', state: new Uint8Array([0]), schemaVersion: 1, sizeBytes: 1, nodeCount: 0 },
    });
    const expiredAsset = await seedAsset({ ownerId: owner.id, organizationId: workspace.id, projectId: expired.id });

    const recent = await seedProject(db, workspace.id, owner);
    await db.project.update({ where: { id: recent.id }, data: { deletedAt: ago(5 * DAY) } });
    const recentAsset = await seedAsset({ ownerId: owner.id, organizationId: workspace.id, projectId: recent.id });

    // Copia de plantilla de un asset del proyecto purgado, con deletedAt antiguo: solo cae con su plantilla.
    const template = await seedTemplate(workspace.id, owner);
    const templateAsset = await seedAsset({
      ownerId: owner.id,
      organizationId: workspace.id,
      templateId: template.id,
      source: 'template',
      deletedAt: ago(40 * DAY),
    });
    const templatePending = await seedAsset({
      ownerId: owner.id,
      organizationId: workspace.id,
      templateId: template.id,
      source: 'template',
      status: 'pending',
      createdAt: ago(2 * 3_600_000),
    });

    const living = await seedProject(db, workspace.id, owner);
    const referenced = await seedAsset({
      ownerId: owner.id,
      organizationId: workspace.id,
      projectId: living.id,
      deletedAt: ago(40 * DAY),
    });
    const unreferenced = await seedAsset({
      ownerId: owner.id,
      organizationId: workspace.id,
      projectId: living.id,
      deletedAt: ago(40 * DAY),
    });
    await seedDocument(living.id, { assetRefs: [referenced.id] });

    const trashedOwner = await seedUser(db, 'Otra dueña');
    const trashedWorkspace = await seedWorkspace(db, trashedOwner);
    const inTrashedWorkspace = await seedProject(db, trashedWorkspace.id, trashedOwner);
    await seedDocument(inTrashedWorkspace.id);
    const trashedProjectAsset = await seedAsset({
      ownerId: trashedOwner.id,
      organizationId: trashedWorkspace.id,
      projectId: inTrashedWorkspace.id,
    });
    const trashedTemplate = await seedTemplate(trashedWorkspace.id, trashedOwner);
    const trashedTemplateAsset = await seedAsset({
      ownerId: trashedOwner.id,
      organizationId: trashedWorkspace.id,
      templateId: trashedTemplate.id,
      source: 'template',
    });
    const logo = await seedAsset({ ownerId: trashedOwner.id, organizationId: trashedWorkspace.id, source: 'logo' });
    await db.organization.update({ where: { id: trashedWorkspace.id }, data: { deletedAt: ago(31 * DAY) } });

    const recentWorkspace = await seedWorkspace(db, owner);
    await db.organization.update({ where: { id: recentWorkspace.id }, data: { deletedAt: ago(5 * DAY) } });

    const gone = await seedUser(db, 'Cuenta borrada');
    const oldAvatar = await seedAsset({ ownerId: gone.id, source: 'avatar', deletedAt: ago(31 * DAY) });
    const freshAvatar = await seedAsset({ ownerId: gone.id, source: 'avatar', deletedAt: ago(10 * DAY) });
    await db.user.delete({ where: { id: gone.id } });

    const summary = await runDailyPurge({ db, storage: testStorage.storage, logger });
    expect(summary.projects).toBeGreaterThanOrEqual(1);
    expect(summary.workspaces).toBeGreaterThanOrEqual(1);
    expect(summary.assets).toBeGreaterThanOrEqual(2);

    expect(await db.project.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await db.projectDocument.findUnique({ where: { projectId: expired.id } })).toBeNull();
    expect(await db.projectVersion.count({ where: { projectId: expired.id } })).toBe(0);
    expect(await assetState(expiredAsset)).toEqual(GONE);
    expect(await db.project.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await assetState(recentAsset)).toEqual(KEPT);

    expect(await db.organization.findUnique({ where: { id: trashedWorkspace.id } })).toBeNull();
    expect(await db.member.count({ where: { organizationId: trashedWorkspace.id } })).toBe(0);
    expect(await db.project.findUnique({ where: { id: inTrashedWorkspace.id } })).toBeNull();
    expect(await db.template.findUnique({ where: { id: trashedTemplate.id } })).toBeNull();
    for (const asset of [trashedProjectAsset, trashedTemplateAsset, logo]) expect(await assetState(asset)).toEqual(GONE);
    expect(await db.organization.findUnique({ where: { id: recentWorkspace.id } })).not.toBeNull();

    expect(await assetState(oldAvatar)).toEqual(GONE);
    expect(await assetState(freshAvatar)).toEqual(KEPT);
    expect(await assetState(referenced)).toEqual(KEPT);
    expect(await assetState(unreferenced)).toEqual(GONE);
    expect(await assetState(templateAsset)).toEqual(KEPT);

    await purgePendingAssets({ db, storage: testStorage.storage, logger });
    expect(await assetState(templatePending)).toEqual(KEPT);
  });

  it('borra los assets pending de más de una hora y la actividad de más de 400 días', async () => {
    const owner = await seedUser(db, 'Dueña');
    const workspace = await seedWorkspace(db, owner);
    const project = await seedProject(db, workspace.id, owner);
    const stale = await seedAsset({
      ownerId: owner.id,
      organizationId: workspace.id,
      projectId: project.id,
      status: 'pending',
      createdAt: ago(2 * 3_600_000),
    });
    const fresh = await seedAsset({ ownerId: owner.id, organizationId: workspace.id, projectId: project.id, status: 'pending' });

    await purgePendingAssets({ db, storage: testStorage.storage, logger });
    expect(await assetState(stale)).toEqual(GONE);
    expect(await assetState(fresh)).toEqual(KEPT);

    const old = await db.activityEvent.create({ data: { projectId: project.id, type: 'project.created', createdAt: ago(401 * DAY) } });
    const kept = await db.activityEvent.create({ data: { projectId: project.id, type: 'project.created', createdAt: ago(399 * DAY) } });
    expect(await purgeOldActivity(db)).toBeGreaterThanOrEqual(1);
    expect(await db.activityEvent.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.activityEvent.findUnique({ where: { id: kept.id } })).not.toBeNull();
  });
});

describe('Recompactar', () => {
  it('POST /compact lo pide (admin, 202) y la siguiente compactación lo atiende con epoch + 1 y restore_point', async () => {
    const app = await buildTestApp();
    try {
      const owner = await registerVerified(app, { name: 'Ana' });
      const ws = await createWorkspaceFor(app, owner);
      const project = await createProjectRow(app, ws.id, owner.id);
      const before = await seedDocument(project.id, { edits: 50 });

      const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/compact`);
      expect(response.statusCode, response.body).toBe(202);
      expect(response.body).toBe('');
      expect(await redis.sismember(COMPACT_REQUESTED_KEY, project.id)).toBe(1);

      const instanceId = `compactador-${randomBytes(4).toString('hex')}`;
      const summary = await runCompaction({ db, redis, logger, instanceId });
      expect(summary.compacted).toBeGreaterThanOrEqual(1);
      expect(await redis.sismember(COMPACT_REQUESTED_KEY, project.id)).toBe(0);

      const row = await db.projectDocument.findUniqueOrThrow({ where: { projectId: project.id } });
      expect(row.epoch).toBe(2);
      expect(row.sizeBytes).toBe(row.state.byteLength);
      expect(row.state.byteLength).toBeLessThan(before.byteLength);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, row.state);
      expect(doc.getMap<Y.Text>(ROOT_KEYS.texts).get('nota')?.toString()).toBe('versión 49');
      expect(doc.getMap(ROOT_KEYS.pages).size).toBe(1);

      const points = await db.projectVersion.findMany({ where: { projectId: project.id, kind: 'restore_point' } });
      expect(points).toHaveLength(1);
      expect(Buffer.from(points[0]!.state).equals(Buffer.from(before))).toBe(true);
    } finally {
      await app.close();
    }
  });
});
