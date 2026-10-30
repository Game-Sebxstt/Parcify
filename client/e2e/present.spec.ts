import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { canvasGap } from './helpers/canvas.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
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

test('Presentar: la diapositiva sigue centrada al pasar de 1440×900 a 1920×1080', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // En pantalla completa el navegador no deja cambiar el tamaño de la ventana: se presenta en el hueco del lienzo,
  // que es lo que pasa cuando el navegador niega el permiso.
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Sin permiso', 'NotAllowedError'));
  });
  const ana = await createVerifiedAccount(page.request, `present-size-${test.info().project.name}`, 'Ana Presenta');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Charla centrada');
  await openEditor(page, projectId);

  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = await canvasGap(page);
  await canvas.focus();
  await page.keyboard.press('f');
  await drag(page, { x: box.x + 60, y: box.y + 80 }, { x: box.x + 300, y: box.y + 220 });
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'frame').length).toBe(1);
  const frame = (await nodes(page)).find((node) => node.type === 'frame')!;

  await page.getByRole('button', { name: 'Presentar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Presentación' });
  await expect(dialog).toBeVisible();

  // Márgenes de la diapositiva dentro del área de la presentación: iguales a cada lado (±1 px).
  const expectCentered = async () => {
    await expect(async () => {
      const area = (await dialog.boundingBox())!;
      const from = await toPage(page, frame.x, frame.y);
      const to = await toPage(page, frame.x + frame.w, frame.y + frame.h);
      const left = from.x - area.x;
      const right = area.x + area.width - to.x;
      const top = from.y - area.y;
      const bottom = area.y + area.height - to.y;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
    }).toPass({ timeout: 5_000 });
  };

  await expectCentered();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectCentered();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('Presentar: frames en orden, teclado para avanzar, atajos del editor bloqueados y cámara restaurada', async ({ page }) => {
  test.setTimeout(120_000);
  const ana = await createVerifiedAccount(page.request, `present-${test.info().project.name}`, 'Ana Presenta');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Charla');
  await openEditor(page, projectId);
  const present = page.getByRole('button', { name: 'Presentar', exact: true });

  // Sin frames no hay presentación.
  await present.click();
  await expect(page.getByText('Añade un frame a esta página para presentarla.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Presentación' })).toHaveCount(0);

  // Tres frames en fila y un rectángulo dentro del segundo.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = await canvasGap(page);
  const origin = { x: box.x + 40, y: box.y + 60 };
  for (const dx of [0, 220, 440]) {
    await canvas.focus();
    await page.keyboard.press('f');
    await drag(page, { x: origin.x + dx, y: origin.y }, { x: origin.x + dx + 180, y: origin.y + 120 });
  }
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'frame').length).toBe(3);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, { x: origin.x + 260, y: origin.y + 30 }, { x: origin.x + 340, y: origin.y + 90 });
  await expect.poll(async () => (await nodes(page)).length).toBe(4);
  const before = await nodes(page);
  const frames = before.filter((node) => node.type === 'frame').sort((a, b) => a.x - b.x);
  const cameraBefore = await toPage(page, 0, 0);

  await present.click();
  const dialog = page.getByRole('dialog', { name: 'Presentación' });
  await expect(dialog).toBeVisible();
  const counter = dialog.getByTestId('present-counter');

  // El frame actual queda centrado en el área de la presentación.
  const expectCentered = async (index: number) => {
    const frame = frames[index]!;
    await expect(counter).toHaveText(`${index + 1} / 3`);
    await expect(dialog.getByText(`Diapositiva ${index + 1} de 3`)).toBeAttached();
    await expect(async () => {
      const area = (await dialog.boundingBox())!;
      const center = await toPage(page, frame.x + frame.w / 2, frame.y + frame.h / 2);
      expect(Math.abs(center.x - (area.x + area.width / 2))).toBeLessThan(3);
      expect(Math.abs(center.y - (area.y + area.height / 2))).toBeLessThan(3);
    }).toPass({ timeout: 5_000 });
  };

  await expectCentered(0);
  await page.keyboard.press('ArrowRight');
  await expectCentered(1);
  await page.keyboard.press('Space');
  await expectCentered(2);
  await page.keyboard.press('ArrowRight');
  await expectCentered(2);
  await page.keyboard.press('Home');
  await expectCentered(0);
  await page.keyboard.press('End');
  await expectCentered(2);
  await page.keyboard.press('PageUp');
  await expectCentered(1);
  await page.keyboard.press('ArrowLeft');
  await expectCentered(0);

  // Los atajos del editor no llegan al documento mientras se presenta.
  for (const key of ['Control+a', 'Delete', 'Control+z', 'Control+d', 'r']) await page.keyboard.press(key);
  await page.waitForTimeout(300);
  expect(await nodes(page)).toEqual(before);

  // Los controles responden al puntero.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await dialog.getByRole('button', { name: 'Diapositiva siguiente' }).click();
  await expectCentered(1);

  // Salir devuelve el lienzo como estaba.
  await dialog.getByRole('button', { name: 'Salir de la presentación' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect.poll(() => toPage(page, 0, 0)).toEqual(cameraBefore);
  expect(await nodes(page)).toEqual(before);

  // Esc también sale.
  await present.click();
  await expect(dialog).toBeVisible();
  await expectCentered(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await nodes(page)).toEqual(before);
});
