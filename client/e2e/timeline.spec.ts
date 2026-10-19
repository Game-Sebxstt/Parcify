import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';

type Node = { id: string; x: number; y: number };
type Keyframe = { t: number; v: number | string };
type Animation = { duration: number; delay: number; loop: number; tracks: Partial<Record<string, Record<string, Keyframe>>> };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const animation = (page: Page, id: string) =>
  page.evaluate((nodeId) => (window.__parcifyTest!.animations() as unknown as Record<string, Animation>)[nodeId] ?? null, id);
const offsetX = async (page: Page, id: string) =>
  Object.values((await animation(page, id))?.tracks.offsetX ?? {})
    .map((kf) => ({ t: kf.t, v: kf.v }))
    .sort((a, b) => a.t - b.t);

// Solo el panel de la línea de tiempo (y el editor de keyframes, que vive dentro).
async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .include('[data-testid="timeline"]')
    .analyze();
  return results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.html.slice(0, 200)).slice(0, 5) }));
}

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

test('timeline: dos keyframes con el teclado, reproducir hasta el final, sincronizar y deshacer por usuario', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const label = `timeline-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Anima');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Anima');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Cartel animado');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await setOrgAccess(page.request, projectId, 'none');
  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Un rectángulo, seleccionado con el teclado.
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

  // «Animar…» desde el menú contextual abre el panel con el foco en la fila del nodo.
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Acciones del lienzo' });
  await menu.getByRole('menuitem', { name: /Animar/ }).press('Enter');
  const panel = page.getByTestId('timeline');
  const grid = panel.getByRole('grid', { name: 'Línea de tiempo' });
  await expect(grid.getByRole('rowheader', { name: /fotogramas clave: 0/ })).toBeFocused();
  expect(await audit(page)).toEqual([]);

  // Enter en la pista añade un keyframe en el cabezal (0 s).
  await page.keyboard.press('ArrowDown');
  await expect(grid.getByRole('rowheader', { name: 'Desplazamiento X' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(grid.getByRole('gridcell', { name: /Desplazamiento X, fotograma clave en 0,00 s/ })).toBeFocused();

  // El cabezal al final (1 s), de vuelta a la rejilla y otro keyframe.
  const head = panel.getByRole('slider', { name: 'Cabezal' });
  await head.focus();
  await page.keyboard.press('End');
  await expect(head).toHaveAttribute('aria-valuenow', '1000');
  await page.keyboard.press('Tab');
  await expect(grid.getByRole('gridcell', { name: /en 0,00 s/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(grid.getByRole('rowheader', { name: 'Desplazamiento X' })).toBeFocused();
  await page.keyboard.press('Enter');
  const keyframes = grid.getByRole('gridcell', { name: /^Desplazamiento X, fotograma clave/ });
  const first = keyframes.nth(0);
  const last = keyframes.nth(1);
  await expect(grid.getByRole('gridcell', { name: /Desplazamiento X, fotograma clave en 1,00 s/ })).toBeFocused();

  // Enter lo edita: valor 100 px y guardar con Enter.
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Fotograma clave de Desplazamiento X' });
  await expect(editor.getByRole('spinbutton', { name: 'Tiempo (ms)' })).toBeFocused();
  expect(await audit(page)).toEqual([]);
  await editor.getByRole('spinbutton', { name: 'Valor (px)' }).fill('100');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(grid.getByRole('gridcell', { name: /en 1,00 s, valor 100 px/ })).toBeFocused();
  const expected = [
    { t: 0, v: 0 },
    { t: 1, v: 100 },
  ];
  await expect.poll(() => offsetX(page, rect.id)).toEqual(expected);
  // Bea ve los dos keyframes.
  await expect.poll(() => offsetX(bea, rect.id)).toEqual(expected);

  // Con el cabezal al inicio, Espacio reproduce: la vista pasa por valores intermedios, llega a +100 px en el último
  // frame y después vuelve al documento.
  await head.focus();
  await page.keyboard.press('Home');
  await expect(head).toHaveAttribute('aria-valuenow', '0');
  await expect.poll(async () => (await page.evaluate((id) => window.__parcifyTest!.view(id), rect.id))?.x).toBeCloseTo(rect.x, 3);
  await page.evaluate((id) => {
    const samples: number[] = [];
    (window as unknown as { __samples: number[] }).__samples = samples;
    const sample = () => {
      const view = window.__parcifyTest!.view(id);
      if (view) samples.push(view.x);
      if (samples.length < 600) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, rect.id);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.player()?.status)).toBe('playing');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.player()), { timeout: 15_000 }).toMatchObject({ status: 'paused', time: 1000, duration: 1000 });
  await expect.poll(async () => (await page.evaluate((id) => window.__parcifyTest!.view(id), rect.id))?.x).toBeCloseTo(rect.x, 3);
  const samples = await page.evaluate(() => (window as unknown as { __samples: number[] }).__samples);
  expect(Math.max(...samples) - rect.x).toBeCloseTo(100, 1);
  expect(samples.some((x) => x - rect.x > 5 && x - rect.x < 95)).toBe(true);
  expect((await nodes(page)).find((node) => node.id === rect.id)!.x).toBeCloseTo(rect.x, 3);

  // Bea abre su línea de tiempo y cambia la duración a 2 s.
  await bea.getByRole('button', { name: 'Mostrar la línea de tiempo' }).click();
  const beaPanel = bea.getByTestId('timeline');
  const beaDuration = beaPanel.getByRole('spinbutton', { name: /^Duración de/ });
  await beaDuration.fill('2000');
  await beaDuration.press('Enter');
  await expect.poll(async () => (await animation(page, rect.id))?.duration).toBe(2000);

  // Alt+← mueve el último keyframe un 1 %; Ctrl+Z de Ana solo deshace su movimiento, no la duración de Bea.
  await last.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => offsetX(bea, rect.id)).toEqual([expected[0], { t: 0.99, v: 100 }]);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => offsetX(bea, rect.id)).toEqual(expected);
  expect((await animation(bea, rect.id))?.duration).toBe(2000);

  // Mayús+Tab fuera del editor lo cierra y la rejilla sigue respondiendo.
  await last.focus();
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toHaveCount(0);
  await last.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(first).toBeFocused();

  // Si Bea borra el keyframe que Ana está editando, el editor de Ana se cierra y la rejilla sigue respondiendo.
  await last.focus();
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  const beaLast = beaPanel.getByRole('gridcell', { name: /Desplazamiento X, fotograma clave en 2,00 s/ });
  await beaLast.focus();
  await bea.keyboard.press('Delete');
  await expect.poll(() => offsetX(page, rect.id)).toEqual([expected[0]]);
  await expect(editor).toHaveCount(0);
  await first.focus();
  await page.keyboard.press('Home');
  await expect(grid.getByRole('rowheader', { name: 'Desplazamiento X' })).toBeFocused();
  expect(await audit(page)).toEqual([]);

  await otherContext.close();
});
