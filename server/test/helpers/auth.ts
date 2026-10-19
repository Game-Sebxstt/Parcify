import { randomInt, randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import type { buildTestApp } from './app.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

export const CLIENT_ORIGIN = 'http://localhost:4321';
export const PASSWORD = 'contraseña-segura-123';

export function uniqueIp(): string {
  return `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
}

export function uniqueEmail(prefix = 'persona'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

// Tarro de cookies mínimo: guarda nombre=valor y borra las que llegan caducadas.
export class CookieJar {
  private readonly values = new Map<string, string>();

  store(response: LightMyRequestResponse): this {
    const raw = response.headers['set-cookie'];
    const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    for (const cookie of list) {
      const [pair, ...attributes] = cookie.split(';');
      const index = pair!.indexOf('=');
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      const expired = value === '' || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired) this.values.delete(name);
      else this.values.set(name, value);
    }
    return this;
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

export interface TestMail {
  to: string;
  subject: string;
  text: string;
}

export async function mailbox(app: App, to: string): Promise<TestMail[]> {
  const response = await app.inject({ url: `/v1/__test/mail?to=${encodeURIComponent(to)}` });
  return response.json().messages as TestMail[];
}

export async function waitForMail(app: App, to: string, count = 1, timeoutMs = 3_000): Promise<TestMail[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await mailbox(app, to);
    if (messages.length >= count) return messages;
    if (Date.now() > deadline) throw new Error(`No llegó el correo ${count} a ${to}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function codeFrom(mail: TestMail): string {
  const match = /\b(\d{6})\b/.exec(mail.text);
  if (!match) throw new Error('El correo no contiene un código');
  return match[1]!;
}

export function authPost(app: App, path: string, body: unknown, options: { ip: string; jar?: CookieJar; headers?: Record<string, string> }) {
  return app.inject({
    method: 'POST',
    url: `/api/auth${path}`,
    remoteAddress: options.ip,
    headers: {
      origin: CLIENT_ORIGIN,
      'content-type': 'application/json',
      ...(options.jar ? { cookie: options.jar.header() } : {}),
      ...options.headers,
    },
    payload: JSON.stringify(body),
  });
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  ip: string;
  jar: CookieJar;
}

export async function signUp(app: App, input: { email?: string; name?: string; ip?: string } = {}) {
  const email = input.email ?? uniqueEmail();
  const name = input.name ?? 'Ana Pruebas';
  const ip = input.ip ?? uniqueIp();
  const response = await authPost(app, '/sign-up/email', { email, password: PASSWORD, name }, { ip });
  return { response, email, name, ip };
}

export async function registerVerified(app: App, input: { name?: string; ip?: string } = {}): Promise<TestUser> {
  const { response, email, name, ip } = await signUp(app, input);
  if (response.statusCode !== 200) throw new Error(`Registro fallido: ${response.statusCode} ${response.body}`);
  const [mail] = await waitForMail(app, email);
  const verify = await authPost(app, '/email-otp/verify-email', { email, otp: codeFrom(mail!) }, { ip });
  if (verify.statusCode !== 200) throw new Error(`Verificación fallida: ${verify.statusCode} ${verify.body}`);
  const jar = new CookieJar().store(verify);
  return { id: verify.json().user.id as string, email, name, ip, jar };
}

export function withSession(user: TestUser, extra: Record<string, string> = {}) {
  return { cookie: user.jar.header(), origin: CLIENT_ORIGIN, ...extra };
}
