import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';

type Node = { id: string; type: string; w: number; h: number };
const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const shapes = async (page: Page) => (await nodes(page)).map((node) => ({ type: node.type, w: node.w, h: node.h }));

async function waitForEditor(page: Page) {
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('publicar como plantilla, me gusta, favorita y crear proyectos desde la galería y desde el diálogo', async ({ page }) => {
  test.setTimeout(120_000);
  const ana = await createVerifiedAccount(page.request, `templates-${test.info().project.name}`, 'Ana Plantillas');

  // El espacio empieza sin plantillas.
  await page.goto(`/app/e/${ana.workspaceSlug}?vista=plantillas`);
  await expect(page.getByText('Este espacio aún no tiene plantillas.')).toBeVisible();

  const sourceId = await createProject(page.request, ana.workspaceSlug, 'Cartel de origen');
  await page.goto(`/p/${sourceId}`);
  await waitForEditor(page);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, { x: box.x + 80, y: box.y + 80 }, { x: box.x + 200, y: box.y + 160 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const original = await shapes(page);

  await page.getByRole('button', { name: 'Publicar como plantilla' }).click();
  const publish = page.getByRole('dialog', { name: 'Publicar como plantilla' });
  await publish.getByRole('textbox', { name: 'Nombre de la plantilla' }).fill('Cartel base');
  await publish.getByRole('textbox', { name: 'Descripción (opcional)' }).fill('Un rectángulo para empezar.');
  await publish.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(publish).toHaveCount(0);
  await expect(page.getByText(/^Plantilla publicada en /)).toBeVisible();

  await page.goto(`/app/e/${ana.workspaceSlug}?vista=plantillas`);
  const gallery = page.getByRole('list', { name: 'Plantillas' });
  const title = gallery.getByRole('button', { name: 'Cartel base', exact: true });
  await expect(title).toBeVisible();

  // El contador sale del servidor.
  const like = gallery.getByRole('button', { name: /^Me gusta en Cartel base/ });
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect(like).toHaveAccessibleName('Me gusta en Cartel base (1)');
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await expect(like).toHaveAccessibleName('Me gusta en Cartel base (0)');

  await gallery.getByRole('button', { name: 'Marcar Cartel base como favorita' }).click();
  await page.getByRole('radiogroup', { name: 'Mostrar' }).getByRole('radio', { name: 'Favoritas', exact: true }).click();
  await expect(title).toBeVisible();

  // Vista previa grande y «Usar plantilla».
  await title.click();
  const preview = page.getByRole('dialog', { name: 'Cartel base' });
  await expect(preview.getByText('Un rectángulo para empezar.')).toBeVisible();
  await preview.getByRole('button', { name: 'Usar plantilla', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toContain(sourceId);
  await waitForEditor(page);
  await expect.poll(() => shapes(page)).toEqual(original);
  await expect(page.getByRole('textbox', { name: 'Nombre del proyecto' })).toHaveValue('Cartel base');

  // Desde el diálogo de nuevo proyecto, con el nombre escrito.
  await page.goto(`/app/e/${ana.workspaceSlug}`);
  await page.getByRole('button', { name: 'Nuevo proyecto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear un proyecto' });
  await expect(dialog.getByRole('button', { name: 'Proyecto en blanco' })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Nombre del proyecto' }).fill('Segundo cartel');
  await dialog.getByRole('button', { name: 'Usar la plantilla Cartel base' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await waitForEditor(page);
  await expect.poll(() => shapes(page)).toEqual(original);
  await expect(page.getByRole('textbox', { name: 'Nombre del proyecto' })).toHaveValue('Segundo cartel');
});
