import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { solidPng } from './helpers/image.ts';
import { doubleTap, longPress, pinch, touchDrag, touchThenPinch, twoFingerPan } from './helpers/touch.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; rotation: number; name?: string; visible: boolean; locked: boolean };

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
    test.skip(test.info().project.name === 'mobile', 'En el móvil abre la hoja de acciones: lo cubre «@touch maqueta móvil»');
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
    // Abierto con el dedo, sus entradas miden 44 px de alto.
    for (const item of await menu.getByRole('menuitem').all()) expect(Math.round((await item.boundingBox())!.height)).toBeGreaterThanOrEqual(44);

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    // Mientras el menú está abierto, bits-ui deja el body sin eventos de puntero y lo devuelve unos ms después de
    // cerrarlo: un toque de CDP en ese hueco no llega a ningún sitio.
    await page.waitForFunction(() => document.body.style.pointerEvents !== 'none');

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

  test('el tirador de giro sale 24 px por encima del borde superior y gira la forma con el dedo (CA-2.4)', async ({ page }) => {
    const { canvas, center } = await openEditor(page, 'tirador-giro');

    await canvas.focus();
    await page.keyboard.press('r');
    await touchDrag(page, { x: center.x - 60, y: center.y - 40 }, { x: center.x + 60, y: center.y + 40 });
    await expect.poll(async () => (await nodes(page)).length).toBe(1);
    const rect = (await nodes(page))[0]!;

    const handle = () => page.evaluate(() => window.__parcifyTest!.overlayModel()?.selection?.rotateHandle ?? null);
    await expect.poll(handle).not.toBeNull();
    const box = (await canvas.boundingBox())!;
    const top = await page.evaluate(([x, y]) => window.__parcifyTest!.toPage(x!, y!), [rect.x + rect.w / 2, rect.y]);
    const at = (await handle())!;
    const knob = { x: box.x + at.x, y: box.y + at.y };
    expect(knob.x).toBeCloseTo(top.x, 0);
    expect(top.y - knob.y).toBeCloseTo(24, 0);

    // Llevar el tirador hasta la derecha del centro gira la forma un cuarto de vuelta.
    const c = await page.evaluate(([x, y]) => window.__parcifyTest!.toPage(x!, y!), [rect.x + rect.w / 2, rect.y + rect.h / 2]);
    const reach = Math.hypot(knob.x - c.x, knob.y - c.y);
    await touchDrag(page, knob, { x: c.x + reach, y: c.y });
    await expect.poll(async () => (await nodes(page))[0]!.rotation).toBeCloseTo(Math.PI / 2, 3);
  });

  test('en un rectángulo de 40×40 px, el dedo desde el centro lo mueve y desde 10 px fuera de SE lo redimensiona (CA-16.15)', async ({ page }) => {
    const { canvas, center } = await openEditor(page, 'forma-pequena');

    await canvas.focus();
    await page.keyboard.press('r');
    const { zoom } = await view(page);
    await touchDrag(page, { x: center.x - 20, y: center.y - 20 }, { x: center.x + 20, y: center.y + 20 });
    await expect.poll(async () => (await nodes(page)).length).toBe(1);
    const rect = (await nodes(page))[0]!;
    expect(rect.w * zoom).toBeCloseTo(40, 0);
    expect(rect.h * zoom).toBeCloseTo(40, 0);

    await touchDrag(page, center, { x: center.x + 60, y: center.y + 30 });
    await expect.poll(async () => (await nodes(page))[0]!.x).toBeCloseTo(rect.x + 60 / zoom, 0);
    const moved = (await nodes(page))[0]!;
    expect(moved.y).toBeCloseTo(rect.y + 30 / zoom, 0);
    expect(moved.w).toBe(rect.w);
    expect(moved.h).toBe(rect.h);

    const se = await page.evaluate(([x, y]) => window.__parcifyTest!.toPage(x!, y!), [moved.x + moved.w, moved.y + moved.h]);
    await touchDrag(page, { x: se.x + 10, y: se.y + 10 }, { x: se.x + 50, y: se.y + 40 });
    // La esquina va a donde está el dedo: 10 px de partida más el arrastre.
    await expect.poll(async () => (await nodes(page))[0]!.w).toBeCloseTo(moved.w + 50 / zoom, 0);
    const resized = (await nodes(page))[0]!;
    expect(resized.h).toBeCloseTo(moved.h + 40 / zoom, 0);
    expect(resized.x).toBeCloseTo(moved.x, 3);
  });
});

const boxOf = async (locator: Locator) => (await locator.boundingBox())!;
const opacityOf = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).opacity);
const player = (page: Page) => page.evaluate(() => window.__parcifyTest!.player());

