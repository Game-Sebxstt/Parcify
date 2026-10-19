import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../test/helpers/app.js';
import { PRODUCTION_OVERRIDES } from '../../test/helpers/env.js';
import { createRedis } from '../core/redis.js';
import { ErrorResponseSchema } from '../shared/api/errors.js';
import { MetaResponseSchema } from '../shared/api/meta.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

const CLIENT = 'http://localhost:4321';

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

describe('salud', () => {
  it('/health y /ready responden 200 con Postgres y Redis arriba', async () => {
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    const ready = await app.inject({ url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('/ready responde 503 si Redis no responde', async () => {
    const deadRedis = createRedis('redis://127.0.0.1:1/0', { name: 'muerto', commandTimeout: 300 });
    deadRedis.on('error', () => {});
    const broken = await buildTestApp({}, { redis: deadRedis });
    try {
      const response = await broken.inject({ url: '/ready' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable', checks: { postgres: 'ok', redis: 'fail' } });
    } finally {
      await broken.close();
      deadRedis.disconnect();
    }
  });
});

describe('formato de error', () => {
  it('incluye código, mensaje, detalles y el requestId de la cabecera', async () => {
    const response = await app.inject({ url: '/v1/no-existe' });
    expect(response.statusCode).toBe(404);
    const body = ErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('reutiliza un x-request-id uuid válido', async () => {
    const id = randomUUID();
    const response = await app.inject({ url: '/v1/no-existe', headers: { 'x-request-id': id } });
    expect(response.headers['x-request-id']).toBe(id);
    expect(response.json().error.requestId).toBe(id);
  });

  it('400 VALIDATION_FAILED con details.issues', async () => {
    const response = await app.inject({ url: '/v1/__test/mail?to=no-es-email' });
    expect(response.statusCode).toBe(400);
    const body = ErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('VALIDATION_FAILED');
    const issues = body.error.details.issues as Array<{ path: string; message: string }>;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.path).toBe('querystring.to');
  });
});

describe('origen y CORS', () => {
  it('403 BAD_ORIGIN en un POST con cookie de sesión desde un origen no listado', async () => {
    for (const origin of ['https://evil.example', undefined]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/meta',
        headers: { cookie: 'parcify.session_token=abc', ...(origin ? { origin } : {}) },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('BAD_ORIGIN');
    }
  });

  it('no aplica BAD_ORIGIN desde el cliente ni sin cookie de sesión', async () => {
    const fromClient = await app.inject({
      method: 'POST',
      url: '/v1/meta',
      headers: { cookie: 'parcify.session_token=abc', origin: CLIENT },
    });
    expect(fromClient.json().error.code).toBe('NOT_FOUND');
    const noCookie = await app.inject({ method: 'POST', url: '/v1/meta', headers: { origin: 'https://evil.example' } });
    expect(noCookie.json().error.code).toBe('NOT_FOUND');
  });

  it('CORS refleja solo los orígenes listados, sin comodines', async () => {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/v1/meta',
      headers: { origin: CLIENT, 'access-control-request-method': 'POST' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(CLIENT);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(String(allowed.headers['access-control-allow-methods'])).not.toContain('*');

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/v1/meta',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const simple = await app.inject({ url: '/v1/meta', headers: { origin: 'https://evil.example' } });
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limit', () => {
  it('429 RATE_LIMITED con Retry-After al superar el límite global', async () => {
    const limited = await buildTestApp({}, { globalRateLimit: 2 });
    const remoteAddress = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
    try {
      for (let i = 0; i < 2; i++) {
        expect((await limited.inject({ url: '/v1/meta', remoteAddress })).statusCode).toBe(200);
      }
      const response = await limited.inject({ url: '/v1/meta', remoteAddress });
      expect(response.statusCode).toBe(429);
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      expect(response.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});

describe('métricas', () => {
  it('/metrics exige el token', async () => {
    expect((await app.inject({ url: '/metrics' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/metrics', headers: { authorization: 'Bearer otro-token-cualquiera' } })).statusCode).toBe(
      401,
    );
    await app.inject({ url: '/v1/meta' });
    const ok = await app.inject({ url: '/metrics', headers: { authorization: 'Bearer metrics-token-0123456789' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body).toMatch(/http_request_duration_seconds_count\{[^}]*route="\/v1\/meta"[^}]*status_code="200"/);
    for (const name of ['ai_usage_total', 'images_processing_running{', 'images_processing_queued{', 'process_cpu_seconds_total']) {
      expect(ok.body).toContain(name);
    }
    expect(ok.body).toMatch(/images_processing_queued\{[^}]*queue="assets"[^}]*\} 0/);
  });
});

describe('/v1/meta', () => {
  it('no contiene campos fuera del esquema', async () => {
    const response = await app.inject({ url: '/v1/meta' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(MetaResponseSchema.strict().safeParse(body).success).toBe(true);
    expect(body.authProviders).toEqual(['email']);
  });

  it('anuncia Google solo si está configurado', async () => {
    const withGoogle = await buildTestApp({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secreto' });
    try {
      expect((await withGoogle.inject({ url: '/v1/meta' })).json().authProviders).toEqual(['email', 'google']);
    } finally {
      await withGoogle.close();
    }
  });
});

describe('/v1/__test/mail', () => {
  it('expone el buzón memory en pruebas', async () => {
    const to = `ana-${randomUUID()}@example.com`;
    await app.mailer.send({ to, subject: 'Hola', text: 'texto', html: '<p>texto</p>' });
    const response = await app.inject({ url: `/v1/__test/mail?to=${encodeURIComponent(to)}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().messages).toHaveLength(1);
  });

  it('responde 404 con NODE_ENV=production', async () => {
    const prod = await buildTestApp(PRODUCTION_OVERRIDES);
    try {
      const response = await prod.inject({ url: '/v1/__test/mail?to=a@example.com' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    } finally {
      await prod.close();
    }
  });

  it('responde 404 en desarrollo con el driver console', async () => {
    const dev = await buildTestApp({ NODE_ENV: 'development', MAIL_DRIVER: 'console' });
    try {
      expect((await dev.inject({ url: '/v1/__test/mail?to=a@example.com' })).statusCode).toBe(404);
    } finally {
      await dev.close();
    }
  });
});
