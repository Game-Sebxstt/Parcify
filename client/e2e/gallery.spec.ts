import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { solidPng } from './helpers/image.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string; assetId?: string };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const images = (page: Page) => page.evaluate(() => window.__parcifyTest!.images());

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

test('galería: subir, ver, descargar, insertar y borrar deja el marcador de imagen rota', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const label = `gallery-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Galería');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Galería');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Galería');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  await page.getByRole('button', { name: 'Galería', exact: true }).click();
  const galleryWindow = page.getByRole('dialog', { name: 'Galería' });
  await expect(galleryWindow).toHaveAttribute('aria-modal', 'false');
  const panel = galleryWindow.getByTestId('gallery-panel');
  await expect(panel.getByText('Aún no hay imágenes en la galería.', { exact: false })).toBeVisible();
  await panel.getByTestId('gallery-input').setInputFiles({ name: 'Plano.png', mimeType: 'image/png', buffer: solidPng(200, [30, 160, 90]) });
  const item = panel.getByRole('button', { name: 'Ver Plano.png' });
  await expect(item).toBeVisible({ timeout: 30_000 });

  await item.click();
  const preview = page.getByRole('dialog', { name: 'Plano.png' });
  await expect(preview.getByTestId('gallery-preview')).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByText('200 × 200 px')).toBeVisible();

  const download = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Descargar' }).click();
  expect((await download).suggestedFilename()).toMatch(/^Plano\.(webp|png)$/);

  await preview.getByRole('button', { name: 'Insertar en el lienzo' }).click();
  await expect(preview).toBeHidden();
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'image').length).toBe(1);
  const image = (await nodes(page)).find((node) => node.type === 'image')!;
  await expect.poll(async () => (await images(page))[image.id], { timeout: 30_000 }).toBe('ready');
  await expect.poll(async () => (await images(bea))[image.id], { timeout: 30_000 }).toBe('ready');

  await item.click();
  await preview.getByRole('button', { name: 'Borrar' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Borrar «Plano.png» de la galería?' });
  await confirm.getByRole('button', { name: 'Borrar' }).click();
  await expect(item).toBeHidden();

  // El nodo sigue en el documento y los dos lo pintan como imagen rota.
  await expect.poll(async () => (await images(page))[image.id], { timeout: 15_000 }).toBe('broken');
  await expect.poll(async () => (await images(bea))[image.id], { timeout: 15_000 }).toBe('broken');
  expect((await nodes(bea)).some((node) => node.id === image.id)).toBe(true);

  // Tras recargar sigue rota: el servidor ya no resuelve el asset.
  await openEditor(bea, projectId);
  await expect.poll(async () => (await images(bea))[image.id], { timeout: 15_000 }).toBe('broken');

  await otherContext.close();
});
