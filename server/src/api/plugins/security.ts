import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';
import { AppError } from '../../core/errors.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_COOKIE = /^(__Secure-)?parcify\.session_(token|data)$/;

export const securityPlugin = fp(
  async (app) => {
    const allowed = new Set(app.config.clientOrigins);

    await app.register(cookie);
    await app.register(helmet, {
      global: true,
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    });
    await app.register(cors, {
      origin: (origin, callback) => callback(null, origin !== undefined && allowed.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type'],
      maxAge: 600,
    });

    // Defensa CSRF propia: una mutación con cookie de sesión solo se acepta desde un origen del cliente.
    app.addHook('onRequest', async (request) => {
      if (!UNSAFE_METHODS.has(request.method)) return;
      const hasSession = Object.keys(request.cookies).some((name) => SESSION_COOKIE.test(name));
      if (!hasSession) return;
      const origin = request.headers.origin;
      if (!origin || !allowed.has(origin)) throw new AppError('BAD_ORIGIN');
    });
  },
  { name: 'security', dependencies: ['config'] },
);
