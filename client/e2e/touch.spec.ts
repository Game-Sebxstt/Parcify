import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { longPress, pinch, touchDrag, touchThenPinch, twoFingerPan } from './helpers/touch.ts';

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
    test.skip(test.info().project.name !== 'tablet', 'CA-16.13 y CA-16.14 son de tablet; en móvil van las hojas de T8.3');
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
