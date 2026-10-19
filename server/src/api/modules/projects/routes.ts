import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireSession } from '../../plugins/auth.js';
import { perUserRateLimit } from '../../plugins/rate-limit.js';
import { scheduleCompaction } from './compact.js';
import {
  BatchProjectsBodySchema,
  BatchProjectsResponseSchema,
  CreateProjectBodySchema,
  DuplicateProjectBodySchema,
  ListQuerySchema,
  ProjectDetailSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectParamsSchema,
  ProjectSummarySchema,
  UpdateProjectBodySchema,
  WorkspaceParamsSchema,
} from './schemas.js';
import {
  batchProjects,
  createProject,
  deleteProject,
  duplicate,
  getProject,
  listSharedProjects,
  listWorkspaceProjects,
  restoreProject,
  updateProject,
  type ProjectDeps,
} from './service.js';

const COMPACT_REQUESTS_PER_MINUTE = 5;

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: ProjectDeps = { db: app.db, redis: app.redis, storage: app.storage, logger: app.log };

  app.get(
    '/workspaces/:slug/projects',
    {
      preHandler: requireSession,
      schema: {
        params: WorkspaceParamsSchema,
        querystring: ProjectListQuerySchema,
        response: { 200: ProjectListResponseSchema },
      },
    },
    async (request) => listWorkspaceProjects(deps, request.actor!, request.params.slug, request.query),
  );

  app.post(
    '/workspaces/:slug/projects',
    {
      preHandler: requireSession,
      schema: { params: WorkspaceParamsSchema, body: CreateProjectBodySchema, response: { 201: ProjectSummarySchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await createProject(deps, request.actor!, request.params.slug, request.body)),
  );

  app.get(
    '/projects/shared',
    { preHandler: requireSession, schema: { querystring: ListQuerySchema, response: { 200: ProjectListResponseSchema } } },
    async (request) => listSharedProjects(deps, request.actor!, request.query),
  );

  app.post(
    '/projects/batch',
    { preHandler: requireSession, schema: { body: BatchProjectsBodySchema, response: { 200: BatchProjectsResponseSchema } } },
    async (request) => batchProjects(deps, request.actor!, request.body),
  );

  app.get(
    '/projects/:id',
    { preHandler: requireSession, schema: { params: ProjectParamsSchema, response: { 200: ProjectDetailSchema } } },
    async (request) => getProject(deps, request.actor!, request.params.id),
  );

  app.patch(
    '/projects/:id',
    {
      preHandler: requireSession,
      schema: { params: ProjectParamsSchema, body: UpdateProjectBodySchema, response: { 200: ProjectDetailSchema } },
    },
    async (request) => updateProject(deps, request.actor!, request.params.id, request.body),
  );

  app.delete('/projects/:id', { preHandler: requireSession, schema: { params: ProjectParamsSchema } }, async (request, reply) => {
    await deleteProject(deps, request.actor!, request.params.id);
    return reply.status(204).send();
  });

  app.post(
    '/projects/:id/restore',
    { preHandler: requireSession, schema: { params: ProjectParamsSchema, response: { 200: ProjectSummarySchema } } },
    async (request) => restoreProject(deps, request.actor!, request.params.id),
  );

  app.post(
    '/projects/:id/compact',
    {
      preHandler: requireSession,
      config: { rateLimit: perUserRateLimit(COMPACT_REQUESTS_PER_MINUTE, 60_000) },
      schema: { params: ProjectParamsSchema },
    },
    async (request, reply) => {
      await scheduleCompaction(deps, request.actor!, request.params.id);
      return reply.status(202).send();
    },
  );

  app.post(
    '/projects/:id/duplicate',
    {
      preHandler: requireSession,
      schema: { params: ProjectParamsSchema, body: DuplicateProjectBodySchema, response: { 201: ProjectSummarySchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await duplicate(deps, request.actor!, request.params.id, request.body ?? {})),
  );
};
