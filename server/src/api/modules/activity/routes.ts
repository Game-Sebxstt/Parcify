import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireSession } from '../../plugins/auth.js';
import {
  ActivityEventsQuerySchema,
  ActivityEventsResponseSchema,
  ActivityParamsSchema,
  ActivityRangeQuerySchema,
  ProjectActivityResponseSchema,
  WorkspaceActivityResponseSchema,
  WorkspaceParamsSchema,
} from './schemas.js';
import { projectActivity, projectEvents, workspaceActivity } from './service.js';

export const activityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/projects/:id/activity',
    {
      preHandler: requireSession,
      schema: {
        params: ActivityParamsSchema,
        querystring: ActivityRangeQuerySchema,
        response: { 200: ProjectActivityResponseSchema },
      },
    },
    async (request) => projectActivity(app.db, request.actor!, request.params.id, request.query),
  );

  app.get(
    '/projects/:id/activity/events',
    {
      preHandler: requireSession,
      schema: {
        params: ActivityParamsSchema,
        querystring: ActivityEventsQuerySchema,
        response: { 200: ActivityEventsResponseSchema },
      },
    },
    async (request) => projectEvents(app.db, request.actor!, request.params.id, request.query),
  );

  app.get(
    '/workspaces/:slug/activity',
    {
      preHandler: requireSession,
      schema: {
        params: WorkspaceParamsSchema,
        querystring: ActivityRangeQuerySchema,
        response: { 200: WorkspaceActivityResponseSchema },
      },
    },
    async (request) => workspaceActivity(app.db, request.actor!, request.params.slug, request.query),
  );
};
