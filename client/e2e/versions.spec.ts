import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const panel = (page: Page) => page.getByTestId('versions-panel');

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

async function drawRect(page: Page, offset: number) {
  const box = (await page.getByRole('application', { name: 'Lienzo del proyecto' }).boundingBox())!;
  const from = { x: box.x + box.width / 2 - 200 + offset, y: box.y + box.height / 2 - 100 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 40, { steps: 4 });
  await page.mouse.move(from.x + 100, from.y + 80, { steps: 4 });
  await page.mouse.up();
}

test('A crea una versión, cambia el lienzo y la restaura; B ve el cambio sin recargar', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const label = `versions-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Versiones');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Versiones');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Con historial');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await setOrgAccess(page.request, projectId, 'none');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  await drawRect(page, 0);
  await expect.poll(async () => (await nodes(bea)).length).toBe(1);
  const kept = (await nodes(page))[0]!.id;

  // Versión con nombre desde el panel.
  await page.getByTestId('versions-toggle').click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: 'Crear versión con nombre' }).click();
  const nameDialog = page.getByRole('dialog', { name: 'Crear versión con nombre' });
  await nameDialog.getByLabel('Nombre de la versión').fill('Un rectángulo');
  await nameDialog.getByRole('button', { name: 'Crear versión' }).click();
  const named = panel(page).getByTestId('version-item').filter({ hasText: 'Un rectángulo' });
  await expect(named).toBeVisible();

  // Ctrl+S guarda otra sin nombre.
  await page.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await page.keyboard.press('Control+s');
  await expect(panel(page).getByTestId('version-item').filter({ hasText: 'Versión guardada' })).toHaveCount(1);

  // Se cambia el lienzo: un segundo rectángulo.
  await drawRect(page, 220);
  await expect.poll(async () => (await nodes(bea)).length).toBe(2);

  // Vista previa de solo lectura con el estado de la versión.
  await named.getByRole('button', { name: 'Vista previa de Un rectángulo' }).click();
  const previewDialog = page.getByRole('dialog', { name: 'Un rectángulo' });
  await expect(previewDialog.getByTestId('version-preview')).toHaveAttribute('data-state', 'ready');

  // Restaurar desde la vista previa, con confirmación.
  await previewDialog.getByRole('button', { name: 'Restaurar', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '¿Restaurar esta versión?' });
  await confirm.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByText('Versión restaurada.')).toBeVisible();

  await expect.poll(async () => (await nodes(bea)).map((node) => node.id)).toEqual([kept]);
  await expect.poll(async () => (await nodes(page)).map((node) => node.id)).toEqual([kept]);
  await expect(panel(page).getByTestId('version-item').filter({ hasText: 'Antes de restaurar' })).toHaveCount(1);

  await otherContext.close();
});
