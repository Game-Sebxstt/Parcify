import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { canvasGap } from './helpers/canvas.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';
import { touchDrag } from './helpers/touch.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const toPage = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__parcifyTest!.toPage(px!, py!), [x, y]);

// Piezas del editor que no pueden estar en el DOM mientras se presenta.
const CHROME = [
  '[data-testid="left-panel"]',
  '[data-testid="left-panel-pill"]',
  '[data-testid="right-panel"]',
  '[data-testid="right-panel-pill"]',
  '[role="toolbar"]',
  '[data-testid="canvas-bars"]',
  '[data-testid="mobile-top-bar"]',
  '[data-testid="dock"]',
  '[data-testid="context-bar"]',
  '[role="dialog"][data-side="bottom"]',
];
const editorChrome = (page: Page) => page.evaluate((selectors) => selectors.filter((selector) => document.querySelector(selector) !== null), CHROME);

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
  // Sin pantalla completa, nada del editor queda encima ni debajo de la diapositiva (CA-11.6, escritorio).
  expect(await editorChrome(page)).toEqual([]);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectCentered();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Al salir vuelve todo como estaba.
  await expect(page.getByTestId('canvas-bars')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Presentar', exact: true })).toBeVisible();
});

test('Presentar la página entera: sin marcos, centra el contenido y vuelve a encajar lo que añade otra persona', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Sin permiso', 'NotAllowedError'));
  });
  const label = `present-page-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Presenta');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Presenta');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Estrategia');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await setOrgAccess(page.request, projectId, 'none');
  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Dos rectángulos sueltos, sin ningún marco.
  const box = await canvasGap(page);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, { x: box.x + 80, y: box.y + 90 }, { x: box.x + 200, y: box.y + 170 });
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, { x: box.x + 420, y: box.y + 260 }, { x: box.x + 520, y: box.y + 400 });
  await expect.poll(async () => (await nodes(bea)).length).toBe(2);

  // Sin marcos, Presentar pregunta. Cancelar no presenta.
  await page.getByRole('button', { name: 'Presentar', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Esta página no tiene marcos' });
  await expect(ask).toContainText('¿Presentar la página entera?');
  await ask.getByRole('button', { name: 'Cancelar' }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Presentación' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Presentar', exact: true }).click();
  await ask.getByRole('button', { name: 'Presentar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Presentación' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-mode', 'page');
  await expect(dialog.getByTestId('present-counter')).toHaveText('1 / 1');
  await expect(dialog.getByRole('button', { name: 'Diapositiva siguiente' })).toHaveAttribute('aria-disabled', 'true');
  expect(await editorChrome(page)).toEqual([]);

  // El AABB del contenido queda centrado en el área de la presentación (±1 px por eje).
  const expectContentCentered = async (count: number) => {
    await expect(async () => {
      const all = await nodes(page);
      expect(all).toHaveLength(count);
      const minX = Math.min(...all.map((node) => node.x));
      const minY = Math.min(...all.map((node) => node.y));
      const maxX = Math.max(...all.map((node) => node.x + node.w));
      const maxY = Math.max(...all.map((node) => node.y + node.h));
      const area = (await dialog.boundingBox())!;
      const from = await toPage(page, minX, minY);
      const to = await toPage(page, maxX, maxY);
      expect(Math.abs(from.x - area.x - (area.x + area.width - to.x))).toBeLessThanOrEqual(1);
      expect(Math.abs(from.y - area.y - (area.y + area.height - to.y))).toBeLessThanOrEqual(1);
    }).toPass({ timeout: 5_000 });
  };
  await expectContentCentered(2);

  // Bea añade una forma lejos del resto: la presentación sigue abierta y la incluye (CA-11.5).
  const beaBox = await canvasGap(bea);
  await bea.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(bea, { x: beaBox.x + beaBox.width - 160, y: beaBox.y + beaBox.height - 200 }, { x: beaBox.x + beaBox.width - 40, y: beaBox.y + beaBox.height - 120 });
  await expect.poll(async () => (await nodes(page)).length).toBe(3);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('present-counter')).toHaveText('1 / 1');
  await expectContentCentered(3);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // El diálogo de la página entera no vuelve a salir al terminar.
  await expect(ask).toHaveCount(0);
  await otherContext.close();
});

test('móvil @touch: deslizar cambia de diapositiva, un toque en el centro muestra los controles y nada tapa la presentación (CA-11.4, CA-11.6)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Solo en el proyecto mobile');
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Sin permiso', 'NotAllowedError'));
  });
  const ana = await createVerifiedAccount(page.request, `present-touch-${testInfo.project.name}`, 'Ana Presenta');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Charla móvil');
  await openEditor(page, projectId);

  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (const dy of [-150, 40]) {
    await canvas.focus();
    await page.keyboard.press('f');
    await touchDrag(page, { x: center.x - 80, y: center.y + dy }, { x: center.x + 80, y: center.y + dy + 90 });
  }
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'frame').length).toBe(2);

  // En el móvil, Presentar está en el menú ⋯ de la barra superior. Chromium no genera el clic de un toque que llega
  // justo después de un arrastre rápido con el dedo (lo usa para parar el gesto): se espera a que pase.
  await page.waitForTimeout(500);
  // Con una hoja abierta: al presentar no está en el DOM y al salir vuelve.
  await page.getByTestId('mobile-menu').tap();
  await page.getByTestId('mobile-menu-sheet').getByRole('button', { name: 'Páginas y capas', exact: true }).tap();
  await expect(page.getByTestId('layers-sheet')).toBeVisible();
  await page.getByTestId('mobile-menu').tap();
  await page.getByTestId('mobile-menu-sheet').getByRole('button', { name: 'Presentar', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Presentación' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('mobile-menu-sheet')).toHaveCount(0);
  const counter = dialog.getByTestId('present-counter');
  await expect(counter).toHaveText('1 / 2');

  // Deslizar a la izquierda pasa a la siguiente; a la derecha, vuelve.
  const area = (await dialog.boundingBox())!;
  const mid = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  await touchDrag(page, { x: mid.x + 100, y: mid.y }, { x: mid.x - 100, y: mid.y }, 6);
  await expect(counter).toHaveText('2 / 2');
  await touchDrag(page, { x: mid.x - 100, y: mid.y }, { x: mid.x + 100, y: mid.y }, 6);
  await expect(counter).toHaveText('1 / 2');
  // Un toque en el tercio derecho avanza.
  await page.touchscreen.tap(area.x + area.width - 30, mid.y);
  await expect(counter).toHaveText('2 / 2');

  // Los controles se ocultan solos; un toque en el centro los muestra y la salida mide 44 px.
  const controls = dialog.locator('[data-present-controls]');
  await expect(controls).toHaveCSS('opacity', '0', { timeout: 6_000 });
  await page.touchscreen.tap(mid.x, mid.y);
  await expect(controls).toHaveCSS('opacity', '1');
  const exit = (await dialog.getByRole('button', { name: 'Salir de la presentación' }).boundingBox())!;
  expect(exit.width).toBeGreaterThanOrEqual(44);
  expect(exit.height).toBeGreaterThanOrEqual(44);
  // Otro toque en el centro los vuelve a ocultar.
  await page.touchscreen.tap(mid.x, mid.y);
  await expect(controls).toHaveCSS('opacity', '0');

  // En el centro y abajo a la izquierda solo está la presentación (CA-11.6, móvil).
  const hits = await page.evaluate(
    ([w, h]) =>
      [
        [w! / 2, h! / 2],
        [20, h! - 24],
      ].map(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[data-testid="present"][role="dialog"]')),
    [page.viewportSize()!.width, page.viewportSize()!.height],
  );
  expect(hits).toEqual([true, true]);
  expect(await editorChrome(page)).toEqual([]);

  await page.touchscreen.tap(mid.x, mid.y);
  await dialog.getByRole('button', { name: 'Salir de la presentación' }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('layers-sheet')).toBeVisible();
});

test('Presentar: frames en orden, teclado para avanzar, atajos del editor bloqueados y cámara restaurada', async ({ page }) => {
  test.setTimeout(120_000);
  const ana = await createVerifiedAccount(page.request, `present-${test.info().project.name}`, 'Ana Presenta');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Charla');
  await openEditor(page, projectId);
  const present = page.getByRole('button', { name: 'Presentar', exact: true });

  // Sin frames se pregunta por la página entera; Cancelar no presenta.
  await present.click();
  const ask = page.getByRole('dialog', { name: 'Esta página no tiene marcos' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancelar' }).click();
  await expect(ask).toHaveCount(0);
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