// Un rectángulo creado con el dedo y con «Aparecer» desde el panel derecho: así su fila de la línea de tiempo tiene ▶.
async function animatedRect(page: Page, canvas: Locator, center: { x: number; y: number }) {
  await canvas.focus();
  await page.keyboard.press('r');
  await touchDrag(page, { x: center.x - 60, y: center.y - 40 }, { x: center.x + 60, y: center.y + 40 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const rect = (await nodes(page))[0]!;
  // El botón IA entra en la pastilla cuando llegan las funciones de IA y desplaza a sus vecinos: se espera a que esté.
  // En la emulación, el toque justo después del arrastre en el lienzo a veces no genera el clic: se repite si hace falta.
  await expect(page.getByTestId('ai-toggle')).toBeVisible();
  await expect(async () => {
    await page.getByTestId('right-panel-toggle').tap();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-state', 'open', { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await page.getByTestId('properties-panel').getByTestId('props-anim-presets').getByRole('button', { name: 'Aparecer' }).tap();
  await expect.poll(() => page.evaluate((id) => id in window.__parcifyTest!.animations(), rect.id)).toBe(true);
  // 5 s: la vista previa dura lo bastante para comprobarla y pararla con otro toque.
  const duration = page.getByTestId('properties-panel').getByTestId('props-anim-duration');
  await duration.fill('5');
  await duration.press('Enter');
  await expect.poll(() => page.evaluate((id) => window.__parcifyTest!.animations()[id]?.duration, rect.id)).toBe(5000);
  // Aplicar el efecto lo reproduce una vez: se espera a que termine para que el ▶ de después empiece de cero.
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.player()?.preview), { timeout: 10_000 }).toBe(false);
  return rect;
}

test.describe('@touch tablet sin hover', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'tablet', 'CA-16.13 y CA-16.14 son de tablet; el móvil lo cubre «@touch hojas del móvil»');
  });

  test('ojo, candado, renombrar con pulsación larga, ⋯ de una página y ▶ de la línea de tiempo, solo con toques (CA-16.13)', async ({ page }) => {
    test.setTimeout(90_000);
    const { canvas, center } = await openEditor(page, 'tablet-sin-hover');
    const rect = await animatedRect(page, canvas, center);

    await page.getByTestId('left-panel-toggle').tap();
    const left = page.getByTestId('left-panel');
    await expect(left).toHaveAttribute('data-state', 'open');
    const row = left.getByRole('treeitem').first();
    await expect(row).toBeVisible();
    expect(Math.round((await boxOf(row)).height)).toBe(36);

    // Renombrar: pulsación larga en la fila, menú en el punto con entradas de 44 px y «Renombrar».
    const rowBox = await boxOf(row);
    await longPress(page, { x: rowBox.x + 48, y: rowBox.y + rowBox.height / 2 });
    const menu = page.getByTestId('layer-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(4);
    for (const item of await menu.getByRole('menuitem').all()) expect(Math.round((await boxOf(item)).height)).toBeGreaterThanOrEqual(44);
    expect(await selection(page)).toEqual([rect.id]);
    await menu.getByRole('menuitem', { name: 'Renombrar' }).tap();
    await expect(menu).toHaveCount(0);
    const field = left.getByRole('textbox', { name: 'Nombre de la capa' });
    await expect(field).toBeFocused();
    await field.fill('Caja');
    await field.press('Enter');
    await expect.poll(async () => (await nodes(page))[0]!.name).toBe('Caja');

    // ⋯ de la página: visible sin hover y abre su menú entero.
    const pageMenu = left.getByRole('button', { name: /^Acciones de / });
    expect(await opacityOf(pageMenu)).toBe('1');
    await pageMenu.tap();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // ▶ de la fila del nodo en la línea de tiempo: visible sin hover, de 32 px, y reproduce solo ese nodo.
    await page.getByRole('button', { name: 'Animar', exact: true }).tap();
    const play = page.getByTestId('timeline').getByTestId('timeline-row-play');
    await expect(play).toBeVisible();
    expect(await opacityOf(play)).toBe('1');
    expect(Math.round((await boxOf(play)).width)).toBe(32);
    await play.tap();
    await expect.poll(async () => (await player(page))?.previewIds).toEqual([rect.id]);
    await expect(play).toHaveAccessibleName(/^Detener la animación de/);
    await play.tap();
    await expect.poll(async () => (await player(page))?.preview).toBe(false);

    // Ojo y candado: visibles sin hover, con 32 px de zona, y cada toque cambia la capa.
    const eye = row.locator('button[aria-label="Ocultar"]');
    expect(await opacityOf(eye)).toBe('1');
    expect(Math.round((await boxOf(eye)).width)).toBe(32);
    await eye.tap();
    await expect.poll(async () => (await nodes(page))[0]!.visible).toBe(false);
    const lock = row.locator('button[aria-label="Bloquear"]');
    expect(await opacityOf(lock)).toBe('1');
    await lock.tap();
    await expect.poll(async () => (await nodes(page))[0]!.locked).toBe(true);
  });

  test('el borde del panel derecho y el de la línea de tiempo se agarran con el dedo desde 10 px por fuera (CA-16.14)', async ({ page }) => {
    test.setTimeout(90_000);
    const { canvas, center } = await openEditor(page, 'tablet-asas');
    await animatedRect(page, canvas, center);

    // Borde izquierdo del panel derecho: 10 px a la izquierda de su línea, hacia fuera, ensancha el panel.
    const panel = page.getByTestId('right-panel');
    const before = await boxOf(panel);
    const line = await boxOf(page.getByTestId('panel-resizer-right'));
    const at = { x: line.x - 10, y: line.y + line.height / 2 };
    await touchDrag(page, at, { x: at.x - 40, y: at.y });
    await expect.poll(async () => Math.round((await boxOf(panel)).width - before.width)).toBe(40);
    expect(Math.round((await boxOf(panel)).x + (await boxOf(panel)).width)).toBe(Math.round(before.x + before.width));

    // Borde superior de la línea de tiempo: 10 px por encima de la línea, también bajo la barra de herramientas (que con
    // el dedo deja libre la zona del asa), la sube.
    await page.getByTestId('right-panel-toggle').tap();
    await expect(panel).toHaveAttribute('data-state', 'collapsed');
    await page.getByRole('button', { name: 'Animar', exact: true }).tap();
    const timeline = page.getByTestId('timeline');
    await expect(timeline).toBeVisible();
    const tall = await boxOf(timeline);
    const edge = await boxOf(page.getByTestId('timeline-resizer'));
    const toolbar = await boxOf(page.getByRole('toolbar', { name: 'Barra de herramientas' }));
    const from = { x: toolbar.x + toolbar.width / 2, y: edge.y - 10 };
    expect(toolbar.y + toolbar.height).toBeLessThan(from.y);
    await touchDrag(page, from, { x: from.x, y: from.y - 60 });
    await expect.poll(async () => Math.round((await boxOf(timeline)).height - tall.height)).toBe(60);
  });

  test('«Añadir a la selección» de la línea de tiempo no cambia los toques en el lienzo', async ({ page }) => {
    const { canvas, center } = await openEditor(page, 'tablet-sumar');
    await canvas.focus();
    await page.keyboard.press('r');
    await touchDrag(page, { x: center.x - 160, y: center.y - 40 }, { x: center.x - 60, y: center.y + 40 });
    await expect.poll(async () => (await nodes(page)).length).toBe(1);
    await canvas.focus();
    await page.keyboard.press('r');
    await touchDrag(page, { x: center.x + 60, y: center.y - 40 }, { x: center.x + 160, y: center.y + 40 });
    await expect.poll(async () => (await nodes(page)).length).toBe(2);
    const [a, b] = await nodes(page);
    const empty = { x: center.x, y: center.y + 200 };

    // Chromium no genera el clic de un toque que llega justo después de un arrastre rápido: se espera a que pase.
    await page.waitForTimeout(500);
    const animate = page.getByRole('button', { name: 'Animar', exact: true });
    await animate.tap();
    const additive = page.getByTestId('timeline').getByRole('button', { name: 'Añadir a la selección' });
    await additive.tap();
    await expect(additive).toHaveAttribute('aria-pressed', 'true');
    await animate.tap();
    await expect(page.getByTestId('timeline')).toBeHidden();
    // En tablet la barra contextual no muestra el conmutador, así que el lienzo no lo aplica.
    await expect(page.getByTestId('context-bar').getByRole('button', { name: 'Añadir a la selección' })).toHaveCount(0);

    const at = async (node: Node) => page.evaluate(([x, y]) => window.__parcifyTest!.toPage(x!, y!), [node.x + node.w / 2, node.y + node.h / 2]);
    await page.touchscreen.tap(empty.x, empty.y);
    await expect.poll(() => selection(page)).toEqual([]);
    const pa = await at(a!);
    await page.touchscreen.tap(pa.x, pa.y);
    await expect.poll(() => selection(page)).toEqual([a!.id]);
    const pb = await at(b!);
    await page.touchscreen.tap(pb.x, pb.y);
    await expect.poll(() => selection(page)).toEqual([b!.id]);
  });
});

