import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ProjectMemberParamsSchema,
  ProjectMemberSchema,
  ProjectMembersResponseSchema,
  ProjectParamsSchema,
  PutProjectMemberBodySchema,
} from '../../../shared/api/projects.js';
import { requireSession } from '../../plugins/auth.js';
import { deleteProjectMember, listProjectMembers, putProjectMember, type MemberDeps } from './service.js';

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: MemberDeps = { db: app.db, redis: app.redis, logger: app.log };

  app.get(
    '/projects/:id/members',
    { preHandler: requireSession, schema: { params: ProjectParamsSchema, response: { 200: ProjectMembersResponseSchema } } },
    async (request) => listProjectMembers(deps, request.actor!, request.params.id),
  );

  app.put(
    '/projects/:id/members/:userId',
    {
      preHandler: requireSession,
      schema: { params: ProjectMemberParamsSchema, body: PutProjectMemberBodySchema, response: { 200: ProjectMemberSchema } },
    },
    async (request) =>
      putProjectMember(deps, request.actor!, request.params.id, request.params.userId, request.body.role),
  );

  app.delete(
    '/projects/:id/members/:userId',
    { preHandler: requireSession, schema: { params: ProjectMemberParamsSchema } },
    async (request, reply) => {
      await deleteProjectMember(deps, request.actor!, request.params.id, request.params.userId);
      return reply.status(204).send();
    },
  );
};
