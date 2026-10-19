import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { APIError } from 'better-auth/api';
import { AUTH_BASE_PATH, CLIENT_IP_HEADER, createAuth, type Auth } from '../../core/auth/index.js';
import { AppError } from '../../core/errors.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIPPED_RESPONSE_HEADERS = new Set(['set-cookie', 'content-length', 'transfer-encoding', 'connection']);

// Better Auth toma la IP solo de esta cabecera; se reescribe siempre con la que resolvió trustProxy.
export function authHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name === CLIENT_IP_HEADER) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, String(value));
  }
  headers.set(CLIENT_IP_HEADER, request.ip);
  return headers;
}

// En mutaciones se salta la caché de cookie: una sesión revocada deja de escribir al instante.
export async function requireSession(request: FastifyRequest): Promise<void> {
  const mutating = MUTATING_METHODS.has(request.method);
  let session: Awaited<ReturnType<Auth['api']['getSession']>>;
  try {
    session = await request.server.auth.api.getSession({
      headers: authHeaders(request),
      ...(mutating ? { query: { disableCookieCache: true } } : {}),
    });
  } catch (error) {
    if (error instanceof APIError) throw new AppError('UNAUTHORIZED');
    throw error;
  }
  if (!session) throw new AppError('UNAUTHORIZED');
  request.authSession = session;
  request.actor = { userId: session.user.id, sessionId: session.session.id };
}

export async function requireVerified(request: FastifyRequest): Promise<void> {
  await requireSession(request);
  if (!request.authSession?.user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED');
}

async function authRoutes(app: FastifyInstance) {
  // El cuerpo llega intacto a Better Auth, que hace su propio parseo y validación.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    handler: async (request, reply) => {
      const url = new URL(request.url, app.config.apiOrigin);
      const body = Buffer.isBuffer(request.body) && request.body.length > 0 ? request.body : undefined;
      const response = await app.auth.handler(
        new Request(url, { method: request.method, headers: authHeaders(request), body }),
      );
      reply.status(response.status);
      for (const [name, value] of response.headers) {
        if (!SKIPPED_RESPONSE_HEADERS.has(name)) reply.header(name, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });
}

export const authPlugin = fp(
  async (app) => {
    const auth = createAuth({ config: app.config, db: app.db, redis: app.redis, mailer: app.mailer, logger: app.log });
    app.decorate('auth', auth);
    app.decorateRequest('authSession', null);
    await app.register(authRoutes);
  },
  { name: 'auth', dependencies: ['config', 'prisma', 'redis', 'mailer', 'security'] },
);
