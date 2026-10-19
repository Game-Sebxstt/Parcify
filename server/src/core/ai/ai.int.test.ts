import { APICallError, generateText, Output } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { buildTestApp } from '../../../test/helpers/app.js';
import { registerVerified, type TestUser } from '../../../test/helpers/auth.js';
import { testConfig } from '../../../test/helpers/env.js';
import { api, createProjectRow, createWorkspaceFor } from '../../../test/helpers/seed.js';
import { buildApp } from '../../api/app.js';
import { aiRateLimit } from '../../api/plugins/ai.js';
import { requireSession } from '../../api/plugins/auth.js';
import { utcDay } from '../activity.js';
import { MOCK_AI_TEXT, MOCK_AI_USAGE } from './mock.js';
import { quotaWindow } from './quota.js';
import { AI_RATE_LIMIT, aiRateKey, takeAiSlot } from './rate.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

const USER_DAILY = 3;
const PlanSchema = z.object({ summary: z.string(), ops: z.array(z.unknown()) });

let app: App;

beforeAll(async () => {
  app = await buildApp(
    testConfig({ AI_MODEL_ASSISTANT: 'mock:assistant', AI_QUOTA_USER_DAILY_UNITS: String(USER_DAILY) }),
    { logger: false, globalRateLimit: 100_000 },
  );
  // Ruta mínima para ver la respuesta HTTP de la cuota y del límite por minuto.
  app.post('/v1/__ai-probe/:projectId', { preHandler: [requireSession, aiRateLimit] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = await app.db.project.findUniqueOrThrow({ where: { id: projectId } });
    return app.ai.run({
      feature: 'assistant',
      organizationId: project.organizationId,
      projectId,
      userId: request.actor!.userId,
      units: 1,
      promptLength: 4,
      call: async () => ({ value: { ok: true } }),
    });
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function setup() {
  const owner = await registerVerified(app);
  const ws = await createWorkspaceFor(app, owner);
  const project = await createProjectRow(app, ws.id, owner.id);
  return { owner, ws, project };
}

function base(owner: TestUser, ws: { id: string }, project: { id: string }) {
  return { feature: 'assistant' as const, organizationId: ws.id, projectId: project.id, userId: owner.id, units: 1, promptLength: 20 };
}

async function counters(organizationId: string, userId: string) {
  const window = quotaWindow(organizationId, userId);
  const [workspace, user] = await app.redis.mget(window.workspaceKey, window.userKey);
  return { workspace: Number(workspace ?? 0), user: Number(user ?? 0) };
}

function failingModel(error: Error) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}

describe('ejecución de IA con cuota', () => {
  it('con el modelo simulado cobra, guarda AiUsage y suma aiActions', async () => {
    const { owner, ws, project } = await setup();
    const plan = await app.ai.run({
      ...base(owner, ws, project),
      call: async (abortSignal) => {
        const result = await generateText({
          model: app.ai.models.languageModel('assistant'),
          prompt: 'haz algo',
          output: Output.object({ schema: PlanSchema }),
          abortSignal,
        });
        return { value: result.output, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
      },
    });
    expect(plan).toEqual(JSON.parse(MOCK_AI_TEXT.assistant));
    expect(await counters(ws.id, owner.id)).toEqual({ workspace: 1, user: 1 });

    const usage = await app.db.aiUsage.findMany({ where: { organizationId: ws.id } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      status: 'ok',
      units: 1,
      feature: 'assistant',
      model: 'mock:assistant',
      inputTokens: MOCK_AI_USAGE.inputTokens,
      outputTokens: MOCK_AI_USAGE.outputTokens,
    });
    const daily = await app.db.activityDaily.findUniqueOrThrow({
      where: {
        projectId_userId_day: { projectId: project.id, userId: owner.id, day: new Date(`${utcDay(new Date())}T00:00:00Z`) },
      },
    });
    expect(daily.aiActions).toBe(1);
  });

  it('un error del proveedor devuelve las unidades y queda registrado sin cobro', async () => {
    const { owner, ws, project } = await setup();
    const providerError = new APICallError({
      message: 'caído',
      url: 'https://provider.example.com',
      requestBodyValues: {},
      statusCode: 500,
      isRetryable: false,
    });
    await expect(
      app.ai.run({
        ...base(owner, ws, project),
        call: async (abortSignal) => {
          await generateText({ model: failingModel(providerError), prompt: 'x', maxRetries: 0, abortSignal });
          return { value: null };
        },
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', statusCode: 502 });
    expect(await counters(ws.id, owner.id)).toEqual({ workspace: 0, user: 0 });
    const usage = await app.db.aiUsage.findFirstOrThrow({ where: { organizationId: ws.id } });
    expect(usage).toMatchObject({ status: 'error', units: 0 });
    expect(await app.db.activityDaily.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('una salida que no cumple el esquema da 502 AI_BAD_OUTPUT, no cobra y no llega a aplicarse', async () => {
    const { owner, ws, project } = await setup();
    let applied = false;
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: '{"summary":5,"ops":"borra todo"}' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    await expect(
      app.ai.run({
        ...base(owner, ws, project),
        call: async (abortSignal) => {
          const result = await generateText({ model, prompt: 'x', output: Output.object({ schema: PlanSchema }), abortSignal });
          applied = true;
          return { value: result.output };
        },
      }),
    ).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT', statusCode: 502 });
    expect(applied).toBe(false);
    expect(await counters(ws.id, owner.id)).toEqual({ workspace: 0, user: 0 });
  });

  it('el tope de tiempo da 504 AI_TIMEOUT y devuelve las unidades', async () => {
    const { owner, ws, project } = await setup();
    await expect(
      app.ai.run({
        ...base(owner, ws, project),
        timeoutMs: 50,
        call: (signal) =>
          new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
      }),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT', statusCode: 504 });
    expect(await counters(ws.id, owner.id)).toEqual({ workspace: 0, user: 0 });
  });

  it('la cuota diaria del usuario responde 429 AI_QUOTA_EXCEEDED con scope y resetsAt', async () => {
    const { owner, ws, project } = await setup();
    for (let i = 0; i < USER_DAILY; i++) {
      const ok = await api(app, owner, 'POST', `/v1/__ai-probe/${project.id}`, {});
      expect(ok.statusCode, ok.body).toBe(200);
    }
    const rejected = await api(app, owner, 'POST', `/v1/__ai-probe/${project.id}`, {});
    expect(rejected.statusCode).toBe(429);
    const now = new Date();
    expect(rejected.json().error).toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
      details: {
        scope: 'user',
        resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(),
      },
    });
    expect(await counters(ws.id, owner.id)).toEqual({ workspace: USER_DAILY, user: USER_DAILY });
    expect(await app.db.aiUsage.count({ where: { organizationId: ws.id, status: 'rejected', units: 0 } })).toBe(1);
  });

  it('WorkspaceAiQuota sustituye los valores por defecto y corta por espacio', async () => {
    const { owner, ws, project } = await setup();
    await app.db.workspaceAiQuota.create({ data: { organizationId: ws.id, monthlyUnits: 2, perUserDailyUnits: 50 } });
    await app.ai.run({ ...base(owner, ws, project), units: 2, call: async () => ({ value: 1 }) });
    const now = new Date();
    await expect(app.ai.run({ ...base(owner, ws, project), call: async () => ({ value: 1 }) })).rejects.toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
      details: {
        scope: 'workspace',
        resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      },
    });
  });

  it('devuelve las unidades que no se usaron', async () => {
    const { owner, ws, project } = await setup();
    await app.db.workspaceAiQuota.create({ data: { organizationId: ws.id, perUserDailyUnits: 50 } });
    await app.ai.run({ ...base(owner, ws, project), feature: 'image', units: 16, call: async () => ({ value: 1, units: 4, images: 1 }) });
    expect(await counters(ws.id, owner.id)).toEqual({ workspace: 4, user: 4 });
    expect(await app.db.aiUsage.findFirstOrThrow({ where: { organizationId: ws.id } })).toMatchObject({ units: 4, images: 1 });
  });

  it('si Redis pierde los contadores, se reconstruyen desde AiUsage', async () => {
    const { owner, ws, project } = await setup();
    await app.ai.run({ ...base(owner, ws, project), units: 2, call: async () => ({ value: 1 }) });
    const window = quotaWindow(ws.id, owner.id);
    await app.redis.del(window.workspaceKey, window.userKey);

    await app.ai.run({ ...base(owner, ws, project), call: async () => ({ value: 1 }) });
    expect(await counters(ws.id, owner.id)).toEqual({ workspace: 3, user: 3 });
    await expect(app.ai.run({ ...base(owner, ws, project), call: async () => ({ value: 1 }) })).rejects.toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
      details: { scope: 'user' },
    });
  });

  it('limita a 10 peticiones de IA por minuto y usuario', async () => {
    const owner = await registerVerified(app);
    for (let i = 0; i < AI_RATE_LIMIT; i++) await takeAiSlot(app.redis, owner.id);
    await expect(takeAiSlot(app.redis, owner.id)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(await app.redis.pttl(aiRateKey(owner.id))).toBeGreaterThan(0);

    const { project } = await setup();
    const response = await api(app, owner, 'POST', `/v1/__ai-probe/${project.id}`, {});
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
  });
});