// Punto de la página bajo un punto de la ventana (inverso de toPage).
const toWorld = async (page: Page, at: { x: number; y: number }) => {
  const { zoom, x, y } = await view(page);
  return { x: (at.x - x) / zoom, y: (at.y - y) / zoom };
};

test.describe('@touch maqueta móvil', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'mobile', 'CA-16.4 (móvil), CA-16.10 y CA-16.12 son de la maqueta móvil');
  });

  test('barra superior y barra inferior a todo el ancho, con el área segura de abajo (CA-16.10)', async ({ page }) => {
    await openEditor(page, 'movil-maqueta');
    const width = page.viewportSize()!.width;
    const top = page.getByTestId('mobile-top-bar');
    const dock = page.getByTestId('dock');
    await expect(top).toBeVisible();
    await expect(dock).toBeVisible();
    await expect(page.getByTestId('left-panel-pill')).toHaveCount(0);
    await expect(page.getByTestId('right-panel-pill')).toHaveCount(0);
    expect(Math.round((await boxOf(top)).width)).toBe(width);
    expect(Math.round((await boxOf(dock)).width)).toBe(width);
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('viewport-fit=cover');

    // El padding inferior de la barra es el área segura: con 34 px emulados, la barra crece 34 px y el CSS calculado
    // lo refleja. Sin la emulación de CDP, al menos la regla que se le aplica usa env(safe-area-inset-bottom).
    const cdp = await page.context().newCDPSession(page);
    const emulated = await cdp
      .send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 34, left: 0, right: 0 } })
      .then(
        () => true,
        () => false,
      );
    if (emulated) {
      await expect.poll(() => dock.evaluate((element) => getComputedStyle(element).paddingBottom)).toBe('34px');
      expect(Math.round((await boxOf(dock)).height)).toBe(56 + 34);
    } else {
      const usesEnv = await dock.evaluate((element) => {
        const rules = (list: CSSRuleList): CSSStyleRule[] =>
          [...list].flatMap((rule) => ('cssRules' in rule ? rules((rule as CSSGroupingRule).cssRules) : rule instanceof CSSStyleRule ? [rule] : []));
        return [...document.styleSheets]
          .flatMap((sheet) => rules(sheet.cssRules))
          .some((rule) => element.matches(rule.selectorText) && rule.style.paddingBottom.includes('env(safe-area-inset-bottom)'));
      });
      expect(usesEnv).toBe(true);
      expect(Math.round((await boxOf(dock)).height)).toBe(56);
    }
  });

  test('una pulsación larga sobre una forma abre la hoja de acciones con la forma seleccionada (CA-16.4)', async ({ page }) => {
    const { canvas, center } = await openEditor(page, 'movil-acciones');
    await canvas.focus();
    await page.keyboard.press('r');
    await touchDrag(page, { x: center.x - 60, y: center.y - 40 }, { x: center.x + 60, y: center.y + 40 });
    await expect.poll(async () => (await nodes(page)).length).toBe(1);
    const rect = (await nodes(page))[0]!;
    const empty = { x: center.x, y: center.y - 200 };

    await page.touchscreen.tap(empty.x, empty.y);
    await expect.poll(() => selection(page)).toEqual([]);
    await longPress(page, center, 550);
    const sheet = page.getByTestId('action-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    expect(await selection(page)).toEqual([rect.id]);
    // Filas de 48 px; «Borrar» va al final, antes de «Cancelar».
    const rows = sheet.locator('button[data-action]');
    for (const row of await rows.all()) expect(Math.round((await boxOf(row)).height)).toBe(48);
    await expect(rows.last()).toHaveAttribute('data-action', 'delete');
    await sheet.getByRole('button', { name: 'Cancelar' }).tap();
    await expect(sheet).toHaveCount(0);
    await page.waitForFunction(() => document.body.style.pointerEvents !== 'none');

    // «Duplicar» desde la hoja actúa sobre la forma.
    await longPress(page, center, 550);
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Duplicar' }).tap();
    await expect.poll(async () => (await nodes(page)).length).toBe(2);
    await expect(sheet).toHaveCount(0);
    await page.waitForFunction(() => document.body.style.pointerEvents !== 'none');

    // Si el dedo se mueve 10 px antes de tiempo, no hay hoja.
    await page.touchscreen.tap(empty.x, empty.y);
    await expect.poll(() => selection(page)).toEqual([]);
    await longPress(page, center, 650, { x: 10, y: 0 });
    await page.waitForTimeout(100);
    await expect(sheet).toHaveCount(0);
  });

  test('con Rectángulo y sin selección, la barra contextual ofrece proporción y centro, y «Mantener herramienta» deja la herramienta (CA-16.12)', async ({ page }) => {
    const { center } = await openEditor(page, 'movil-modificadores');
    const dock = page.getByTestId('dock');
    const bar = page.getByTestId('context-bar');
    const rectTool = dock.getByRole('button', { name: 'Rectángulo (R)' });

    await rectTool.tap();
    await expect(bar).toHaveAttribute('data-kind', 'create');
    await expect(bar.getByTestId('context-create-tool')).toHaveText('Rectángulo');
    const proportional = bar.getByRole('button', { name: 'Mantener proporción' });
    const fromCenter = bar.getByRole('button', { name: 'Desde el centro' });
    await expect(proportional).toBeVisible();
    await expect(fromCenter).toBeVisible();
    for (const control of [proportional, fromCenter]) expect(Math.round((await boxOf(control)).height)).toBe(44);
    // La barra va encima de la barra inferior, a todo el ancho.
    const barBox = await boxOf(bar);
    expect(Math.round(barBox.y + barBox.height)).toBe(Math.round((await boxOf(dock)).y));
    expect(Math.round(barBox.width)).toBe(page.viewportSize()!.width);

    // Mantener proporción: un arrastre de 100×40 deja un cuadrado.
    await proportional.tap();
    await expect(proportional).toHaveAttribute('aria-pressed', 'true');
    await touchDrag(page, { x: center.x - 50, y: center.y - 120 }, { x: center.x + 50, y: center.y - 80 });
    await expect.poll(async () => (await nodes(page)).length).toBe(1);
    const square = (await nodes(page))[0]!;
    expect(square.w).toBeCloseTo(square.h, 6);
    // Sin «Mantener herramienta», al crear se vuelve a Seleccionar.
    await expect(rectTool).toHaveAttribute('aria-pressed', 'false');

    // Desde el centro: el punto donde empieza el arrastre queda en el centro de la forma.
    await page.touchscreen.tap(center.x, center.y + 150);
    await expect.poll(() => selection(page)).toEqual([]);
    await rectTool.tap();
    await expect(bar).toHaveAttribute('data-kind', 'create');
    await proportional.tap();
    await expect(proportional).toHaveAttribute('aria-pressed', 'false');
    await fromCenter.tap();
    await expect(fromCenter).toHaveAttribute('aria-pressed', 'true');
    const start = { x: center.x, y: center.y + 60 };
    const origin = await toWorld(page, start);
    await touchDrag(page, start, { x: start.x + 100, y: start.y + 40 });
    await expect.poll(async () => (await nodes(page)).length).toBe(2);
    const centered = (await nodes(page)).find((node) => node.id !== square.id)!;
    expect(Math.abs(centered.x + centered.w / 2 - origin.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(centered.y + centered.h / 2 - origin.y)).toBeLessThanOrEqual(0.5);
    // Chromium no genera el clic de un toque que llega justo después de un arrastre rápido: se espera a que pase.
    await page.waitForTimeout(500);
    await fromCenter.tap();
    await expect(fromCenter).toHaveAttribute('aria-pressed', 'false');

    // «Mantener herramienta» al final del desplegable de Formas: la herramienta sigue activa después de crear.
    await page.touchscreen.tap(center.x, center.y + 220);
    await expect.poll(() => selection(page)).toEqual([]);
    await dock.getByRole('button', { name: 'Formas', exact: true }).tap();
    const keep = page.getByRole('menuitemcheckbox', { name: 'Mantener herramienta' });
    await expect(keep).toBeVisible();
    expect(Math.round((await boxOf(keep)).height)).toBeGreaterThanOrEqual(44);
    await keep.tap();
    await expect(keep).toHaveCount(0);
    await expect(rectTool).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction(() => document.body.style.pointerEvents !== 'none');
    await touchDrag(page, { x: center.x - 120, y: center.y - 220 }, { x: center.x - 60, y: center.y - 180 });
    await expect.poll(async () => (await nodes(page)).length).toBe(3);
    await expect(rectTool).toHaveAttribute('aria-pressed', 'true');
  });
});

