import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { COLLAB_TOKEN_TTL_SECONDS, signCollabToken, verifyCollabToken } from './collab-token.js';

const SECRET = 'collab-secret-0123456789abcdef-0123456789';
const input = { sub: 'user_1', pid: randomUUID(), role: 'editor' as const, sid: 'session_1', ep: 3 };

describe('collab-token', () => {
  it('firma y verifica los claims con caducidad de 120 s', async () => {
    const now = 1_800_000_000;
    const token = await signCollabToken(SECRET, input, now);
    const claims = await verifyCollabToken(SECRET, token, new Date((now + 10) * 1000));
    expect(claims).toEqual({ ...input, iat: now, exp: now + COLLAB_TOKEN_TTL_SECONDS });
  });

  it('rechaza un token caducado, con otra clave o con claims incompletos', async () => {
    const now = 1_800_000_000;
    const token = await signCollabToken(SECRET, input, now);
    await expect(verifyCollabToken(SECRET, token, new Date((now + 121) * 1000))).rejects.toMatchObject({
      reason: 'expired',
    });
    await expect(
      verifyCollabToken('otra-clave-0123456789abcdef-0123456789', token, new Date(now * 1000)),
    ).rejects.toMatchObject({ reason: 'bad_signature' });

    const partial = await new SignJWT({ pid: input.pid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyCollabToken(SECRET, partial, new Date(now * 1000))).rejects.toMatchObject({
      reason: 'malformed',
    });
  });

  it('no acepta otro algoritmo', async () => {
    const [header, body] = (await signCollabToken(SECRET, input)).split('.');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${body}.`;
    expect(header).toBeTruthy();
    await expect(verifyCollabToken(SECRET, none)).rejects.toMatchObject({ reason: 'malformed' });
  });
});
