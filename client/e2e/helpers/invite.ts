import { expect, type APIRequestContext } from '@playwright/test';
import { clientIpHeaders } from './account.ts';
import { pollHeaders } from './mail.ts';

const API = 'http://localhost:3000';
const ORIGIN = { origin: 'http://localhost:4321' };

// Invitación real al espacio: quien administra invita por email y la otra cuenta la acepta.
export async function joinWorkspace(
  owner: APIRequestContext,
  workspaceSlug: string,
  invitee: APIRequestContext,
  email: string,
  role: 'admin' | 'member' = 'member',
) {
  const created = await owner.post(`${API}/v1/workspaces/${workspaceSlug}/invitations`, { headers: ORIGIN, data: { email, role } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  const accepted = await invitee.post(`${API}/v1/workspace-invitations/${id}/accept`, { headers: clientIpHeaders() });
  expect(accepted.ok(), await accepted.text()).toBe(true);
}

// Crea un enlace de un solo uso y lo acepta la otra cuenta. Devuelve la URL con el token.
export async function joinProjectByLink(
  owner: APIRequestContext,
  projectId: string,
  invitee: APIRequestContext,
  role: 'editor' | 'viewer' = 'editor',
): Promise<string> {
  const created = await owner.post(`${API}/v1/projects/${projectId}/share-links`, {
    headers: ORIGIN,
    data: { role, expiresInDays: 1, maxUses: 1 },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { url } = (await created.json()) as { url: string };
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('t');
  expect(token).toBeTruthy();
  const accepted = await invitee.post(`${API}/v1/share-links/accept`, { headers: clientIpHeaders(), data: { token } });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  return url;
}

// Enlace de invitación al espacio tal como llega en el correo.
export async function readWorkspaceInviteLink(request: APIRequestContext, to: string): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(`${API}/v1/__test/mail`, { params: { to }, headers: pollHeaders() });
        const { messages } = (await response.json()) as { messages: Array<{ subject: string; text: string }> };
        const mail = messages.filter((item) => /te invitó a .+ en Parcify/.test(item.subject)).at(-1);
        link = mail?.text.match(/https?:\/\/\S+\/invitacion\?espacio=[A-Za-z0-9_-]+/)?.[0] ?? null;
        return link;
      },
      { timeout: 15_000 },
    )
    .not.toBeNull();
  return link!;
}
