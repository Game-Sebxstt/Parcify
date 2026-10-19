import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinProjectByLink } from './helpers/invite.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const remote = (page: Page) => page.evaluate(() => window.__parcifyTest!.remote());
const toPage = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__parcifyTest!.toPage(px!, py!), [x, y]);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifiers: string[] = []) {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}

async function canvasOrigin(page: Page) {
  const box = (await page.getByRole('application', { name: 'Lienzo del proyecto' }).boundingBox())!;
  return { x: box.x + box.width / 2 - 150, y: box.y + box.height / 2 - 120 };
}

test('dos personas en el mismo proyecto: cambios, cursores, deshacer propio y degradar en vivo', async ({ page, browser }) => {
  // Dos navegadores con el motor y la colaboración: más lento que el resto, sobre todo en Firefox.
  test.setTimeout(150_000);
  const label = `collab-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Colabora');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Colabora');

  // Bea entra como editora con un enlace de proyecto; no es del espacio de Ana.
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Cartel compartido');
  await joinProjectByLink(page.request, projectId, bea.request, 'editor');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Ana crea un rectángulo y Bea lo ve.
  const origin = await canvasOrigin(page);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(bea)).length).toBe(1);
  const created = (await nodes(page))[0]!;

  // Ana lo mueve y Bea ve la posición nueva.
  const start = await toPage(page, created.x + created.w / 2, created.y + created.h / 2);
  await drag(page, start, { x: start.x + 90, y: start.y + 40 }, ['Control']);
  await expect.poll(async () => (await nodes(bea)).find((node) => node.id === created.id)!.x).toBeCloseTo(created.x + 90, 0);

  // Cursor y selección de Ana en la pantalla de Bea.
  await page.mouse.move(start.x + 20, start.y + 60, { steps: 3 });
  await expect
    .poll(async () => (await remote(bea)).find((state) => state.name === 'Ana Colabora'))
    .toMatchObject({ cursor: expect.objectContaining({ x: expect.any(Number) }), selection: [created.id] });

  // Bea crea una elipse; Ana deshace y solo se deshace su movimiento.
  const beaOrigin = await canvasOrigin(bea);
  await bea.getByRole('button', { name: 'Elipse (O)' }).click();
  await drag(bea, { x: beaOrigin.x + 260, y: beaOrigin.y }, { x: beaOrigin.x + 340, y: beaOrigin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(2);
  await page.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await nodes(page)).find((node) => node.id === created.id)!.x).toBeCloseTo(created.x, 0);
  await expect.poll(async () => (await nodes(bea)).find((node) => node.id === created.id)!.x).toBeCloseTo(created.x, 0);
  expect(await nodes(page)).toHaveLength(2);

  // Ana degrada a Bea a lectora desde el panel Compartir con el proyecto abierto: pasa a solo lectura sin recargar.
  await page.getByTestId('share').click();
  const panel = page.getByRole('dialog', { name: 'Compartir «Cartel compartido»' });
  await panel.getByLabel(`Rol de ${beaAccount.name}`).selectOption('viewer');
  await expect(page.getByText(`${beaAccount.name}: Solo puede ver.`)).toBeVisible();
  await panel.getByRole('button', { name: 'Cerrar' }).click();
  await expect.poll(() => bea.evaluate(() => window.__parcifyTest!.readOnly()), { timeout: 15_000 }).toBe(true);
  await expect(bea.getByText('Solo lectura', { exact: true })).toBeVisible();

  // Como lectora no puede crear nada.
  const before = (await nodes(bea)).length;
  await bea.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await bea.keyboard.press('r');
  await drag(bea, { x: beaOrigin.x - 100, y: beaOrigin.y + 160 }, { x: beaOrigin.x, y: beaOrigin.y + 240 });
  await bea.waitForTimeout(500);
  expect(await nodes(bea)).toHaveLength(before);
  expect(await nodes(page)).toHaveLength(before);

  await otherContext.close();
});

test('sin Worker el documento se abre en el hilo principal y dos personas siguen editando juntas', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const label = `noworker-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Sin Worker');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Con Worker');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Sin worker');
  await joinProjectByLink(page.request, projectId, bea.request, 'editor');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', { value: undefined, configurable: true });
  });
  const warnings: string[] = [];
  page.on('console', (message) => message.type() === 'warning' && warnings.push(message.text()));
  await openEditor(page, projectId);
  await openEditor(bea, projectId);
  expect(warnings.some((text) => text.includes('sin worker'))).toBe(true);
  const origin = await canvasOrigin(page);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(bea)).length).toBe(1);
  const created = (await nodes(bea))[0]!;
  const start = await toPage(bea, created.x + created.w / 2, created.y + created.h / 2);
  await drag(bea, start, { x: start.x + 60, y: start.y }, ['Control']);
  await expect.poll(async () => (await nodes(page)).find((node) => node.id === created.id)!.x).toBeCloseTo(created.x + 60, 0);
  await otherContext.close();
});

test('sin red, al recargar se ve lo que había en la copia local del navegador', async ({ page }) => {
  test.setTimeout(90_000);
  const ana = await createVerifiedAccount(page.request, `offline-${test.info().project.name}`, 'Ana Sin Red');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Copia local');
  await openEditor(page, projectId);
  const origin = await canvasOrigin(page);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const created = (await nodes(page))[0]!;
  // La copia local se escribe desde el worker; se le deja un momento.
  await page.waitForTimeout(1_000);
  // El servidor de colaboración deja de estar al alcance: el token apunta a un puerto cerrado.
  await page.route('**/v1/projects/*/collab-token', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { url: string };
    await route.fulfill({ response, json: { ...body, url: 'ws://localhost:1' } });
  });
  await page.reload();
  await page.waitForFunction(() => window.__parcifyTest !== undefined);
  await expect.poll(async () => (await nodes(page)).map((node) => node.id)).toEqual([created.id]);
  expect(await page.evaluate(() => window.__parcifyTest!.status())).not.toBe('connected');
  await expect(page.getByText('El editor dejó de responder')).toHaveCount(0);
});