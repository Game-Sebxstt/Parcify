import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { DEFAULT_USER_DAILY_UNITS, DEFAULT_WORKSPACE_MONTHLY_UNITS, type QuotaDefaults } from '../../core/ai/quota.js';
import { AiJobs } from '../../core/ai/jobs.js';
import { takeAiSlot } from '../../core/ai/rate.js';
import { createAiModels, type AiModels } from '../../core/ai/registry.js';
import {
  beginAiAction,
  runAiAction,
  type AiActionHandle,
  type AiActionInput,
  type AiDeps,
  type AiRunInput,
} from '../../core/ai/run.js';
import type { AiFeature } from '../../core/config.js';
import { AppError } from '../../core/errors.js';

export interface AiService {
  models: AiModels;
  defaults: QuotaDefaults;
  deps: AiDeps;
  run<T>(input: AiRunInput<T>): Promise<T>;
  begin(input: AiActionInput): Promise<AiActionHandle>;
  // Generaciones de imágenes en segundo plano de esta instancia.
  jobs: AiJobs;
}

// Va después de requireSession: 10 por minuto y usuario entre todas las rutas de IA.
export async function aiRateLimit(request: FastifyRequest): Promise<void> {
  if (!request.actor) throw new AppError('UNAUTHORIZED');
  await takeAiSlot(request.server.redis, request.actor.userId);
}

// Una función sin modelo configurado no existe para el cliente.
export function requireAiFeature(feature: AiFeature) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.server.ai.models.enabled(feature)) throw new AppError('NOT_FOUND');
  };
}

export const aiPlugin = fp<{ models?: AiModels }>(
  async (app, options) => {
    const models = options.models ?? (await createAiModels(app.config));
    const defaults: QuotaDefaults = {
      workspaceMonthlyUnits: app.config.ai.quotaWorkspaceMonthlyUnits ?? DEFAULT_WORKSPACE_MONTHLY_UNITS,
      userDailyUnits: app.config.ai.quotaUserDailyUnits ?? DEFAULT_USER_DAILY_UNITS,
    };
    const deps: AiDeps = { db: app.db, redis: app.redis, logger: app.log, models, defaults };
    const service: AiService = {
      models,
      defaults,
      deps,
      run: (input) => runAiAction(deps, input),
      begin: (input) => beginAiAction(deps, input),
      jobs: new AiJobs({ redis: app.redis, logger: app.log }),
    };
    app.decorate('ai', service);
    app.addHook('onClose', async () => service.jobs.close());
  },
  { name: 'ai', dependencies: ['config', 'prisma', 'redis'] },
);
