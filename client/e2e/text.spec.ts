import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const texts = (page: Page) => page.evaluate(() => window.__parcifyTest!.texts());
const editing = (page: Page) => page.evaluate(() => window.__parcifyTest!.editing());
const toPage = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__parcifyTest!.toPage(px!, py!), [x, y]);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

test('dos personas editan el mismo texto a la vez y cada una ve el caret de la otra', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const label = `text-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Texto');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Texto');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Textos compartidos');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await setOrgAccess(page.request, projectId, 'none');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Ana crea un texto con la herramienta T y escribe.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Texto (T)' }).click();
  await page.mouse.click(box.x + box.width / 2 - 100, box.y + box.height / 2 - 40);
  const anaEditor = page.getByRole('textbox', { name: 'Texto', exact: true });
  await expect(anaEditor).toBeFocused();
  await page.keyboard.type('Hola mundo');
  await expect.poll(async () => Object.values(await texts(bea))).toEqual(['Hola mundo']);
  const node = (await nodes(page)).find((n) => n.type === 'text')!;

  // Bea abre el mismo texto con doble clic y pone el caret al principio.
  // En el centro: cerca de los bordes, el segundo clic cae en un handle de la selección.
  const at = await toPage(bea, node.x + node.w / 2, node.y + node.h / 2);
  await bea.mouse.dblclick(at.x, at.y);
  await expect.poll(() => editing(bea)).toBe(node.id);
  const beaEditor = bea.getByRole('textbox', { name: 'Texto', exact: true });
  await expect(beaEditor).toBeFocused();
  await bea.keyboard.press('Control+Home');

  // Los dos escriben a la vez: Ana al final, Bea al principio.
  await Promise.all([page.keyboard.type('!!'), bea.keyboard.type('>> ')]);
  await expect.poll(async () => (await texts(page))[node.id]).toBe('>> Hola mundo!!');
  await expect.poll(async () => (await texts(bea))[node.id]).toBe('>> Hola mundo!!');
  await expect(anaEditor).toHaveText('>> Hola mundo!!');
  await expect(beaEditor).toHaveText('>> Hola mundo!!');

  // Cada caret siguió en su sitio: una letra más entra justo tras lo que escribió cada uno.
  await page.keyboard.type('A');
  await bea.keyboard.type('B');
  await expect.poll(async () => (await texts(page))[node.id]).toBe('>> BHola mundo!!A');

  // Cada uno ve el caret remoto del otro con su nombre.
  await expect(page.locator('[data-remote-caret]')).toHaveText('Bea Texto');
  await expect(bea.locator('[data-remote-caret]')).toHaveText('Ana Texto');

  // Un contenido con marcado se pinta como texto.
  await bea.keyboard.type('<img src=x onerror=alert(1)>');
  await expect(anaEditor).toContainText('<img src=x onerror=alert(1)>');
  expect(await anaEditor.locator('img').count()).toBe(0);

  // Escape confirma; el texto sigue en el documento.
  await page.keyboard.press('Escape');
  await expect.poll(() => editing(page)).toBeNull();
  expect((await nodes(page)).some((n) => n.id === node.id)).toBe(true);

  await otherContext.close();
});

test('un texto vacío se borra al salir', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `text-empty-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  await canvas.focus();
  await page.keyboard.press('t');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodes(page)).length).toBe(0);
});
