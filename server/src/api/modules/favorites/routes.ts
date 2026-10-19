import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { FavoriteParamsSchema } from '../../../shared/api/projects.js';
import { requireSession } from '../../plugins/auth.js';
import { addFavorite, removeFavorite } from './service.js';

export const favoriteRoutes: FastifyPluginAsyncZod = async (app) => {
  app.put(
    '/favorites/:type/:id',
    { preHandler: requireSession, schema: { params: FavoriteParamsSchema } },
    async (request, reply) => {
      await addFavorite(app.db, request.actor!, request.params.type, request.params.id);
      return reply.status(204).send();
    },
  );

  app.delete(
    '/favorites/:type/:id',
    { preHandler: requireSession, schema: { params: FavoriteParamsSchema } },
    async (request, reply) => {
      await removeFavorite(app.db, request.actor!, request.params.type, request.params.id);
      return reply.status(204).send();
    },
  );
};