// Instantes absolutos (ms) de los keyframes de una pista, de menor a mayor.
type Animation = { duration: number; delay: number; tracks: Partial<Record<string, Record<string, { t: number }>>> };
const times = async (page: Page, id: string, prop: string) => {
  const anim = await page.evaluate((nodeId) => (window.__parcifyTest!.animations() as unknown as Record<string, Animation>)[nodeId] ?? null, id);
  return Object.values(anim?.tracks[prop] ?? {})
    .map((kf) => Math.round(anim!.delay + kf.t * anim!.duration))
    .sort((a, b) => a - b);
};

// Un rectángulo creado con el dedo desde la barra inferior, encima del centro (las hojas tapan la mitad de abajo).
async function mobileRect(page: Page, center: { x: number; y: number }) {
  await page.getByTestId('dock').getByRole('button', { name: 'Rectángulo (R)' }).tap();
  await touchDrag(page, { x: center.x - 60, y: center.y - 160 }, { x: center.x + 60, y: center.y - 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  // Chromium no genera el clic de un toque que llega justo después de un arrastre rápido: se espera a que pase.
  await page.waitForTimeout(500);
  return (await nodes(page))[0]!;
}

async function fromMenu(page: Page, entry: string) {
  await page.getByTestId('mobile-menu').tap();
  const menu = page.getByTestId('mobile-menu-sheet');
  await menu.getByRole('button', { name: entry, exact: true }).tap();
  await expect(menu).toHaveCount(0);
}

test.describe('@touch hojas del móvil', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'mobile', 'Las hojas inferiores son de la maqueta móvil');
  });

  test('en la hoja de la línea de tiempo, dos keyframes con «Añadir a la selección» se duplican desde la hoja de acciones (CA-5.13)', async ({ page }) => {
    test.setTimeout(90_000);
    const { center } = await openEditor(page, 'movil-linea-de-tiempo');
    const rect = await mobileRect(page, center);

    // «Deslizar» desde la hoja de propiedades: Desplazamiento Y con keyframes en 0 y 500 ms.
    await page.getByTestId('dock-properties').tap();
    const props = page.getByTestId('properties-sheet');
    await expect(props).toBeVisible();
    await expect(props.getByTestId('properties-panel')).toHaveAttribute('data-touch-density', 'touch');
    await props.getByTestId('props-anim-presets').getByRole('button', { name: 'Deslizar' }).tap();
    await expect.poll(() => times(page, rect.id, 'offsetY')).toEqual([0, 500]);
    await expect.poll(() => page.evaluate(() => window.__parcifyTest!.player()?.preview), { timeout: 10_000 }).toBe(false);
    await props.getByRole('button', { name: 'Cerrar', exact: true }).tap();
    await expect(props).toHaveCount(0);

    await fromMenu(page, 'Línea de tiempo');
    const sheet = page.getByTestId('timeline-sheet');
    await expect(sheet).toBeVisible();
    const grid = sheet.getByRole('grid', { name: 'Línea de tiempo' });
    const rows = grid.getByRole('row');
    await expect(rows.first()).toBeVisible();
    // Filas de nodo de 44 px y de propiedad de 32 px; en la fila de propiedad, el valor como texto.
    expect(await rows.evaluateAll((els) => els.slice(0, 2).map((el) => Math.round(el.getBoundingClientRect().height)))).toEqual([44, 32]);
    await expect(sheet.getByTestId('timeline-row-value').first()).toBeVisible();

    const kf = (time: string) => grid.getByRole('gridcell', { name: new RegExp(`^Desplazamiento Y, fotograma clave en ${time}`) });
    const additive = sheet.getByRole('button', { name: 'Añadir a la selección' });
    expect(Math.round((await boxOf(additive)).height)).toBe(44);
    await additive.tap();
    await expect(additive).toHaveAttribute('aria-pressed', 'true');
    await kf('0,00 s').tap();
    await kf('0,50 s').tap();
    await expect(sheet.locator('[data-testid="keyframe"][data-selected]')).toHaveCount(2);

    const at = await boxOf(kf('0,50 s'));
    await longPress(page, { x: at.x + at.width / 2, y: at.y + at.height / 2 }, 600);
    const actions = page.getByTestId('keyframe-menu');
    await expect(actions).toBeVisible();
    await expect(actions).toHaveAttribute('aria-modal', 'true');
    await actions.getByRole('button', { name: 'Duplicar' }).tap();
    await expect.poll(() => times(page, rect.id, 'offsetY')).toHaveLength(4);
    await expect(actions).toHaveCount(0);
  });

  test('con la línea de tiempo grabando, «Propiedades» de su hoja la tapa sin cerrarla y la opacidad se graba en el cabezal (§3.9)', async ({ page }) => {
    test.setTimeout(90_000);
    const { center } = await openEditor(page, 'movil-grabar-propiedades');
    const rect = await mobileRect(page, center);

    await fromMenu(page, 'Línea de tiempo');
    const sheet = page.getByTestId('timeline-sheet');
    await expect(sheet).toBeVisible();
    const timeline = sheet.getByTestId('timeline');
    await sheet.getByTestId('timeline-record').tap();
    await expect(timeline).toHaveAttribute('data-recording', '');

    const open = sheet.getByTestId('timeline-sheet-properties');
    expect(Math.round((await boxOf(open)).height)).toBe(44);
    await open.tap();
    const props = page.getByTestId('properties-sheet');
    await expect(props).toBeVisible();
    await expect(sheet).toHaveCount(0);

    const opacity = props.getByTestId('props-opacity');
    await opacity.fill('40');
    await opacity.press('Enter');
    await expect.poll(async () => (await times(page, rect.id, 'opacity')).length).toBeGreaterThan(0);
    expect(await times(page, rect.id, 'opacity')).toContain(0);

    await props.getByRole('button', { name: 'Cerrar', exact: true }).tap();
    await expect(props).toHaveCount(0);
    await expect(page.getByTestId('timeline-sheet')).toBeVisible();
    await expect(page.getByTestId('timeline-sheet').getByTestId('timeline')).toHaveAttribute('data-recording', '');
  });

  test('una pulsación larga en una capa abre sus acciones y «Renombrar» abre la hoja; al guardar vuelve la de capas (CA-16.13, móvil)', async ({ page }) => {
    const { center } = await openEditor(page, 'movil-capas');
    await mobileRect(page, center);
    await expect(page.getByTestId('left-panel')).toHaveCount(0);

    await fromMenu(page, 'Páginas y capas');
    const layers = page.getByTestId('layers-sheet');
    await expect(layers).toBeVisible();
    await expect(layers).toHaveAttribute('aria-modal', 'false');
    const row = layers.getByRole('treeitem').first();
    expect(Math.round((await boxOf(row)).height)).toBe(44);
    for (const name of ['Ocultar', 'Bloquear']) expect(Math.round((await boxOf(row.locator(`button[aria-label="${name}"]`))).width)).toBe(44);

    const box = await boxOf(row);
    await longPress(page, { x: box.x + 90, y: box.y + box.height / 2 }, 600);
    const actions = page.getByTestId('layer-menu');
    await expect(actions).toBeVisible();
    await actions.getByRole('button', { name: 'Renombrar' }).tap();
    const rename = page.getByTestId('rename-sheet');
    await expect(rename).toBeVisible();
    await expect(layers).toHaveCount(0);
    const field = rename.getByRole('textbox', { name: 'Nombre de la capa' });
    await expect(field).toBeFocused();
    await field.fill('Caja');
    await field.press('Enter');
    await expect.poll(async () => (await nodes(page))[0]!.name).toBe('Caja');
    await expect(rename).toHaveCount(0);
    await expect(page.getByTestId('layers-sheet')).toBeVisible();
  });
});

