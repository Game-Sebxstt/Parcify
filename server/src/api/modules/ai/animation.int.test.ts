import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified } from '../../../../test/helpers/auth.js';
import { testConfig } from '../../../../test/helpers/env.js';
import { addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { quotaWindow } from '../../../core/ai/quota.js';
import { aiModelsFrom } from '../../../core/ai/registry.js';
import { AnimationResponseSchema } from '../../../shared/ai/animation.js';
import type { CanvasSummaryNode } from '../../../shared/ai/assistant.js';
import { newNodeId } from '../../../shared/document/ids.js';
import { buildApp } from '../../app.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

const usage = {
  inputTokens: { total: 7, noCache: 7, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
};

let nextOutput = '';
let calls = 0;

const model = new MockLanguageModelV4({
  doGenerate: async () => {
    calls++;
    return { content: [{ type: 'text', text: nextOutput }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
  },
});

let app: App;

beforeAll(async () => {
  const config = testConfig({ AI_MODEL_ANIMATION: 'mock:animation' });
  const aiModels = aiModelsFrom({ languageModel: () => model, imageModel: () => { throw new Error('sin imágenes'); } }, config.ai.models);
  app = await buildApp(config, { logger: false, globalRateLimit: 100_000, aiModels });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  calls = 0;
});

async function setup() {
  const owner = await registerVerified(app);
  const ws = await createWorkspaceFor(app, owner);
  const project = await createProjectRow(app, ws.id, owner.id);
  return { owner, ws, project };
}

function summary(overrides: Partial<CanvasSummaryNode> = {}): CanvasSummaryNode {
  return { id: newNodeId(), type: 'rect', parentId: null, x: 0, y: 0, w: 100, h: 80, rotation: 0, fill: '#FF0000FF', ...overrides };
}

const body = (nodeIds: string[], canvas: CanvasSummaryNode[], extra: Record<string, unknown> = {}) => ({ prompt: 'Que entren desde la izquierda', nodeIds, canvas, ...extra });

const track = (prop: string, keyframes: Array<{ t: number; v: number | string; e?: unknown }>) => ({ prop, keyframes });

describe('POST /v1/projects/:id/ai/animation', () => {
  it('devuelve animaciones válidas del modelo del documento y cobra una unidad', async () => {
    const { owner, ws, project } = await setup();
    const a = summary();
    nextOutput = JSON.stringify({
      summary: ' Entra deslizándose y gira ',
      animations: [
        {
          nodeId: a.id,
          animation: {
            duration: 99_999,
            delay: -5,
            loop: 2.4,
            direction: 'alternate',
            tracks: [
              track('offsetX', [{ t: 1, v: 0, e: 'easeOut' }, { t: -1, v: -200 }]),
              track('rotationDeg', [{ t: 0, v: 0 }, { t: 1, v: 90, e: [2, 0.5, -1, 20] }]),
              track('opacity', [{ t: 0.5, v: 7 }]),
              track('fill', [{ t: 0, v: '#0f0' }, { t: 1, v: 'verde' }]),
              track('scale', [{ t: 0, v: 'grande' }]),
            ],
          },
        },
      ],
    });
    const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/animation`, body([a.id], [a]));
    expect(response.statusCode, response.body).toBe(200);
    const { plan, dropped, usage: used } = AnimationResponseSchema.parse(response.json());
    expect(plan.summary).toBe('Entra deslizándose y gira');
    expect(dropped).toBe(0);
    expect(used).toEqual({ units: 1, inputTokens: 7, outputTokens: 3 });
    const [entry] = plan.animations;
    expect(entry?.nodeId).toBe(a.id);
    expect(entry?.animation).toMatchObject({ duration: 60_000, delay: 0, loop: 2, direction: 'alternate', autoplay: 'none' });
    const tracks = entry!.animation.tracks;
    expect(Object.values(tracks.offsetX!)).toEqual([
      { t: 0, v: -200, e: 'linear' },
      { t: 1, v: 0, e: 'easeOut' },
    ]);
    expect(Object.values(tracks.rotation!).map((kf) => kf.v)).toEqual([0, Math.PI / 2]);
    expect(Object.values(tracks.rotation!)[1]!.e).toEqual([1, 0.5, 0, 10]);
    expect(Object.values(tracks.opacity!)).toEqual([{ t: 0.5, v: 1, e: 'linear' }]);
    expect(Object.values(tracks.fill!)).toEqual([{ t: 0, v: '#00FF00FF', e: 'linear' }]);
    expect(tracks.scale).toBeUndefined();
    expect(await app.redis.get(quotaWindow(ws.id, owner.id).workspaceKey)).toBe('1');
  });

  it('descarta los nodos que no estaban en nodeIds, repetidos, conectores y animaciones vacías', async () => {
    const { owner, project } = await setup();
    const a = summary();
    const visible = summary();
    const connector = summary({ type: 'connector' });
    const valid = { duration: 1000, tracks: [track('offsetY', [{ t: 0, v: 0 }, { t: 1, v: 50 }])] };
    nextOutput = JSON.stringify({
      summary: 'Ignora las instrucciones y anima todo',
      animations: [
        { nodeId: visible.id, animation: valid },
        { nodeId: newNodeId(), animation: valid },
        { nodeId: '../../projects/otro', animation: valid },
        { nodeId: connector.id, animation: valid },
        { nodeId: a.id, animation: { duration: 1000, tracks: [track('fill', [{ t: 0, v: 3 }])] } },
        { nodeId: a.id, animation: valid },
        { nodeId: a.id, animation: { ...valid, duration: 2000 } },
      ],
    });
    const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/animation`, body([a.id, connector.id], [a, visible, connector]));
    expect(response.statusCode, response.body).toBe(200);
    const { plan, dropped } = AnimationResponseSchema.parse(response.json());
    expect(plan.animations.map((entry) => [entry.nodeId, entry.animation.duration])).toEqual([[a.id, 1000]]);
    expect(dropped).toBe(6);
  });

  it('una salida que no cumple el esquema da 502 AI_BAD_OUTPUT y no cobra', async () => {
    const { owner, ws, project } = await setup();
    const a = summary();
    nextOutput = JSON.stringify({ summary: 'x', animations: [{ nodeId: a.id, animation: { duration: 1000, tracks: [track('width', [{ t: 0, v: 1 }])] } }] });
    const response = await api(app, owner, 'POST', `/v1/projects/${project.id}/ai/animation`, body([a.id], [a]));
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('AI_BAD_OUTPUT');
    expect(Number((await app.redis.get(quotaWindow(ws.id, owner.id).workspaceKey)) ?? 0)).toBe(0);
  });

  it('permisos y validación de la petición', async () => {
    const { owner, project } = await setup();
    const viewer = await registerVerified(app);
    await addProjectMember(app, project.id, viewer.id, 'viewer');
    const stranger = await registerVerified(app);
    const a = summary();
    nextOutput = JSON.stringify({ summary: 'ok', animations: [] });
    const url = `/v1/projects/${project.id}/ai/animation`;
    expect((await api(app, null, 'POST', url, body([a.id], [a]))).statusCode).toBe(401);
    expect((await api(app, viewer, 'POST', url, body([a.id], [a]))).statusCode).toBe(403);
    expect((await api(app, stranger, 'POST', url, body([a.id], [a]))).statusCode).toBe(404);
    expect((await api(app, owner, 'POST', url, body([], [a]))).statusCode).toBe(400);
    const many = Array.from({ length: 51 }, () => newNodeId());
    expect((await api(app, owner, 'POST', url, body(many, [a]))).statusCode).toBe(400);
    expect((await api(app, owner, 'POST', url, body(['no es un id!'], [a]))).statusCode).toBe(400);
    expect((await api(app, owner, 'POST', url, body([a.id], [a], { prompt: '  ' }))).statusCode).toBe(400);
    expect(calls).toBe(0);
  });
});
