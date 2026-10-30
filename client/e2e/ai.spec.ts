import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string; name?: string; x: number };
type Animation = { duration: number; tracks: Partial<Record<string, Record<string, { t: number; v: number | string }>>> };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const animations = (page: Page) => page.evaluate(() => window.__parcifyTest!.animations() as unknown as Record<string, Animation>);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
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

test('IA: asistente con vista previa y un Ctrl+Z, chat persistente y «Convertir en cambios del lienzo»', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const label = `ai-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Asistida');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Asistida');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Lienzo con IA');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Asistente: la propuesta se ve antes de aplicarla y no toca el documento.
  await page.getByTestId('ai-toggle').click();
  const panel = page.getByTestId('ai-panel');
  await expect(panel).toBeVisible();
  await panel.getByTestId('ai-prompt').fill('Añade un rectángulo naranja');
  await panel.getByTestId('ai-submit').click();
  const preview = panel.getByTestId('ai-preview');
  await expect(preview).toBeVisible();
  await expect(preview.getByText('Plan de prueba')).toBeVisible();
  await expect(preview.getByText('Crear Rectángulo', { exact: false })).toBeVisible();
  expect(await nodes(page)).toEqual([]);

  // Aplicar escribe el rectángulo para los dos; un Ctrl+Z lo quita para los dos.
  await preview.getByTestId('ai-apply').click();
  await expect.poll(async () => (await nodes(page)).map((node) => [node.type, node.name])).toEqual([['rect', 'Rectángulo de prueba']]);
  await expect.poll(async () => (await nodes(bea)).length).toBe(1);
  await page.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await nodes(page)).length).toBe(0);
  await expect.poll(async () => (await nodes(bea)).length).toBe(0);

  // Chat: la respuesta llega en streaming desde la API (otro origen, con cookies).
  await panel.getByRole('tab', { name: 'Chat' }).click();
  const chat = panel.getByTestId('ai-chat');
  await expect(chat.getByText('Pregunta lo que quieras', { exact: false })).toBeVisible();
  await chat.getByTestId('ai-chat-input').fill('¿Qué hay en el lienzo?');
  await chat.getByTestId('ai-chat-input').press('Enter');
  await expect(chat.getByText('Respuesta de prueba.')).toBeVisible();
  await expect(chat.locator('ol').getByText('¿Qué hay en el lienzo?')).toBeVisible();

  // Tras recargar, la conversación se restaura desde el servidor.
  await openEditor(page, projectId);
  await page.getByTestId('ai-toggle').click();
  await panel.getByRole('tab', { name: 'Chat' }).click();
  await expect(chat.getByText('Respuesta de prueba.')).toBeVisible();
  await expect(chat.locator('ol').getByText('¿Qué hay en el lienzo?')).toBeVisible();
  await expect(chat.getByLabel('Conversaciones')).toContainText('¿Qué hay en el lienzo?');

  // «Convertir en cambios del lienzo» pasa la respuesta al asistente, que vuelve a mostrar una vista previa.
  await chat.getByTestId('ai-chat-convert').click();
  await expect(preview).toBeVisible();
  await preview.getByTestId('ai-discard').click();
  await expect(preview).toBeHidden();
  expect(await nodes(page)).toEqual([]);

  // Bea no ve la conversación de Ana: las conversaciones son privadas.
  await bea.getByTestId('ai-toggle').click();
  const beaPanel = bea.getByTestId('ai-panel');
  await beaPanel.getByRole('tab', { name: 'Chat' }).click();
  await expect(beaPanel.getByText('Pregunta lo que quieras', { exact: false })).toBeVisible();
  await expect(beaPanel.getByText('Respuesta de prueba.')).toHaveCount(0);

  await otherContext.close();
});

test('IA: animación propuesta con vista previa sin escribir y aplicada en un paso de deshacer', async ({ page }) => {
  test.setTimeout(150_000);
  const ana = await createVerifiedAccount(page.request, `ai-anim-${test.info().project.name}`, 'Ana Animada');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Animación con IA');
  await openEditor(page, projectId);

  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 100, y: box.y + box.height / 2 - 80 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const rect = (await nodes(page))[0]!;
  await canvas.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection())).toEqual([rect.id]);

  await page.getByRole('button', { name: 'Animar', exact: true }).click();
  const timeline = page.getByTestId('timeline');
  await timeline.getByTestId('timeline-ai').click();
  const animate = timeline.getByTestId('ai-animate');
  await animate.getByTestId('ai-animate-prompt').fill('Que entre desde la izquierda');
  await animate.getByTestId('ai-animate-submit').click();
  await expect(animate.getByText('Animación propuesta')).toBeVisible();
  expect(await animations(page)).toEqual({});

  // La vista previa se reproduce en las vistas y el documento sigue sin animaciones.
  await animate.getByTestId('ai-animate-play').click();
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.player()), { timeout: 15_000 }).toMatchObject({ status: 'paused', time: 1000 });
  expect(await animations(page)).toEqual({});
  expect((await nodes(page))[0]!.x).toBeCloseTo(rect.x, 3);

  await animate.getByTestId('ai-animate-apply').click();
  await expect
    .poll(async () => Object.values((await animations(page))[rect.id]?.tracks.offsetX ?? {}).map((kf) => kf.v).sort())
    .toEqual([0, 100]);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => animations(page)).toEqual({});
  expect((await nodes(page)).map((node) => node.id)).toEqual([rect.id]);
});

test('IA: imagen generada en la galería con insignia y «Enviar al chat de IA»', async ({ page }) => {
  test.setTimeout(150_000);
  const ana = await createVerifiedAccount(page.request, `ai-img-${test.info().project.name}`, 'Ana Imagen');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Imágenes con IA');
  await openEditor(page, projectId);

  await page.getByRole('button', { name: 'Galería', exact: true }).click();
  const gallery = page.getByTestId('gallery-panel');
  await gallery.getByTestId('gallery-generate-prompt').fill('Un faro al atardecer');
  await gallery.getByTestId('gallery-generate-submit').click();
  const item = gallery.getByRole('button', { name: 'Ver Un faro al atardecer' });
  await expect(item).toBeVisible({ timeout: 30_000 });
  await expect(item.getByText('IA', { exact: true })).toBeVisible();

  await item.click();
  const dialog = page.getByRole('dialog', { name: 'Un faro al atardecer' });
  await dialog.getByTestId('gallery-send-chat').click();
  await expect(dialog).toBeHidden();
  const chat = page.getByTestId('ai-panel').getByTestId('ai-chat');
  await expect(chat.getByTestId('ai-chat-attachment')).toContainText('Un faro al atardecer');
  await chat.getByTestId('ai-chat-input').fill('Describe esta imagen');
  await chat.getByTestId('ai-chat-input').press('Enter');
  await expect(chat.getByText('Respuesta de prueba.')).toBeVisible();
  await expect(chat.getByTestId('ai-chat-attachment')).toHaveCount(0);
});

test('IA: sin modelos configurados no aparecen los botones de IA', async ({ page }) => {
  const ana = await createVerifiedAccount(page.request, `ai-off-${test.info().project.name}`, 'Ana Sin IA');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Sin IA');
  await page.route('http://localhost:3000/v1/meta', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { aiFeatures: Record<string, boolean> };
    const aiFeatures = Object.fromEntries(Object.keys(body.aiFeatures).map((key) => [key, false]));
    await route.fulfill({ response, json: { ...body, aiFeatures } });
  });
  const meta = page.waitForResponse('http://localhost:3000/v1/meta');
  await openEditor(page, projectId);
  await meta;

  await expect(page.getByRole('button', { name: 'Galería', exact: true })).toBeVisible();
  await expect(page.getByTestId('ai-toggle')).toHaveCount(0);
  await page.getByRole('button', { name: 'Galería', exact: true }).click();
  await expect(page.getByTestId('gallery-panel')).toBeVisible();
  await expect(page.getByTestId('gallery-generate')).toHaveCount(0);
  await page.getByRole('button', { name: 'Animar', exact: true }).click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(page.getByTestId('timeline-ai')).toHaveCount(0);
});