// Objetivos visibles de `root` por debajo de 44×44 (CA-16.7): sin input ni textarea y sin los rombos de la línea de
// tiempo (data-touch-exempt). Si `root` tiene scroll, se recorre entero.
async function smallTargets(root: Locator): Promise<string[]> {
  const measure = () =>
    root.evaluate((element) =>
      [...element.querySelectorAll<HTMLElement>('button, [role=menuitem], [role=menuitemcheckbox], [role=tab], [role=switch]')]
        .filter((el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !el.closest('[data-touch-exempt], [aria-hidden="true"]'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 2 && r.height > 2 && (r.width < 43.5 || r.height < 43.5))
        .map(({ el, r }) => `${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24)}: ${Math.round(r.width)}×${Math.round(r.height)}`),
    );
  const found = new Set(await measure());
  const scrollers = root.locator('.overflow-y-auto');
  for (const scroller of await scrollers.all()) {
    if (!(await scroller.isVisible())) continue;
    const [height, client] = await scroller.evaluate((el) => [el.scrollHeight, el.clientHeight]);
    for (let top = client / 2; top < height; top += client / 2) {
      await scroller.evaluate((el, value) => (el.scrollTop = value), top);
      for (const item of await measure()) found.add(item);
    }
    await scroller.evaluate((el) => (el.scrollTop = 0));
  }
  return [...found];
}

const bodyReady = (page: Page) => page.waitForFunction(() => document.body.style.pointerEvents !== 'none');

// Entrada del menú ⋯. Chromium no genera el clic de un toque que llega justo después de otro gesto: se espera antes.
async function viaMenu(page: Page, entry: string) {
  await page.waitForTimeout(500);
  await fromMenu(page, entry);
}

async function closeSheet(page: Page, testid: string) {
  const sheet = page.getByTestId(testid);
  await sheet.getByRole('button', { name: 'Cerrar', exact: true }).first().tap();
  await expect(sheet).toHaveCount(0);
  await bodyReady(page);
}

const nodeOf = async (page: Page, id: string) => (await nodes(page)).find((node) => node.id === id)!;
const screenCenter = (page: Page, node: Node) => page.evaluate(([x, y]) => window.__parcifyTest!.toPage(x!, y!), [node.x + node.w / 2, node.y + node.h / 2]);

test.describe('@touch recorrido móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'mobile', 'CA-16.6 y CA-16.7 son de la maqueta móvil');
  });

  test('a 390×844, con el dedo: rectángulo, color, giro, texto, chat, versión, keyframe grabado, Presentar y Exportar (CA-16.6)', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Sin permiso', 'NotAllowedError'));
    });
    const { canvas, center } = await openEditor(page, 'movil-recorrido');
    const rect = await mobileRect(page, center);

    // Color desde la hoja de propiedades: un toque en el área del selector.
    await page.getByTestId('dock-properties').tap();
    const props = page.getByTestId('properties-sheet');
    await expect(props).toBeVisible();
    const fill = async () => ((await nodeOf(page, rect.id)) as unknown as { fill: string }).fill;
    const before = await fill();
    await props.getByTestId('props-fill-row-swatch').tap();
    const picker = page.getByRole('dialog', { name: 'Selector de color' });
    await expect(picker).toBeVisible();
    const area = await boxOf(picker.getByRole('slider', { name: 'Saturación y brillo' }));
    await page.touchscreen.tap(area.x + area.width * 0.8, area.y + area.height * 0.3);
    await expect.poll(fill).not.toBe(before);
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await bodyReady(page);
    await closeSheet(page, 'properties-sheet');

    // Giro con el tirador táctil: llevarlo a la derecha del centro es un cuarto de vuelta.
    await page.waitForTimeout(500);
    const handle = await page.evaluate(() => window.__parcifyTest!.overlayModel()?.selection?.rotateHandle ?? null);
    expect(handle).not.toBeNull();
    const area0 = await boxOf(canvas);
    const knob = { x: area0.x + handle!.x, y: area0.y + handle!.y };
    const c = await screenCenter(page, await nodeOf(page, rect.id));
    const reach = Math.hypot(knob.x - c.x, knob.y - c.y);
    await touchDrag(page, knob, { x: c.x + reach, y: c.y });
    await expect.poll(async () => (await nodeOf(page, rect.id)).rotation).toBeCloseTo(Math.PI / 2, 2);

    // Texto: la T de la barra inferior, un toque en el lienzo y escribir.
    await page.waitForTimeout(500);
    await page.getByTestId('dock').getByRole('button', { name: 'Texto (T)' }).tap();
    await page.touchscreen.tap(center.x - 80, center.y + 20);
    await expect.poll(() => page.evaluate(() => window.__parcifyTest!.editing())).not.toBeNull();
    await page.keyboard.type('Hola');
    await expect.poll(async () => Object.values(await page.evaluate(() => window.__parcifyTest!.texts()))).toEqual(['Hola']);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__parcifyTest!.editing())).toBeNull();
    // Se vuelve a seleccionar el rectángulo con un toque: al abrir una hoja, la cámara deja visible la selección.
    await page.waitForTimeout(500);
    const onRect = await screenCenter(page, await nodeOf(page, rect.id));
    await page.touchscreen.tap(onRect.x, onRect.y);
    await expect.poll(() => selection(page)).toEqual([rect.id]);

    // Chat: enviar un mensaje desde su hoja.
    await viaMenu(page, 'Chat e IA');
    const chat = page.getByTestId('conversation-sheet');
    await expect(chat).toBeVisible();
    await chat.getByTestId('chat-input').fill('Hola desde el móvil');
    await chat.getByTestId('chat-send').tap();
    await expect(chat.getByTestId('chat-bubble').filter({ hasText: 'Hola desde el móvil' })).toBeVisible();
    await expect(chat.getByTestId('chat-message').first()).not.toHaveAttribute('data-pending', 'sending');
    await closeSheet(page, 'conversation-sheet');

    // Versión: crearla, verla a pantalla completa y volver a la hoja.
    await viaMenu(page, 'Versiones');
    const versions = page.getByTestId('versions-sheet');
    await expect(versions).toBeVisible();
    await versions.getByRole('button', { name: 'Crear versión con nombre' }).tap();
    const named = page.getByRole('dialog', { name: 'Crear versión con nombre' });
    await named.getByRole('textbox').fill('Recorrido');
    await named.getByRole('button', { name: 'Crear versión', exact: true }).tap();
    const row = versions.getByTestId('version-row').filter({ hasText: 'Recorrido' });
    await expect(row).toHaveCount(1);
    await bodyReady(page);
    await page.waitForTimeout(500);
    await row.getByTestId('version-view').tap();
    const overlay = page.getByTestId('version-overlay');
    await expect(overlay).toBeVisible();
    await expect(page.getByTestId('version-preview')).toHaveAttribute('data-state', 'ready');
    await page.getByTestId('version-overlay-close').tap();
    await expect(overlay).toHaveCount(0);
    await expect(versions).toBeVisible();
    await closeSheet(page, 'versions-sheet');

    // Línea de tiempo: Grabar y mover el rectángulo crea sus keyframes.
    await viaMenu(page, 'Línea de tiempo');
    const timeline = page.getByTestId('timeline-sheet');
    await expect(timeline).toBeVisible();
    await timeline.getByTestId('timeline-record').tap();
    await expect(timeline.getByTestId('timeline')).toHaveAttribute('data-recording', '');
    await page.waitForTimeout(500);
    const from = await screenCenter(page, await nodeOf(page, rect.id));
    expect(from.y).toBeLessThan((await boxOf(timeline)).y);
    await touchDrag(page, from, { x: from.x + 40, y: from.y });
    await expect.poll(async () => (await times(page, rect.id, 'offsetX')).length).toBeGreaterThan(0);
    await closeSheet(page, 'timeline-sheet');

    // Presentar la página (sin marcos) y salir.
    await viaMenu(page, 'Presentar');
    await page.getByRole('dialog', { name: 'Esta página no tiene marcos' }).getByRole('button', { name: 'Presentar', exact: true }).tap();
    const present = page.getByRole('dialog', { name: 'Presentación' });
    await expect(present).toBeVisible();
    // Los controles se ocultan solos: si ya no se ven, un toque en el centro los muestra.
    const controls = present.locator('[data-present-controls]');
    const stage = await boxOf(present);
    await expect(async () => {
      if ((await present.count()) === 0) return;
      if ((await controls.evaluate((el) => getComputedStyle(el).opacity)) !== '1') {
        await page.touchscreen.tap(stage.x + stage.width / 2, stage.y + stage.height / 2);
        await expect(controls).toHaveCSS('opacity', '1', { timeout: 1000 });
      }
      await present.getByRole('button', { name: 'Salir de la presentación' }).tap({ timeout: 1000 });
      await expect(present).toHaveCount(0, { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await bodyReady(page);

    // Exportar: el diálogo tiene sus botones de 44 px y descarga un PNG.
    await viaMenu(page, 'Exportar');
    const exporting = page.getByRole('dialog', { name: 'Exportar imagen' });
    await expect(exporting).toBeVisible();
    expect(await smallTargets(exporting)).toEqual([]);
    const download = page.waitForEvent('download');
    await exporting.getByRole('button', { name: 'Exportar', exact: true }).tap();
    expect((await download).suggestedFilename()).toMatch(/\.png$/);
    await expect(exporting).toHaveCount(0);
  });

  test('un doble toque en el centro de un texto de una línea vuelve a abrir su edición', async ({ page }) => {
    const { center } = await openEditor(page, 'movil-texto');
    const editing = () => page.evaluate(() => window.__parcifyTest!.editing());
    await page.getByTestId('dock').getByRole('button', { name: 'Texto (T)' }).tap();
    await page.touchscreen.tap(center.x - 120, center.y - 120);
    await expect.poll(editing).not.toBeNull();
    await page.keyboard.type('Uno');
    await page.keyboard.press('Escape');
    await expect.poll(editing).toBeNull();
    const text = (await nodes(page)).find((node) => node.type === 'text')!;
    // Con 30 px de alto, N y S quedan a 15 px del centro: el centro tiene que ser el cuerpo, no un tirador.
    await expect.poll(async () => (await nodeOf(page, text.id)).w).toBeGreaterThan(20);
    const at = await screenCenter(page, await nodeOf(page, text.id));
    await page.waitForTimeout(400);
    await doubleTap(page, at);
    await expect.poll(editing).toBe(text.id);
    await page.keyboard.press('End');
    await page.keyboard.type(' dos');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await page.evaluate(() => window.__parcifyTest!.texts()))[text.id]).toBe('Uno dos');
  });

  test('ningún objetivo de la barra superior, la inferior, la contextual ni las hojas mide menos de 44×44 (CA-16.7)', async ({ page }) => {
    test.setTimeout(150_000);
    const { center } = await openEditor(page, 'movil-44');
    const surfaces: Record<string, string[]> = {};
    const measure = async (label: string, root: Locator) => {
      await expect(root).toBeVisible();
      // Las hojas suben con una transición: se mide en reposo.
      await page.waitForTimeout(400);
      surfaces[label] = await smallTargets(root);
    };

    await measure('barra superior', page.getByTestId('mobile-top-bar'));
    await measure('barra inferior', page.getByTestId('dock'));
    await page.getByTestId('dock').getByRole('button', { name: 'Rectángulo (R)' }).tap();
    await expect(page.getByTestId('context-bar')).toHaveAttribute('data-kind', 'create');
    await measure('barra contextual con Rectángulo y sin selección', page.getByTestId('context-bar'));

    await touchDrag(page, { x: center.x - 60, y: center.y - 160 }, { x: center.x + 60, y: center.y - 80 });
    await expect.poll(async () => (await nodes(page)).length).toBe(1);
    const rect = (await nodes(page))[0]!;
    await page.waitForTimeout(500);
    await measure('barra contextual con una forma', page.getByTestId('context-bar'));
    await measure('barra inferior con selección', page.getByTestId('dock'));

    await page.getByTestId('dock-properties').tap();
    const props = page.getByTestId('properties-sheet');
    await measure('Propiedades', props);
    // Un efecto deja una animación para la biblioteca y pistas para la línea de tiempo.
    await props.getByTestId('props-anim-presets').getByRole('button', { name: 'Deslizar' }).tap();
    await expect.poll(() => times(page, rect.id, 'offsetY')).toEqual([0, 500]);
    await expect.poll(() => page.evaluate(() => window.__parcifyTest!.player()?.preview), { timeout: 10_000 }).toBe(false);
    await closeSheet(page, 'properties-sheet');

    await page.waitForTimeout(500);
    await longPress(page, await screenCenter(page, await nodeOf(page, rect.id)), 600);
    const actions = page.getByTestId('action-sheet');
    await measure('Acciones', actions);
    await actions.getByRole('button', { name: 'Cancelar' }).tap();
    await expect(actions).toHaveCount(0);
    await bodyReady(page);

    await viaMenu(page, 'Páginas y capas');
    await measure('Capas', page.getByTestId('layers-sheet'));
    await closeSheet(page, 'layers-sheet');

    await viaMenu(page, 'Animaciones');
    const animations = page.getByTestId('animations-sheet');
    await expect(animations.getByTestId('animation-row')).not.toHaveCount(0);
    await measure('Animaciones', animations);
    await closeSheet(page, 'animations-sheet');

    await viaMenu(page, 'Línea de tiempo');
    const timeline = page.getByTestId('timeline-sheet');
    await expect(timeline.getByTestId('keyframe').first()).toBeVisible();
    await measure('Línea de tiempo', timeline);
    await closeSheet(page, 'timeline-sheet');

    await viaMenu(page, 'Versiones');
    const versions = page.getByTestId('versions-sheet');
    await versions.getByRole('button', { name: 'Crear versión con nombre' }).tap();
    const named = page.getByRole('dialog', { name: 'Crear versión con nombre' });
    await named.getByRole('textbox').fill('Medida');
    await named.getByRole('button', { name: 'Crear versión', exact: true }).tap();
    await expect(versions.getByTestId('version-row')).not.toHaveCount(0);
    await bodyReady(page);
    await measure('Versiones', versions);
    await closeSheet(page, 'versions-sheet');

    await viaMenu(page, 'Galería');
    const gallery = page.getByTestId('gallery-sheet');
    await page.getByTestId('gallery-input').setInputFiles({ name: 'cuadro.png', mimeType: 'image/png', buffer: solidPng(200, [30, 160, 90]) });
    await expect(gallery.getByTestId('gallery-item')).toHaveCount(1, { timeout: 30_000 });
    await measure('Galería', gallery);
    await closeSheet(page, 'gallery-sheet');

    expect(surfaces).toEqual(Object.fromEntries(Object.keys(surfaces).map((label) => [label, []])));
  });
});
