import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { quotaLimits, type AiUsageFeature, type QuotaDefaults } from '../../../core/ai/quota.js';
import type { Db } from '../../../core/db.js';
import { requireWorkspace } from '../../../core/permissions.js';
import { AiUsageQuerySchema, AiUsageResponseSchema, type AiUsageResponse } from '../../../shared/api/ai.js';
import { WorkspaceParamsSchema } from '../../../shared/api/workspaces.js';
import type { Actor } from '../../types.js';
import { requireSession } from '../../plugins/auth.js';

function monthRange(month: string | undefined, now = new Date()) {
  const [year, index] = month
    ? [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1]
    : [now.getUTCFullYear(), now.getUTCMonth()];
  const from = new Date(Date.UTC(year, index, 1));
  return { label: from.toISOString().slice(0, 7), from, to: new Date(Date.UTC(year, index + 1, 1)) };
}

export async function workspaceAiUsage(
  deps: { db: Db; defaults: QuotaDefaults },
  actor: Actor,
  slug: string,
  query: z.infer<typeof AiUsageQuerySchema>,
): Promise<AiUsageResponse> {
  const access = await requireWorkspace(deps.db, actor.userId, slug, { minRole: 'admin' });
  const organizationId = access.workspace.id;
  const range = monthRange(query.month);
  const [limits, groups] = await Promise.all([
    quotaLimits(deps, organizationId),
    deps.db.aiUsage.groupBy({
      by: ['userId', 'feature'],
      where: { organizationId, status: 'ok', createdAt: { gte: range.from, lt: range.to } },
      _sum: { units: true },
      _count: { _all: true },
    }),
  ]);

  const byUser = new Map<string, { units: number; requests: number; byFeature: Record<AiUsageFeature, number> }>();
  for (const group of groups) {
    const entry = byUser.get(group.userId) ?? {
      units: 0,
      requests: 0,
      byFeature: { assistant: 0, image: 0, animation: 0, chat: 0 },
    };
    const units = group._sum.units ?? 0;
    entry.units += units;
    entry.requests += group._count._all;
    entry.byFeature[group.feature] += units;
    byUser.set(group.userId, entry);
  }
  const users = await deps.db.user.findMany({ where: { id: { in: [...byUser.keys()] } }, select: { id: true, name: true } });
  const names = new Map(users.map((user) => [user.id, user.name]));

  const rows = [...byUser.entries()]
    .map(([userId, entry]) => ({ userId, name: names.get(userId) ?? null, ...entry }))
    .sort((a, b) => b.units - a.units || a.userId.localeCompare(b.userId));
  return {
    month: range.label,
    limits,
    totalUnits: rows.reduce((sum, row) => sum + row.units, 0),
    users: rows,
  };
}

export const aiUsageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/workspaces/:slug/ai/usage',
    {
      preHandler: requireSession,
      schema: { params: WorkspaceParamsSchema, querystring: AiUsageQuerySchema, response: { 200: AiUsageResponseSchema } },
    },
    async (request) =>
      workspaceAiUsage({ db: app.db, defaults: app.ai.defaults }, request.actor!, request.params.slug, request.query),
  );
};
