import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';

// La clasificación de cada delta la cubre input.test.ts; aquí solo se comprueba de extremo a extremo que llega a la cámara.

async function openEditor(page: Page, projectId: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

// Zoom y origen de la página en pantalla, leídos con la proyección de dos puntos del mundo.
const view = (page: Page) =>
  page.evaluate(() => {
    const hooks = window.__parcifyTest!;
    const a = hooks.toPage(0, 0);
    const b = hooks.toPage(100, 0);
    return { zoom: (b.x - a.x) / 100, x: a.x, y: a.y };
  });

// Despacha un wheel sintético en el elemento que hay bajo (x, y) y devuelve si quedó anulado.
type WheelInit = { deltaX?: number; deltaY?: number; deltaMode?: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };

const wheelAt = (page: Page, x: number, y: number, init: WheelInit) =>
  page.evaluate(
    ([px, py, options]) => {
      const target = document.elementFromPoint(px, py)!;
      const event = new WheelEvent('wheel', { ...options, clientX: px, clientY: py, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
    [x, y, init] as const,
  );

test('el pellizco del touchpad acerca con paso limitado y dos dedos desplazan sin zoom', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `touchpad-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const start = await view(page);
  let previous = start.zoom;
  for (let i = 0; i < 15; i++) {
    expect(await wheelAt(page, cx, cy, { ctrlKey: true, deltaY: -40 })).toBe(true);
    const now = await view(page);
    expect(now.zoom / previous).toBeLessThanOrEqual(1.1052);
    previous = now.zoom;
  }
  expect(previous / start.zoom).toBeGreaterThan(4);
  expect(previous / start.zoom).toBeLessThanOrEqual(1.1052 ** 15);

  const before = await view(page);
  for (let i = 0; i < 10; i++) await wheelAt(page, cx, cy, { deltaY: 8 });
  const after = await view(page);
  expect(after.zoom).toBeCloseTo(before.zoom, 6);
  expect(after.y - before.y).toBeCloseTo(-80, 0);
  expect(after.x).toBeCloseTo(before.x, 6);

  // Por defecto la rueda del ratón también desplaza (como Figma).
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await view(page)).y).toBeLessThan(after.y - 50);
  expect((await view(page)).zoom).toBeCloseTo(after.zoom, 6);
});

test('Ctrl+rueda sobre el panel derecho no hace zoom ni de la página ni del lienzo', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `pellizco-panel-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const panel = page.getByRole('complementary', { name: 'Propiedades' });
  const panelBox = (await panel.boundingBox())!;
  const before = await view(page);
  const prevented = await wheelAt(page, panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2, { ctrlKey: true, deltaY: -40 });
  expect(prevented).toBe(true);
  expect((await view(page)).zoom).toBeCloseTo(before.zoom, 6);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  const canvasBox = (await page.getByRole('application', { name: 'Lienzo del proyecto' }).boundingBox())!;
  expect(await wheelAt(page, canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2, { ctrlKey: true, deltaY: -40 })).toBe(true);
  expect((await view(page)).zoom).toBeGreaterThan(before.zoom);
});

test('el editor pide viewport-fit=cover', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `viewport-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  expect(await page.locator('meta[name="viewport"]').count()).toBe(1);
});
