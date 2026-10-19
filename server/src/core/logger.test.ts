import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { isUuid } from './ids.js';
import { loggerOptions, REDACT_PATHS, requestIdFrom } from './logger.js';

describe('logger', () => {
  it('oculta cookies, autorización, contraseñas, tokens y códigos', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[oculto]' } }, stream);
    logger.info({
      req: { headers: { cookie: 'parcify.session_token=abc', authorization: 'Bearer xyz' } },
      body: { password: 'p4ss', token: 't0k', otp: '123456' },
    });
    const output = lines.join('');
    for (const secret of ['abc', 'xyz', 'p4ss', 't0k', '123456']) expect(output).not.toContain(secret);
  });

  // Fastify en frío tarda en arrancar cuando la suite corre en paralelo.
  it('una petición real con credenciales no deja ninguna en el log', { timeout: 20_000 }, async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const config = { logLevel: 'info', nodeEnv: 'test', service: 'api', instanceId: 'test' } as const;
    const app = Fastify({ logger: { ...loggerOptions(config), stream } });
    app.post('/login', async (request) => {
      request.log.info({ headers: request.headers, body: request.body }, 'petición recibida');
      request.log.error({ req: request, context: { password: 'p4ssw0rd', headers: request.headers } }, 'error con contexto');
      return { ok: true };
    });
    const response = await app.inject({
      method: 'POST',
      url: '/login?code=c0d3-oauth&state=st4te',
      headers: { cookie: 'parcify.session_token=s3ss10n', authorization: 'Bearer b34rer' },
      payload: { email: 'ana@example.com', password: 'p4ssw0rd', token: 't0k3n', otp: '987654', user: { newPassword: 'n3wp4ss' } },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
    const output = lines.join('');
    expect(output).toContain('petición recibida');
    expect(output).toContain('/login?[oculto]');
    for (const secret of ['s3ss10n', 'b34rer', 'p4ssw0rd', 't0k3n', '987654', 'n3wp4ss', 'c0d3-oauth', 'st4te']) expect(output).not.toContain(secret);
  });

  it('reutiliza x-request-id solo si es un uuid', () => {
    const valid = '0199e2f0-8a5b-7c3d-9e4f-0123456789ab';
    expect(requestIdFrom({ headers: { 'x-request-id': valid } } as never)).toBe(valid);
    const generated = requestIdFrom({ headers: { 'x-request-id': '<script>' } } as never);
    expect(isUuid(generated)).toBe(true);
  });
});
