import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authHeaders, requireSession, requireVerified } from '../../plugins/auth.js';
import {
  CreateWorkspaceBodySchema,
  UpdateWorkspaceBodySchema,
  UpdateWorkspaceMemberBodySchema,
  WorkspaceDetailSchema,
  WorkspaceListResponseSchema,
  WorkspaceMemberParamsSchema,
  WorkspaceMemberSchema,
  WorkspaceMembersQuerySchema,
  WorkspaceMembersResponseSchema,
  WorkspaceParamsSchema,
} from './schemas.js';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  restoreWorkspace,
  updateMember,
  updateWorkspace,
  type WorkspaceDeps,
} from './service.js';

export const workspaceRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: WorkspaceDeps = { db: app.db, redis: app.redis, auth: app.auth, logger: app.log };

  app.get(
    '/workspaces',
    { preHandler: requireSession, schema: { response: { 200: WorkspaceListResponseSchema } } },
    async (request) => listWorkspaces(deps, request.actor!),
  );

  app.post(
    '/workspaces',
    { preHandler: requireVerified, schema: { body: CreateWorkspaceBodySchema, response: { 201: WorkspaceDetailSchema } } },
    async (request, reply) =>
      reply.status(201).send(await createWorkspace(deps, request.actor!, authHeaders(request), request.body)),
  );

  app.get(
    '/workspaces/:slug',
    { preHandler: requireSession, schema: { params: WorkspaceParamsSchema, response: { 200: WorkspaceDetailSchema } } },
    async (request) => getWorkspace(deps, request.actor!, request.params.slug),
  );

  app.patch(
    '/workspaces/:slug',
    {
      preHandler: requireSession,
      schema: { params: WorkspaceParamsSchema, body: UpdateWorkspaceBodySchema, response: { 200: WorkspaceDetailSchema } },
    },
    async (request) => updateWorkspace(deps, request.actor!, request.params.slug, request.body),
  );

  app.delete(
    '/workspaces/:slug',
    { preHandler: requireSession, schema: { params: WorkspaceParamsSchema } },
    async (request, reply) => {
      await deleteWorkspace(deps, request.actor!, request.params.slug);
      return reply.status(204).send();
    },
  );

  app.post(
    '/workspaces/:slug/restore',
    { preHandler: requireSession, schema: { params: WorkspaceParamsSchema, response: { 200: WorkspaceDetailSchema } } },
    async (request) => restoreWorkspace(deps, request.actor!, request.params.slug),
  );

  app.get(
    '/workspaces/:slug/members',
    {
      preHandler: requireSession,
      schema: {
        params: WorkspaceParamsSchema,
        querystring: WorkspaceMembersQuerySchema,
        response: { 200: WorkspaceMembersResponseSchema },
      },
    },
    async (request) => listMembers(deps, request.actor!, request.params.slug, request.query),
  );

  app.patch(
    '/workspaces/:slug/members/:memberId',
    {
      preHandler: requireSession,
      schema: {
        params: WorkspaceMemberParamsSchema,
        body: UpdateWorkspaceMemberBodySchema,
        response: { 200: WorkspaceMemberSchema },
      },
    },
    async (request) =>
      updateMember(
        deps,
        request.actor!,
        authHeaders(request),
        request.params.slug,
        request.params.memberId,
        request.body,
      ),
  );

  app.delete(
    '/workspaces/:slug/members/:memberId',
    { preHandler: requireSession, schema: { params: WorkspaceMemberParamsSchema } },
    async (request, reply) => {
      await removeMember(deps, request.actor!, authHeaders(request), request.params.slug, request.params.memberId);
      return reply.status(204).send();
    },
  );
};
