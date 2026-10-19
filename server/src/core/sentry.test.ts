import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { captureError, initSentry, scrubBreadcrumb, scrubEvent } from './sentry.js';

describe('sentry', () => {
  it('quita cookies, credenciales, cuerpos y query antes de enviar', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://api.parcify.app/api/auth/callback/google?code=c0d3&state=st4te',
        method: 'POST',
        cookies: { 'parcify.session_token': 's3ss10n' },
        data: { password: 'p4ssw0rd' },
        query_string: 'code=c0d3',
        headers: { cookie: 'a=s3ss10n', Authorization: 'Bearer b34rer', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Test' },
      },
      user: { id: 'u1', email: 'ana@example.com', ip_address: '203.0.113.9' },
      breadcrumbs: [{ category: 'http', data: { url: 'https://generativelanguage.googleapis.com/v1/models?key=k3y', 'http.query': 'key=k3y', method: 'GET' } }],
    } as unknown as ErrorEvent;
    const scrubbed = scrubEvent(event);
    const text = JSON.stringify(scrubbed);
    for (const secret of ['s3ss10n', 'b34rer', 'p4ssw0rd', 'c0d3', 'st4te', 'k3y', 'ana@example.com', '203.0.113.9']) expect(text).not.toContain(secret);
    expect(scrubbed.request?.url).toBe('https://api.parcify.app/api/auth/callback/google');
    expect(scrubbed.request?.headers).toEqual({ 'user-agent': 'Test' });
    expect(scrubbed.user).toEqual({ id: 'u1' });
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({ url: 'https://generativelanguage.googleapis.com/v1/models', method: 'GET' });
  });

  it('las migas sin datos pasan igual', () => {
    const breadcrumb = { category: 'console', message: 'hola' };
    expect(scrubBreadcrumb(breadcrumb)).toBe(breadcrumb);
  });

  it('sin SENTRY_DSN no arranca ni falla al capturar', async () => {
    expect(await initSentry({ sentryDsn: undefined, nodeEnv: 'test', service: 'api', instanceId: 'test' })).toBe(false);
    expect(() => captureError(new Error('x'))).not.toThrow();
  });
});
