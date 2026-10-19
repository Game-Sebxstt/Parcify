import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; parentId: string | null; pageId: string };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);

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

test('grupo, frame y página creados por una persona y vistos por otra', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const label = `groups-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Grupos');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Grupos');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Grupos y frames');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + 60, y: box.y + 60 };

  // Dos rectángulos agrupados con Ctrl+G.
  for (const dx of [0, 160]) {
    await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
    await drag(page, { x: origin.x + dx, y: origin.y }, { x: origin.x + dx + 100, y: origin.y + 60 });
  }
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await expect.poll(async () => (await nodes(bea)).filter((node) => node.type === 'group').length).toBe(1);
  const group = (await nodes(bea)).find((node) => node.type === 'group')!;
  expect((await nodes(bea)).filter((node) => node.parentId === group.id)).toHaveLength(2);

  // Un frame dibujado con F y un rectángulo creado dentro de él.
  await page.keyboard.press('f');
  const frameFrom = { x: origin.x, y: origin.y + 140 };
  await drag(page, frameFrom, { x: frameFrom.x + 300, y: frameFrom.y + 200 });
  await expect.poll(async () => (await nodes(bea)).filter((node) => node.type === 'frame').length).toBe(1);
  const frame = (await nodes(bea)).find((node) => node.type === 'frame')!;
  expect(frame).toMatchObject({ w: 300, h: 200 });
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, { x: frameFrom.x + 40, y: frameFrom.y + 40 }, { x: frameFrom.x + 120, y: frameFrom.y + 100 });
  await expect.poll(async () => (await nodes(bea)).filter((node) => node.parentId === frame.id).length).toBe(1);
  expect((await nodes(bea)).find((node) => node.parentId === frame.id)).toMatchObject({ x: 40, y: 40, w: 80, h: 60 });

  // Una página nueva aparece en el panel de páginas de Bea.
  await page.getByRole('button', { name: 'Añadir página' }).click();
  await expect(bea.getByRole('button', { name: 'Página 2', exact: true })).toBeVisible();
  await expect(bea.getByRole('button', { name: 'Página 1', exact: true })).toHaveAttribute('aria-current', 'page');

  await otherContext.close();
});
