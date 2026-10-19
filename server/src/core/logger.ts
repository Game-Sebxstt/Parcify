import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pino, type Logger, type LoggerOptions } from 'pino';
import type { Config } from './config.js';
import { isUuid } from './ids.js';

const SECRET_FIELDS = ['password', 'currentPassword', 'newPassword', 'token', 'otp', 'secret'];

// Pino no tiene comodín de profundidad libre: los campos secretos se ocultan en la raíz y hasta dos niveles más abajo.
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-parcify-client-ip"]',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
  'headers["set-cookie"]',
  '*.headers.cookie',
  '*.headers.authorization',
  ...SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

// La query puede llevar códigos de un solo uso (la vuelta de OAuth) o tokens: no se escribe.
export function safeUrl(url: string): string {
  const cut = url.indexOf('?');
  return cut === -1 ? url : `${url.slice(0, cut)}?[oculto]`;
}

type LoggedRequest = { method?: string; url?: string; host?: string; hostname?: string; ip?: string; socket?: { remoteAddress?: string } };

// Sustituye al serializador de petición de Fastify: lo mismo, sin la query.
function serializeRequest(request: LoggedRequest) {
  return {
    method: request.method,
    url: request.url === undefined ? undefined : safeUrl(request.url),
    host: request.host ?? request.hostname,
    remoteAddress: request.ip ?? request.socket?.remoteAddress,
  };
}

export type LogSink = Pick<Logger, 'fatal' | 'error' | 'warn' | 'info' | 'debug'>;

export function loggerOptions(config: Pick<Config, 'logLevel' | 'nodeEnv' | 'service' | 'instanceId'>): LoggerOptions {
  return {
    level: config.logLevel,
    base: { service: config.service, instance: config.instanceId },
    redact: { paths: REDACT_PATHS, censor: '[oculto]' },
    serializers: { req: serializeRequest },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  };
}

export function createLogger(config: Pick<Config, 'logLevel' | 'nodeEnv' | 'service' | 'instanceId'>): Logger {
  return pino(loggerOptions(config));
}

export function requestIdFrom(request: IncomingMessage): string {
  const header = request.headers['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && isUuid(value) ? value.toLowerCase() : randomUUID();
}
