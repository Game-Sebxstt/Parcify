import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError, ERROR_CATALOG, type ErrorCode } from '../../core/errors.js';
import { captureError } from '../../core/sentry.js';

type Resolved = { status: number; code: ErrorCode; message: string; details: Record<string, unknown>; level: 'info' | 'error' };

function resolved(code: ErrorCode, extra: Partial<Omit<Resolved, 'code'>> = {}): Resolved {
  return {
    status: extra.status ?? ERROR_CATALOG[code].status,
    code,
    message: extra.message ?? ERROR_CATALOG[code].message,
    details: extra.details ?? {},
    level: extra.level ?? (ERROR_CATALOG[code].status >= 500 ? 'error' : 'info'),
  };
}

function prismaCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, clientVersion } = error as { code?: unknown; clientVersion?: unknown };
  return typeof code === 'string' && /^P\d{4}$/.test(code) && typeof clientVersion === 'string' ? code : null;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

function resolve(error: FastifyError | AppError | Error): Resolved {
  if (error instanceof AppError) {
    // Los fallos de IA ya quedan en el log con la función y el modelo (core/ai/run.ts); aquí no son un error nuestro.
    const ai = error.code.startsWith('AI_') ? { level: 'info' as const } : {};
    return resolved(error.code, { status: error.statusCode, message: error.message, details: error.details ?? {}, ...ai });
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const context = (error as FastifyError).validationContext;
    const issues = error.validation.map((issue) => {
      const field = issue.instancePath.replace(/^\//, '').replace(/\//g, '.');
      return { path: [context, field].filter(Boolean).join('.'), message: issue.message ?? 'valor inválido' };
    });
    return resolved('VALIDATION_FAILED', { details: { issues } });
  }
  if (isResponseSerializationError(error)) return resolved('INTERNAL', { level: 'error' });

  const prisma = prismaCode(error);
  if (prisma === 'P2002') return resolved('CONFLICT');
  if (prisma === 'P2025') return resolved('NOT_FOUND');

  const status = (error as FastifyError).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code = STATUS_CODES[status] ?? 'VALIDATION_FAILED';
    return resolved(code);
  }
  if (status === 503) return resolved('SERVICE_UNAVAILABLE', { level: 'info' });
  return resolved('INTERNAL', { level: 'error' });
}

export function sendError(request: FastifyRequest, reply: FastifyReply, error: FastifyError | AppError | Error) {
  const result = resolve(error);
  if (result.level === 'error') {
    request.log.error({ err: error, requestId: request.id }, 'Error no controlado');
    captureError(error, { requestId: request.id, route: request.routeOptions.url ?? 'unmatched' });
  } else {
    request.log.info({ code: result.code, status: result.status }, 'Petición rechazada');
  }
  if (error instanceof AppError && error.headers) reply.headers(error.headers);
  return reply.status(result.status).send({
    error: { code: result.code, message: result.message, details: result.details, requestId: request.id },
  });
}

export const errorsPlugin = fp(
  async (app) => {
    app.setErrorHandler((error: FastifyError, request, reply) => sendError(request, reply, error));
    app.setNotFoundHandler((request, reply) => sendError(request, reply, new AppError('NOT_FOUND')));
  },
  { name: 'errors' },
);
