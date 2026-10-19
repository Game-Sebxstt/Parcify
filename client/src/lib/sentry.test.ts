import type { ErrorEvent } from '@sentry/browser';
import { describe, expect, it } from 'vitest';
import { initSentry, scrubEvent } from './sentry.ts';

describe('sentry', () => {
  it('no envía cookies, cabeceras, cuerpos, query ni el token del fragmento', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://parcify.app/invitacion?ref=x#t=t0k3n',
        cookies: { 'parcify.session_token': 's3ss10n' },
        data: '{"password":"p4ssw0rd"}',
        headers: { 'User-Agent': 'Test', Referer: 'https://parcify.app/app?code=c0d3', Cookie: 'a=s3ss10n' },
      },
      user: { id: 'u1', email: 'ana@example.com' },
      breadcrumbs: [
        { category: 'navigation', data: { from: '/app', to: '/invitacion#t=t0k3n' } },
        { category: 'fetch', data: { url: 'https://api.parcify.app/v1/share-links/inspect?x=c0d3', method: 'POST', 'http.query': 'x=c0d3' } },
      ],
    } as unknown as ErrorEvent;
    const scrubbed = scrubEvent(event);
    const text = JSON.stringify(scrubbed);
    for (const secret of ['t0k3n', 's3ss10n', 'p4ssw0rd', 'c0d3', 'ana@example.com']) expect(text).not.toContain(secret);
    expect(scrubbed.request?.url).toBe('https://parcify.app/invitacion');
    expect(scrubbed.request?.headers).toEqual({ 'User-Agent': 'Test' });
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({ from: '/app', to: '/invitacion' });
  });

  it('sin PUBLIC_SENTRY_DSN no arranca', async () => {
    expect(await initSentry()).toBe(false);
  });
});
