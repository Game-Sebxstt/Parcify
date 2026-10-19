import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
}

const panel = (page: Page) => page.getByTestId('chat-panel');
const input = (page: Page) => panel(page).getByRole('combobox', { name: 'Mensaje' });
const messageWith = (page: Page, text: string) => panel(page).getByTestId('chat-message').filter({ hasText: text });

test('dos personas chatean en vivo: escribiendo…, respuesta, mención y recarga con el historial', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const label = `chat-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Chat');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Chat');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Chat compartido');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'viewer');
  await setOrgAccess(page.request, projectId, 'none');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  await page.getByTestId('chat-toggle').click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText('Aún no hay mensajes')).toBeVisible();

  // Con el panel cerrado, Bea ve el mensaje como no leído.
  await input(page).fill('Primero, antes de que abras');
  await input(page).press('Enter');
  await expect(messageWith(page, 'Primero, antes de que abras')).toBeVisible();
  await expect(bea.getByRole('button', { name: 'Chat, 1 sin leer' })).toBeVisible();

  await bea.getByTestId('chat-toggle').click();
  await expect(messageWith(bea, 'Primero, antes de que abras')).toBeVisible();
  await expect(bea.getByTestId('chat-unread')).toHaveCount(0);

  // «Escribiendo…» llega por la presencia y se apaga al enviar.
  await input(page).pressSequentially('Hola, Bea');
  await expect(panel(bea).getByTestId('chat-typing')).toHaveText('Ana Chat está escribiendo…');
  await input(page).press('Enter');
  await expect(messageWith(bea, 'Hola, Bea')).toBeVisible();
  await expect(panel(bea).getByTestId('chat-typing')).toHaveText('');

  // Bea (lectora) responde citando y menciona a Ana con el autocompletado.
  await messageWith(bea, 'Hola, Bea').hover();
  await messageWith(bea, 'Hola, Bea').getByRole('button', { name: 'Responder a Ana Chat' }).click();
  await expect(panel(bea).getByTestId('chat-replying')).toContainText('Hola, Bea');
  await input(bea).pressSequentially('@an');
  await panel(bea).getByRole('option', { name: 'Ana Chat' }).waitFor();
  await input(bea).press('Enter');
  await expect(input(bea)).toHaveValue('@Ana Chat ');
  await input(bea).pressSequentially('mira https://parcify.app');
  await input(bea).press('Enter');

  const reply = messageWith(page, 'mira');
  await expect(reply).toBeVisible();
  await expect(reply.getByTestId('chat-quote')).toContainText('Hola, Bea');
  await expect(reply.getByText('Te menciona.')).toHaveCount(1);
  const link = reply.getByRole('link', { name: 'https://parcify.app' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(link).toHaveAttribute('target', '_blank');

  // Al recargar, el historial sigue ahí con la cita.
  await page.reload();
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  await page.getByTestId('chat-toggle').click();
  await expect(messageWith(page, 'Primero, antes de que abras')).toBeVisible();
  // La respuesta también contiene el texto citado: el original es el primero.
  await expect(messageWith(page, 'Hola, Bea').first()).not.toContainText('mira');
  await expect(messageWith(page, 'mira').getByTestId('chat-quote')).toContainText('Hola, Bea');

  await otherContext.close();
});
