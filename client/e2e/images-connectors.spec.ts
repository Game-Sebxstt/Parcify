import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { solidPng } from './helpers/image.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; from?: unknown; to?: unknown; assetId?: string };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const images = (page: Page) => page.evaluate(() => window.__parcifyTest!.images());
const toPage = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__parcifyTest!.toPage(px!, py!), [x, y]);

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

test('imagen subida al lienzo y conector entre dos formas, vistos por otra persona', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const label = `imgcon-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Imagen');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Imagen');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Imágenes y conectores');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Ana sube una imagen con la herramienta de imagen: se crea el nodo y los dos pintan su textura.
  await page.getByTestId('image-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: solidPng(300) });
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'image').length, { timeout: 30_000 }).toBe(1);
  const image = (await nodes(page)).find((node) => node.type === 'image')!;
  expect(image).toMatchObject({ w: 300, h: 300 });
  await expect.poll(async () => (await images(page))[image.id], { timeout: 30_000 }).toBe('ready');
  await expect.poll(async () => (await images(bea))[image.id], { timeout: 30_000 }).toBe('ready');

  // Dos rectángulos y un conector de uno a otro con la herramienta C.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  // Debajo de la imagen, dentro de la vista.
  const left = await toPage(page, image.x, image.y + image.h + 30);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, left, { x: left.x + 80, y: left.y + 60 });
  const right = await toPage(page, image.x + 220, image.y + image.h + 30);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, right, { x: right.x + 80, y: right.y + 60 });
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'rect').length).toBe(2);
  const [a, b] = (await nodes(page)).filter((node) => node.type === 'rect').sort((p, q) => p.x - q.x);

  await canvas.focus();
  await page.keyboard.press('c');
  const from = await toPage(page, a!.x + a!.w / 2, a!.y + a!.h / 2);
  const to = await toPage(page, b!.x + b!.w / 2, b!.y + b!.h / 2);
  await drag(page, from, to);
  await expect.poll(async () => (await nodes(bea)).filter((node) => node.type === 'connector').length).toBe(1);
  const connector = (await nodes(bea)).find((node) => node.type === 'connector')!;
  expect(connector.from).toMatchObject({ nodeId: a!.id });
  expect(connector.to).toMatchObject({ nodeId: b!.id });

  // Bea borra el destino: el conector se queda con el último punto como coordenada libre.
  // Lejos del extremo del conector, que está encima en el orden z.
  const target = await toPage(bea, b!.x + 8, b!.y + b!.h - 8);
  await bea.mouse.click(target.x, target.y);
  await bea.keyboard.press('Delete');
  await expect.poll(async () => (await nodes(page)).find((node) => node.type === 'connector')?.to).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });

  await otherContext.close();
});
