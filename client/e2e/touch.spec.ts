import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { longPress, pinch, touchDrag, touchThenPinch, twoFingerPan } from './helpers/touch.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; rotation: number };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const selection = (page: Page) => page.evaluate(() => [...window.__parcifyTest!.selection()]);

// Zoom y origen de la página en pantalla, leídos con la proyección de dos puntos del mundo.
const view = (page: Page) =>
  page.evaluate(() => {
    const hooks = window.__parcifyTest!;
    const a = hooks.toPage(0, 0);
    const b = hooks.toPage(100, 0);
    return { zoom: (b.x - a.x) / 100, x: a.x, y: a.y };
  });

async function openEditor(page: Page, label: string) {
  const account = await createVerifiedAccount(page.request, `${label}-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  // Sin inercia: la cámara se queda donde la dejan los dedos y las medidas no dependen del tiempo.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  return { canvas, center: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

test.describe('@touch gestos con el dedo', () => {
  test.beforeEach(() => {
    // A 412 px las dos barras laterales fijas dejan el lienzo sin ancho.
    test.skip(test.info().project.name === 'mobile', 'el lienzo no tiene ancho en la maqueta de móvil actual');
  });

  test('dos dedos que se separan acercan y dos que se mueven juntos desplazan sin zoom', async ({ page }) => {
    const { center } = await openEditor(page, 'dos-dedos');

    const start = await view(page);
    await pinch(page, center, 60, 140);
    await expect.poll(async () => (await view(page)).zoom / start.zoom).toBeGreaterThan(1.3);

    const before = await view(page);
    await twoFingerPan(page, { x: center.x, y: center.y - 120 }, { x: 0, y: 100 });
    await expect.poll(async () => (await view(page)).y - before.y).toBeGreaterThan(60);
    const after = await view(page);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(await nodes(page)).toEqual([]);
  });

  test('una pulsación larga sobre una forma abre el menú contextual con esa forma seleccionada', async ({ page }) => {
    const { canvas, center } = await openEditor(page, 'pulsacion-larga');
    const menu = page.getByTestId('context-menu');

    await canvas.focus();
    await page.keyboard.press('r');
    await touchDrag(page, { x: center.x - 60, y: center.y - 40 }, { x: center.x + 60, y: center.y + 40 });
    await expect.poll(async () => (await nodes(page)).length).toBe(1);
    const rect = (await nodes(page))[0]!;
    const empty = { x: center.x, y: center.y + 200 };

    await page.touchscreen.tap(empty.x, empty.y);
    await expect.poll(() => selection(page)).toEqual([]);
    await longPress(page, center);
    await expect(menu).toBeVisible();
    expect(await selection(page)).toEqual([rect.id]);

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // Si el dedo se mueve más que la tolerancia antes de tiempo, no hay menú.
    await page.touchscreen.tap(empty.x, empty.y);
    await expect.poll(() => selection(page)).toEqual([]);
    await longPress(page, center, 650, { x: 10, y: 0 });
    await page.waitForTimeout(100);
    await expect(menu).toHaveCount(0);
  });

  test('el tirador SE se agarra a 20 px con el dedo y un pellizco que empieza en una forma no la selecciona', async ({ page }) => {
    const { canvas, center } = await openEditor(page, 'tirador-pellizco');

    await canvas.focus();
    await page.keyboard.press('r');
    await touchDrag(page, { x: center.x - 60, y: center.y - 40 }, { x: center.x + 60, y: center.y + 40 });
    await expect.poll(async () => (await nodes(page)).length).toBe(1);
    const rect = (await nodes(page))[0]!;
    expect(await selection(page)).toEqual([rect.id]);

    // Zona de impacto de 44 px: a 20 px a la derecha del tirador todavía es el tirador, no la zona de giro.
    const se = await page.evaluate(([x, y]) => window.__parcifyTest!.toPage(x!, y!), [rect.x + rect.w, rect.y + rect.h]);
    const { zoom } = await view(page);
    // El borde va a donde está el dedo: 20 px de partida más 40 de arrastre.
    await touchDrag(page, { x: se.x + 20, y: se.y }, { x: se.x + 60, y: se.y + 30 });
    await expect.poll(async () => (await nodes(page))[0]!.w).toBeCloseTo(rect.w + 60 / zoom, 0);
    const resized = (await nodes(page))[0]!;
    expect(resized.h).toBeCloseTo(rect.h + 30 / zoom, 0);
    expect(resized.rotation).toBe(0);

    await page.touchscreen.tap(center.x, center.y + 200);
    await expect.poll(() => selection(page)).toEqual([]);

    // El primer dedo cae sobre la forma y el segundo entra antes del umbral: es un pellizco y la selección no cambia.
    const before = await view(page);
    await touchThenPinch(page, { x: center.x - 20, y: center.y }, { x: center.x + 40, y: center.y }, 80);
    await expect.poll(async () => (await view(page)).zoom / before.zoom).toBeGreaterThan(1.3);
    expect(await selection(page)).toEqual([]);
    expect((await nodes(page))[0]).toMatchObject({ x: resized.x, y: resized.y, w: resized.w, h: resized.h });
  });
});
