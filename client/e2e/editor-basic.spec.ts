import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; rotation: number };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const toPage = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__parcifyTest!.toPage(px!, py!), [x, y]);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await expect(page.getByTestId('connection-status')).toHaveText('Conectado');
  // El overlay de la vista inicial puede tardar un frame en posicionar la cámara.
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

const center = (node: Node) => ({ x: node.x + node.w / 2, y: node.y + node.h / 2 });

test('crear, mover, redimensionar y girar formas, y que sigan ahí tras recargar', async ({ page, browser }) => {
  const account = await createVerifiedAccount(page.request, test.info().project.name);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  await expect(page.getByRole('textbox', { name: 'Nombre del proyecto' })).toHaveValue('Lienzo de prueba');

  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 200, y: box.y + box.height / 2 - 150 };

  // Crear un rectángulo arrastrando.
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  let rect: Node = (await nodes(page))[0]!;
  expect(rect.type).toBe('rect');
  expect(rect.w).toBeCloseTo(120, 0);
  expect(rect.h).toBeCloseTo(80, 0);

  // Crear una elipse con el atajo O.
  await canvas.focus();
  await page.keyboard.press('o');
  await drag(page, { x: origin.x + 260, y: origin.y }, { x: origin.x + 360, y: origin.y + 100 });
  await expect.poll(async () => (await nodes(page)).length).toBe(2);

  // Mover el rectángulo (Ctrl desactiva el ajuste a la elipse).
  const original = rect;
  const start = await toPage(page, center(original).x, center(original).y);
  await drag(page, start, { x: start.x + 100, y: start.y + 50 }, ['Control']);
  await expect.poll(async () => (await nodes(page)).find((n) => n.id === original.id)!.x).toBeCloseTo(original.x + 100, 0);
  rect = (await nodes(page)).find((n) => n.id === original.id)!;
  expect(rect.y).toBeCloseTo(original.y + 50, 0);

  // Redimensionar desde la esquina inferior derecha.
  const corner = await toPage(page, rect.x + rect.w, rect.y + rect.h);
  await drag(page, corner, { x: corner.x + 40, y: corner.y + 20 });
  await expect.poll(async () => (await nodes(page)).find((n) => n.id === rect.id)!.w).toBeCloseTo(160, 0);
  rect = (await nodes(page)).find((n) => n.id === rect.id)!;
  expect(rect.h).toBeCloseTo(100, 0);

  // Girar desde fuera de la esquina superior derecha, con Shift para ir a pasos de 15°.
  const ne = await toPage(page, rect.x + rect.w + 10, rect.y - 10);
  const c = await toPage(page, center(rect).x, center(rect).y);
  await drag(page, ne, { x: c.x + 120, y: c.y + 40 }, ['Shift']);
  await expect.poll(async () => (await nodes(page)).find((n) => n.id === rect.id)!.rotation).not.toBe(0);
  rect = (await nodes(page)).find((n) => n.id === rect.id)!;
  const steps = rect.rotation / (Math.PI / 12);
  expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);

  const before = (await nodes(page)).sort((a, b) => a.id.localeCompare(b.id));

  // Tras recargar, todo sigue ahí. Después, en un contexto nuevo sin la copia de IndexedDB, el documento
  // tiene que venir del servidor (guardado en Postgres tras el debounce de collab).
  await page.reload();
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await expect.poll(async () => (await nodes(page)).length).toBe(2);
  await page.waitForTimeout(2_500);
  const fresh = await browser.newContext({ storageState: await page.context().storageState() });
  const second = await fresh.newPage();
  await openEditor(second, projectId);
  await expect.poll(async () => (await nodes(second)).length).toBe(2);
  const after = (await nodes(second)).sort((a, b) => a.id.localeCompare(b.id));
  for (const [i, node] of before.entries()) {
    expect(after[i]).toMatchObject({ id: node.id, type: node.type, x: node.x, y: node.y, w: node.w, h: node.h, rotation: node.rotation });
  }
  await fresh.close();
});
