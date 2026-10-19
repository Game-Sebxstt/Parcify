import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified } from '../../../../test/helpers/auth.js';
import { addOrgMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { AiUsageResponseSchema } from '../../../shared/api/ai.js';
import { MetaResponseSchema } from '../../../shared/api/meta.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

let app: App;

beforeAll(async () => {
  app = await buildTestApp({ AI_MODEL_ASSISTANT: 'mock:assistant', AI_QUOTA_WORKSPACE_MONTHLY_UNITS: '500' });
});

afterAll(async () => {
  await app.close();
});

describe('IA: /meta y consumo del espacio', () => {
  it('una función sin modelo configurado queda desactivada en /meta', async () => {
    const meta = MetaResponseSchema.parse((await app.inject({ url: '/v1/meta' })).json());
    expect(meta.aiFeatures).toEqual({ assistant: true, animation: false, chat: false, image: false, vision: true });

    const bare = await buildTestApp();
    try {
      const none = MetaResponseSchema.parse((await bare.inject({ url: '/v1/meta' })).json());
      expect(Object.values(none.aiFeatures).every((enabled) => !enabled)).toBe(true);
    } finally {
      await bare.close();
    }
  });

  it('solo un admin del espacio ve el consumo del mes, por usuario y función', async () => {
    const owner = await registerVerified(app, { name: 'Ana' });
    const member = await registerVerified(app, { name: 'Bea' });
    const ws = await createWorkspaceFor(app, owner);
    await addOrgMember(app, ws.id, member, 'member');
    const project = await createProjectRow(app, ws.id, owner.id);
    const run = (userId: string, feature: 'assistant' | 'image', units: number) =>
      app.ai.run({
        feature,
        organizationId: ws.id,
        projectId: project.id,
        userId,
        units,
        promptLength: 1,
        call: async () => ({ value: 1 }),
      });
    await run(owner.id, 'assistant', 1);
    await run(owner.id, 'image', 8);
    await run(member.id, 'assistant', 1);
    await app.ai
      .run({
        feature: 'chat',
        organizationId: ws.id,
        projectId: project.id,
        userId: member.id,
        units: 1,
        promptLength: 1,
        call: async () => {
          throw new Error('fallo');
        },
      })
      .catch(() => undefined);

    expect((await api(app, member, 'GET', `/v1/workspaces/${ws.slug}/ai/usage`)).statusCode).toBe(403);
    const stranger = await registerVerified(app);
    expect((await api(app, stranger, 'GET', `/v1/workspaces/${ws.slug}/ai/usage`)).statusCode).toBe(404);
    expect((await api(app, null, 'GET', `/v1/workspaces/${ws.slug}/ai/usage`)).statusCode).toBe(401);

    const response = await api(app, owner, 'GET', `/v1/workspaces/${ws.slug}/ai/usage`);
    expect(response.statusCode, response.body).toBe(200);
    const usage = AiUsageResponseSchema.parse(response.json());
    expect(usage.month).toBe(new Date().toISOString().slice(0, 7));
    expect(usage.limits).toEqual({ workspaceMonthlyUnits: 500, userDailyUnits: 100 });
    expect(usage.totalUnits).toBe(10);
    expect(usage.users).toEqual([
      { userId: owner.id, name: 'Ana', units: 9, requests: 2, byFeature: { assistant: 1, image: 8, animation: 0, chat: 0 } },
      { userId: member.id, name: 'Bea', units: 1, requests: 1, byFeature: { assistant: 1, image: 0, animation: 0, chat: 0 } },
    ]);

    const past = AiUsageResponseSchema.parse((await api(app, owner, 'GET', `/v1/workspaces/${ws.slug}/ai/usage?month=2020-01`)).json());
    expect(past).toMatchObject({ month: '2020-01', totalUnits: 0, users: [] });
    expect((await api(app, owner, 'GET', `/v1/workspaces/${ws.slug}/ai/usage?month=2020-13`)).statusCode).toBe(400);

    // Las mismas acciones, en la serie de Prometheus por función y estado.
    const metrics = (await app.inject({ url: '/metrics', headers: { authorization: 'Bearer metrics-token-0123456789' } })).body;
    const count = (feature: string, status: string) => Number(new RegExp(`ai_usage_total\\{feature="${feature}",status="${status}"[^}]*\\} (\\d+)`).exec(metrics)?.[1] ?? 0);
    expect(count('assistant', 'ok')).toBe(2);
    expect(count('image', 'ok')).toBe(1);
    expect(count('chat', 'error')).toBe(1);
  });
});
