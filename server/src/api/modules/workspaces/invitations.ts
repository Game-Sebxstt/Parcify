import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { takeRateSlots } from '../../../core/rate-limit.js';
import { authHeaders, requireSession, requireVerified } from '../../plugins/auth.js';
import {
  AcceptInvitationResponseSchema,
  CreateWorkspaceInvitationBodySchema,
  InvitationParamsSchema,
  ReceivedInvitationSchema,
  WorkspaceInvitationListResponseSchema,
  WorkspaceInvitationParamsSchema,
  WorkspaceInvitationSchema,
  WorkspaceParamsSchema,
} from './schemas.js';
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  getReceivedInvitation,
  listInvitations,
  rejectInvitation,
  type WorkspaceDeps,
} from './service.js';

export const RECEIVED_INVITATION_LIMITS = { perUser: 20, perIp: 60, windowMs: 3_600_000 };

// GET, accept y reject de una invitación recibida comparten el cupo.
async function receivedInvitationRateLimit(request: FastifyRequest): Promise<void> {
  const { perUser, perIp, windowMs } = RECEIVED_INVITATION_LIMITS;
  await takeRateSlots(request.server.redis, [
    { key: `ws-invitation:u:${request.actor!.userId}`, max: perUser, windowMs },
    { key: `ws-invitation:ip:${request.ip}`, max: perIp, windowMs },
  ]);
}

export const workspaceInvitationRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: WorkspaceDeps = { db: app.db, redis: app.redis, auth: app.auth, logger: app.log };

  app.get(
    '/workspaces/:slug/invitations',
    {
      preHandler: requireSession,
      schema: { params: WorkspaceParamsSchema, response: { 200: WorkspaceInvitationListResponseSchema } },
    },
    async (request) => listInvitations(deps, request.actor!, request.params.slug),
  );

  app.post(
    '/workspaces/:slug/invitations',
    {
      preHandler: requireVerified,
      schema: {
        params: WorkspaceParamsSchema,
        body: CreateWorkspaceInvitationBodySchema,
        response: { 201: WorkspaceInvitationSchema },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await createInvitation(deps, request.actor!, authHeaders(request), request.params.slug, request.body)),
  );

  app.delete(
    '/workspaces/:slug/invitations/:invitationId',
    { preHandler: requireSession, schema: { params: WorkspaceInvitationParamsSchema } },
    async (request, reply) => {
      await cancelInvitation(deps, request.actor!, authHeaders(request), request.params.slug, request.params.invitationId);
      return reply.status(204).send();
    },
  );

  app.get(
    '/workspace-invitations/:invitationId',
    {
      preHandler: [requireVerified, receivedInvitationRateLimit],
      schema: { params: InvitationParamsSchema, response: { 200: ReceivedInvitationSchema } },
    },
    async (request) => getReceivedInvitation(deps, request.actor!, request.params.invitationId),
  );

  app.post(
    '/workspace-invitations/:invitationId/accept',
    {
      preHandler: [requireVerified, receivedInvitationRateLimit],
      schema: { params: InvitationParamsSchema, response: { 200: AcceptInvitationResponseSchema } },
    },
    async (request) => acceptInvitation(deps, request.actor!, authHeaders(request), request.params.invitationId),
  );

  app.post(
    '/workspace-invitations/:invitationId/reject',
    { preHandler: [requireVerified, receivedInvitationRateLimit], schema: { params: InvitationParamsSchema } },
    async (request, reply) => {
      await rejectInvitation(deps, request.actor!, authHeaders(request), request.params.invitationId);
      return reply.status(204).send();
    },
  );
};
