import { expect, type APIRequestContext } from '@playwright/test';
import { readCode, VERIFY_SUBJECT } from './mail.ts';

const API = 'http://localhost:3000';
const ORIGIN = { origin: 'http://localhost:4321' };

// El servidor de e2e confía en un proxy (TRUST_PROXY_HOPS=1): cada cuenta llega desde una IP distinta
// y los límites de Better Auth por IP no se comparten entre pruebas.
export function clientIpHeaders() {
  const part = () => 1 + Math.floor(Math.random() * 254);
  return { ...ORIGIN, 'x-forwarded-for': `10.${part()}.${part()}.${part()}` };
}

// Crea una cuenta verificada por la API; las cookies quedan en el contexto de `request` (usar page.request).
export async function createVerifiedAccount(request: APIRequestContext, label: string, name = 'Ana Lienzo') {
  const email = `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const headers = clientIpHeaders();
  const signUp = await request.post(`${API}/api/auth/sign-up/email`, {
    headers,
    data: { name, email, password: 'clave-de-prueba-1' },
  });
  expect(signUp.ok(), await signUp.text()).toBe(true);
  const code = await readCode(request, email, VERIFY_SUBJECT);
  const verify = await request.post(`${API}/api/auth/email-otp/verify-email`, { headers, data: { email, otp: code } });
  expect(verify.ok(), await verify.text()).toBe(true);
  const me = await request.get(`${API}/v1/me`);
  expect(me.ok()).toBe(true);
  const body = (await me.json()) as { user: { id: string }; workspaces: Array<{ slug: string; personal: boolean }> };
  const personal = body.workspaces.find((workspace) => workspace.personal);
  if (!personal) throw new Error('La cuenta no tiene espacio personal');
  return { email, name, userId: body.user.id, workspaceSlug: personal.slug, headers };
}

export async function createProject(request: APIRequestContext, workspaceSlug: string, name = 'Lienzo de prueba'): Promise<string> {
  const response = await request.post(`${API}/v1/workspaces/${workspaceSlug}/projects`, { headers: ORIGIN, data: { name } });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}
