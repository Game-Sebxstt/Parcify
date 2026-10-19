import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { takeRateSlots } from '../../../core/rate-limit.js';
import { requireSession, requireVerified } from '../../plugins/auth.js';
import { perUserRateLimit } from '../../plugins/rate-limit.js';
import {
  CreatedShareLinkSchema,
  CreateShareLinkBodySchema,
  ProjectInvitationBodySchema,
  ProjectInvitationResponseSchema,
  ProjectParamsSchema,
  ShareLinkAcceptResponseSchema,
  ShareLinkInspectSchema,
  ShareLinkListResponseSchema,
  ShareLinkParamsSchema,
  ShareTokenBodySchema,
} from './schemas.js';
import {
  acceptShareLink,
  createShareLink,
  inspectShareLink,
  inviteToProject,
  listShareLinks,
  revokeShareLink,
  type ShareLinkDeps,
} from './service.js';

const HOUR_MS = 3_600_000;
export const SHARE_TOKEN_LIMITS = { perUser: 20, perIp: 60, windowMs: HOUR_MS };
// Cada invitación por email puede enviar un correo.
const PROJECT_INVITATIONS_PER_DAY = 50;

// inspect y accept comparten el cupo; cuenta toda petición con token, también las fallidas.
async function shareTokenRateLimit(request: FastifyRequest): Promise<void> {
  const { perUser, perIp, windowMs } = SHARE_TOKEN_LIMITS;
  await takeRateSlots(request.server.redis, [
    { key: `share-token:u:${request.actor!.userId}`, max: perUser, windowMs },
    { key: `share-token:ip:${request.ip}`, max: perIp, windowMs },
  ]);
}

export const shareLinkRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps: ShareLinkDeps = {
    db: app.db,
    redis: app.redis,
    mailer: app.mailer,
    logger: app.log,
    clientOrigin: app.config.clientOrigins[0]!,
  };

  app.get(
    '/projects/:id/share-links',
    { preHandler: requireSession, schema: { params: ProjectParamsSchema, response: { 200: ShareLinkListResponseSchema } } },
    async (request) => listShareLinks(deps, request.actor!, request.params.id),
  );

  app.post(
    '/projects/:id/share-links',
    {
      preHandler: requireSession,
      schema: { params: ProjectParamsSchema, body: CreateShareLinkBodySchema, response: { 201: CreatedShareLinkSchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await createShareLink(deps, request.actor!, request.params.id, request.body)),
  );

  app.delete(
    '/projects/:id/share-links/:linkId',
    { preHandler: requireSession, schema: { params: ShareLinkParamsSchema } },
    async (request, reply) => {
      await revokeShareLink(deps, request.actor!, request.params.id, request.params.linkId);
      return reply.status(204).send();
    },
  );

  app.post(
    '/projects/:id/invitations',
    {
      preHandler: requireSession,
      config: { rateLimit: perUserRateLimit(PROJECT_INVITATIONS_PER_DAY, 24 * HOUR_MS) },
      schema: { params: ProjectParamsSchema, body: ProjectInvitationBodySchema, response: { 200: ProjectInvitationResponseSchema } },
    },
    async (request) => inviteToProject(deps, request.actor!, request.params.id, request.body),
  );

  app.post(
    '/share-links/inspect',
    {
      preHandler: [requireSession, shareTokenRateLimit],
      schema: { body: ShareTokenBodySchema, response: { 200: ShareLinkInspectSchema } },
    },
    async (request) => inspectShareLink(deps, request.actor!, request.body.token),
  );

  app.post(
    '/share-links/accept',
    {
      preHandler: [requireVerified, shareTokenRateLimit],
      schema: { body: ShareTokenBodySchema, response: { 200: ShareLinkAcceptResponseSchema } },
    },
    async (request) => acceptShareLink(deps, request.actor!, request.body.token),
  );
};
