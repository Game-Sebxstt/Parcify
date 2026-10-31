import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { canvasGap } from './helpers/canvas.ts';
import { solidPng } from './helpers/image.ts';
import { toolbar } from './helpers/tools.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; rotation: number };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const toPage = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__parcifyTest!.toPage(px!, py!), [x, y]);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await expect(page.getByTestId('connection-status')).toHaveText('Conectado');
  // El overlay de la vista inicial puede tardar un frame en posicionar la cámara.
  await page.waitForTimeout(100);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifiers: string[] = []) {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}

const center = (node: Node) => ({ x: node.x + node.w / 2, y: node.y + node.h / 2 });

// Tamaño con que trabaja la cámara frente al del contenedor del lienzo.
const sizes = (page: Page) =>
  page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('[role="application"]')!;
    return { camera: window.__parcifyTest!.cameraSize(), container: { width: container.clientWidth, height: container.clientHeight } };
  });

test('la cámara mide lo mismo que el contenedor al abrir y tras cambiar el tamaño de la ventana', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await createVerifiedAccount(page.request, `camara-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const opened = await sizes(page);
  expect(opened.camera).toEqual(opened.container);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect
    .poll(async () => {
      const now = await sizes(page);
      return now.container.width > opened.container.width && now.camera?.width === now.container.width && now.camera.height === now.container.height;
    })
    .toBe(true);
});

test('sacar el puntero del lienzo quita el contorno de hover', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `hover-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 40 };

  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  // Sin selección, para que el contorno que se ve sea el del hover. Los paneles flotan sobre el lienzo: se vacía con Esc.
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection().length)).toBe(0);

  const hover = () => page.evaluate(() => (window.__parcifyTest!.overlayModel()?.hover ?? null) !== null);
  await page.mouse.move(origin.x + 60, origin.y + 40);
  await expect.poll(hover).toBe(true);
  // El panel derecho tapa el lienzo: pasar a él es sacar el puntero del lienzo.
  const panel = (await page.getByTestId('right-panel').boundingBox())!;
  await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2, { steps: 4 });
  await expect.poll(hover, { timeout: 1_000 }).toBe(false);
});

// Cada entrada se ve entera y es la que recibe el puntero en su centro: nada la tapa ni la recorta.
async function expectItemsReachable(page: Page, menu: ReturnType<Page['getByRole']>) {
  for (const item of await menu.getByRole('menuitem').all()) {
    const box = (await item.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.closest('[role="menuitem"]')?.textContent ?? null,
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(hit).toBe(await item.textContent());
  }
}

test('el menú de una página sale entero aunque la lista mida 100 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await createVerifiedAccount(page.request, `menu-pagina-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);

  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Añadir página' }).click();
  const list = page.getByRole('list', { name: 'Páginas' });
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await list.evaluate((element) => {
    element.style.height = '100px';
    element.style.maxHeight = '100px';
  });
  expect(Math.round((await list.boundingBox())!.height)).toBe(100);

  await page.getByRole('button', { name: 'Acciones de Página 1' }).click();
  const menu = page.getByRole('menu', { name: 'Acciones de Página 1' });
  await expect(menu.getByRole('menuitem')).toHaveCount(4);
  await expect(menu.getByRole('menuitem', { name: 'Borrar página' })).toBeVisible();
  await expectItemsReachable(page, menu);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await page.getByRole('button', { name: 'Acciones de Página 1' }).click();
  await menu.getByRole('menuitem', { name: 'Renombrar' }).click();
  await expect(menu).toBeHidden();
  const name = list.getByRole('textbox', { name: 'Nombre de la página' });
  await expect(name).toBeFocused();
  await page.keyboard.type('Portada');
  await page.keyboard.press('Enter');
  await expect(name).toBeHidden();
  await expect(list.getByRole('button', { name: 'Portada', exact: true })).toBeVisible();
});

test('el menú contextual abierto junto a los bordes derecho e inferior queda dentro de la ventana', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await createVerifiedAccount(page.request, `menu-borde-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const menu = page.getByRole('menu', { name: 'Acciones del lienzo' });

  for (const point of [
    { x: 1440 - 10, y: 450 },
    { x: 720, y: 900 - 10 },
    { x: 1440 - 10, y: 900 - 10 },
  ]) {
    // dispatchEvent de Playwright crea un Event genérico para «contextmenu», sin clientX/clientY: hace falta un MouseEvent.
    // El punto cae fuera de la caja del lienzo (sobre los paneles) a propósito: así se prueba el borde de la ventana.
    await canvas.evaluate((element, at) => {
      element.dispatchEvent(new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y, button: 2, bubbles: true, cancelable: true }));
    }, point);
    await expect(menu).toBeVisible();
    // bits-ui monta el panel fuera de la vista mientras lo mide y lo coloca en el frame siguiente.
    await expect(async () => {
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(8 - 0.5);
      expect(box.y).toBeGreaterThanOrEqual(8 - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(1440 - 8 + 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(900 - 8 + 0.5);
    }).toPass({ timeout: 5_000 });
    await expectItemsReachable(page, menu);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});

test('«Renombrar» del menú contextual edita el nombre en la fila de capas', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `renombrar-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 40 };

  await canvas.focus();
  await page.keyboard.press('r');
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);

  await page.mouse.click(origin.x + 60, origin.y + 40, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Acciones del lienzo' });
  await menu.getByRole('menuitem', { name: 'Renombrar' }).click();
  const input = page.getByRole('tree', { name: 'Capas' }).getByRole('textbox', { name: 'Nombre de la capa' });
  await expect(input).toBeFocused();
  await input.fill('Cartel');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.nodes().map((node) => node.name ?? null))).toEqual(['Cartel']);
});

const selection = (page: Page) => page.evaluate(() => [...window.__parcifyTest!.selection()].sort());
const zoomOf = async (page: Page) => {
  const a = await toPage(page, 0, 0);
  const b = await toPage(page, 100, 0);
  return (b.x - a.x) / 100;
};
const byId = async (page: Page, id: string) => (await nodes(page)).find((n) => n.id === id)!;

test('arrastrar desde un hueco de la selección la mueve entera y un clic ahí la vacía', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `hueco-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 160, y: box.y + box.height / 2 - 150 };

  // Dos tarjetas separadas por un hueco y, en medio del hueco, una forma pequeña.
  const createRect = async (from: { x: number; y: number }, to: { x: number; y: number }, count: number) => {
    await canvas.focus();
    await page.keyboard.press('r');
    await drag(page, from, to);
    await expect.poll(async () => (await nodes(page)).length).toBe(count);
    return (await page.evaluate(() => [...window.__parcifyTest!.selection()]))[0]!;
  };
  const a = await createRect(origin, { x: origin.x + 120, y: origin.y + 80 }, 1);
  const b = await createRect({ x: origin.x + 200, y: origin.y }, { x: origin.x + 320, y: origin.y + 80 }, 2);
  const c = await createRect({ x: origin.x + 145, y: origin.y + 25 }, { x: origin.x + 175, y: origin.y + 55 }, 3);
  const pair = [a, b].sort();
  const marquee = async () => {
    await drag(page, { x: origin.x - 30, y: origin.y - 30 }, { x: origin.x + 350, y: origin.y + 100 });
  };

  await marquee();
  await expect.poll(() => selection(page)).toEqual([a, b, c].sort());
  await page.keyboard.down('Shift');
  await page.mouse.click(origin.x + 160, origin.y + 40);
  await page.keyboard.up('Shift');
  await expect.poll(() => selection(page)).toEqual(pair);

  // Un nodo no seleccionado dentro de la caja manda: se selecciona y se mueve solo él.
  const zoom = await zoomOf(page);
  const [a0, b0, c0] = [await byId(page, a), await byId(page, b), await byId(page, c)];
  await drag(page, { x: origin.x + 160, y: origin.y + 40 }, { x: origin.x + 160, y: origin.y + 340 });
  await expect.poll(async () => (await byId(page, c)).y).toBeCloseTo(c0.y + 300 / zoom, 0);
  expect(await selection(page)).toEqual([c]);
  expect(await byId(page, a)).toMatchObject({ x: a0.x, y: a0.y });
  expect(await byId(page, b)).toMatchObject({ x: b0.x, y: b0.y });

  // Desde el hueco, ya vacío, se arrastra toda la selección y la selección no cambia.
  await marquee();
  await expect.poll(() => selection(page)).toEqual(pair);
  await drag(page, { x: origin.x + 160, y: origin.y + 40 }, { x: origin.x + 220, y: origin.y + 80 });
  await expect.poll(async () => (await byId(page, a)).x).toBeCloseTo(a0.x + 60 / zoom, 0);
  expect((await byId(page, a)).y).toBeCloseTo(a0.y + 40 / zoom, 0);
  expect(await byId(page, b)).toMatchObject({ x: expect.closeTo(b0.x + 60 / zoom, 0), y: expect.closeTo(b0.y + 40 / zoom, 0) });
  expect(await selection(page)).toEqual(pair);

  // Un clic sin mover en el hueco deja la selección vacía.
  await page.mouse.click(origin.x + 220, origin.y + 80);
  await expect.poll(() => selection(page)).toEqual([]);
});

test('dentro de un frame, arrastrar desde el hueco de la selección mueve la selección y no el frame', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `hueco-frame-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 160, y: box.y + box.height / 2 - 150 };

  const create = async (key: string, from: { x: number; y: number }, to: { x: number; y: number }, count: number) => {
    await canvas.focus();
    await page.keyboard.press(key);
    await drag(page, from, to);
    await expect.poll(async () => (await nodes(page)).length).toBe(count);
    return (await page.evaluate(() => [...window.__parcifyTest!.selection()]))[0]!;
  };
  const f = await create('f', { x: origin.x - 40, y: origin.y - 40 }, { x: origin.x + 400, y: origin.y + 160 }, 1);
  const a = await create('r', origin, { x: origin.x + 120, y: origin.y + 80 }, 2);
  const b = await create('r', { x: origin.x + 200, y: origin.y }, { x: origin.x + 320, y: origin.y + 80 }, 3);
  const pair = [a, b].sort();
  expect(await page.evaluate(() => window.__parcifyTest!.nodes().filter((n) => n.parentId !== null).length)).toBe(2);

  await page.mouse.click(origin.x + 60, origin.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(origin.x + 260, origin.y + 40);
  await page.keyboard.up('Shift');
  await expect.poll(() => selection(page)).toEqual(pair);

  const zoom = await zoomOf(page);
  const [f0, a0, b0] = [await byId(page, f), await byId(page, a), await byId(page, b)];
  await drag(page, { x: origin.x + 160, y: origin.y + 40 }, { x: origin.x + 220, y: origin.y + 80 });
  await expect.poll(async () => (await byId(page, a)).x).toBeCloseTo(a0.x + 60 / zoom, 0);
  expect((await byId(page, a)).y).toBeCloseTo(a0.y + 40 / zoom, 0);
  expect(await byId(page, b)).toMatchObject({ x: expect.closeTo(b0.x + 60 / zoom, 0), y: expect.closeTo(b0.y + 40 / zoom, 0) });
  expect(await byId(page, f)).toMatchObject({ x: f0.x, y: f0.y, w: f0.w, h: f0.h });
  expect(await selection(page)).toEqual(pair);
});

test('girar a mano hasta unos 44° deja la forma en 45° exactos', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `iman-giro-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 40 };

  await canvas.focus();
  await page.keyboard.press('r');
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const rect = (await nodes(page))[0]!;

  // Desde fuera de la esquina superior derecha, el puntero recorre 44° alrededor del centro.
  const corner = await toPage(page, rect.x + rect.w, rect.y);
  const start = { x: corner.x + 10, y: corner.y - 10 };
  const c = await toPage(page, center(rect).x, center(rect).y);
  const radius = Math.hypot(start.x - c.x, start.y - c.y);
  const angle = Math.atan2(start.y - c.y, start.x - c.x) + (44 * Math.PI) / 180;
  await drag(page, start, { x: c.x + Math.cos(angle) * radius, y: c.y + Math.sin(angle) * radius });
  await expect.poll(async () => (await byId(page, rect.id)).rotation).not.toBe(0);
  expect((await byId(page, rect.id)).rotation).toBeCloseTo(Math.PI / 4, 6);
});

test('crear, mover, redimensionar y girar formas, y que sigan ahí tras recargar', async ({ page, browser }) => {
  const account = await createVerifiedAccount(page.request, test.info().project.name);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  await expect(page.getByRole('textbox', { name: 'Nombre del proyecto' })).toHaveValue('Lienzo de prueba');

  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 200, y: box.y + box.height / 2 - 150 };

  // Crear un rectángulo arrastrando.
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  let rect: Node = (await nodes(page))[0]!;
  expect(rect.type).toBe('rect');
  expect(rect.w).toBeCloseTo(120, 0);
  expect(rect.h).toBeCloseTo(80, 0);

  // Crear una elipse con el atajo O.
  await canvas.focus();
  await page.keyboard.press('o');
  await drag(page, { x: origin.x + 260, y: origin.y }, { x: origin.x + 360, y: origin.y + 100 });
  await expect.poll(async () => (await nodes(page)).length).toBe(2);

  // Mover el rectángulo (Ctrl desactiva el ajuste a la elipse).
  const original = rect;
  const start = await toPage(page, center(original).x, center(original).y);
  await drag(page, start, { x: start.x + 100, y: start.y + 50 }, ['Control']);
  await expect.poll(async () => (await nodes(page)).find((n) => n.id === original.id)!.x).toBeCloseTo(original.x + 100, 0);
  rect = (await nodes(page)).find((n) => n.id === original.id)!;
  expect(rect.y).toBeCloseTo(original.y + 50, 0);

  // Redimensionar desde la esquina inferior derecha.
  const corner = await toPage(page, rect.x + rect.w, rect.y + rect.h);
  await drag(page, corner, { x: corner.x + 40, y: corner.y + 20 });
  await expect.poll(async () => (await nodes(page)).find((n) => n.id === rect.id)!.w).toBeCloseTo(160, 0);
  rect = (await nodes(page)).find((n) => n.id === rect.id)!;
  expect(rect.h).toBeCloseTo(100, 0);

  // Girar desde fuera de la esquina superior derecha, con Shift para ir a pasos de 15°.
  const ne = await toPage(page, rect.x + rect.w + 10, rect.y - 10);
  const c = await toPage(page, center(rect).x, center(rect).y);
  await drag(page, ne, { x: c.x + 120, y: c.y + 40 }, ['Shift']);
  await expect.poll(async () => (await nodes(page)).find((n) => n.id === rect.id)!.rotation).not.toBe(0);
  rect = (await nodes(page)).find((n) => n.id === rect.id)!;
  const steps = rect.rotation / (Math.PI / 12);
  expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);

  const before = (await nodes(page)).sort((a, b) => a.id.localeCompare(b.id));

  // Tras recargar, todo sigue ahí. Después, en un contexto nuevo sin la copia de IndexedDB, el documento
  // tiene que venir del servidor (guardado en Postgres tras el debounce de collab).
  await page.reload();
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await expect.poll(async () => (await nodes(page)).length).toBe(2);
  await page.waitForTimeout(2_500);
  const fresh = await browser.newContext({ storageState: await page.context().storageState() });
  const second = await fresh.newPage();
  await openEditor(second, projectId);
  await expect.poll(async () => (await nodes(second)).length).toBe(2);
  const after = (await nodes(second)).sort((a, b) => a.id.localeCompare(b.id));
  for (const [i, node] of before.entries()) {
    expect(after[i]).toMatchObject({ id: node.id, type: node.type, x: node.x, y: node.y, w: node.w, h: node.h, rotation: node.rotation });
  }
  await fresh.close();
});

test('R activa Rectángulo en el grupo Formas, cuyo desplegable lleva 8 entradas con su atajo y la marca', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `formas-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const bar = toolbar(page);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });

  // El botón del grupo muestra la última forma usada.
  await canvas.focus();
  await page.keyboard.press('o');
  await expect(bar.getByRole('button', { name: 'Elipse (O)' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('r');
  const rect = bar.getByRole('button', { name: 'Rectángulo (R)' });
  await expect(rect).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Elipse (O)' })).toHaveCount(0);

  await bar.getByRole('button', { name: 'Formas', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Formas' });
  await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(7);
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Rectángulo' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Rectángulo' })).toHaveAttribute('aria-keyshortcuts', 'R');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Elipse' })).toHaveAttribute('aria-checked', 'false');
  // Imagen es una acción: va al final, sin marca, y no cambia la herramienta.
  const image = menu.getByRole('menuitem', { name: 'Imagen' });
  await expect(image).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+K');
  const menuBox = (await menu.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(barBox.y);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Doble clic bloquea la herramienta: sigue activa después de crear.
  await rect.dblclick();
  await expect(rect.locator('.lucide-lock')).toHaveCount(1);
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 200, y: box.y + box.height / 2 - 150 };
  await drag(page, origin, { x: origin.x + 100, y: origin.y + 60 });
  await drag(page, { x: origin.x + 200, y: origin.y }, { x: origin.x + 300, y: origin.y + 60 });
  await expect.poll(async () => (await nodes(page)).length).toBe(2);
  await expect(rect).toHaveAttribute('aria-pressed', 'true');
  // Un clic sin arrastre crea con el tamaño por defecto y tampoco quita el bloqueo.
  await page.mouse.click(origin.x + 100, origin.y + 250);
  await expect.poll(async () => (await nodes(page)).length).toBe(3);
  await expect(rect).toHaveAttribute('aria-pressed', 'true');
  await expect(rect.locator('.lucide-lock')).toHaveCount(1);

  // Esc vuelve a Seleccionar y quita el bloqueo.
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('button', { name: 'Seleccionar (V)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(rect.locator('.lucide-lock')).toHaveCount(0);
});

test('la barra de herramientas se recorre con ← y →, y cada herramienta muestra su atajo en el tooltip', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `barra-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const bar = toolbar(page);
  const tabStops = () => page.evaluate(() => [...document.querySelectorAll('[role="toolbar"] button')].filter((b) => (b as HTMLElement).tabIndex === 0).length);

  const select = bar.getByRole('button', { name: 'Seleccionar (V)' });
  await select.focus();
  expect(await tabStops()).toBe(1);
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('button', { name: 'Seleccionar y mano', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('button', { name: 'Marco (F)' })).toBeFocused();
  expect(await tabStops()).toBe(1);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  // Desde el primero, ← da la vuelta al último (Animar, o IA si está disponible).
  await expect(bar.getByRole('button').last()).toBeFocused();

  // ↑ con el foco en un grupo abre su desplegable.
  await bar.getByRole('button', { name: 'Línea (L)' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menu', { name: 'Líneas' }).getByRole('menuitemcheckbox', { name: 'Flecha' })).toHaveAttribute('aria-keyshortcuts', 'Shift+L');
  await page.keyboard.press('Escape');

  await page.mouse.move(0, 0);
  await bar.getByRole('button', { name: 'Texto (T)' }).hover();
  // Los tooltips que se cierran siguen en el DOM durante su salida, y el foco de Línea abre el suyo.
  const tip = page.getByRole('tooltip').filter({ hasText: 'Texto' });
  await expect(tip).toBeVisible();
  await expect(tip.locator('kbd')).toHaveText('T');
});

test('el desplegable de un grupo sale por encima de la barra y entero en 390×844, también con una pulsación larga', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const account = await createVerifiedAccount(page.request, `barra-movil-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const bar = toolbar(page);
  const inside = async (menu: ReturnType<Page['getByRole']>) => {
    const menuBox = (await menu.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(barBox.y);
  };

  await bar.getByRole('button', { name: 'Formas', exact: true }).click();
  const shapes = page.getByRole('menu', { name: 'Formas' });
  await expect(shapes.getByRole('menuitem', { name: 'Imagen' })).toBeVisible();
  await inside(shapes);
  await page.keyboard.press('Escape');

  // Mantener pulsado el botón del grupo 300 ms abre el desplegable sin cambiar de herramienta.
  // A este ancho la barra puede quedar justa contra los bordes: se usa el grupo Formas, que está en el centro.
  const rect = bar.getByRole('button', { name: 'Rectángulo (R)' });
  const box = (await rect.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect(shapes).toBeVisible();
  await inside(shapes);
  await expect(rect).toHaveAttribute('aria-pressed', 'false');
});

test('con la Galería abierta, la barra de zoom no tapa ningún botón de la barra de herramientas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const account = await createVerifiedAccount(page.request, `barra-galeria-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const bar = toolbar(page);
  await bar.getByRole('button', { name: 'Galería' }).click();
  await expect(bar.getByRole('button', { name: 'Galería' })).toHaveAttribute('aria-pressed', 'true');
  const covered = await page.evaluate(() =>
    [...document.querySelectorAll('[role="toolbar"] button')]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !hit || !button.contains(hit);
      })
      .map((button) => button.getAttribute('aria-label') ?? button.textContent),
  );
  expect(covered).toEqual([]);
});

// Rectángulo en pantalla del <canvas> del motor.
const canvasRect = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector('[role="application"] canvas')!.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });

test('el lienzo mide lo que la ventana con los paneles abiertos y plegados, y «Encajar todo» centra en el hueco entre ellos', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await createVerifiedAccount(page.request, `maqueta-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const full = { x: 0, y: 0, width: 1440, height: 900 };
  expect(await canvasRect(page)).toEqual(full);

  // Un rectángulo en el hueco y el panel izquierdo a su ancho máximo, para que los dos márgenes sean distintos.
  const box = await canvasGap(page);
  await canvas.focus();
  await page.keyboard.press('r');
  await drag(page, { x: box.x + 100, y: box.y + 100 }, { x: box.x + 220, y: box.y + 180 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const rect = (await nodes(page))[0]!;
  const resizer = page.getByRole('separator', { name: 'Ancho del panel de capas' });
  await resizer.focus();
  await page.keyboard.press('End');
  await expect(resizer).toHaveAttribute('aria-valuenow', '400');
  const fitCenter = async () => {
    await canvas.focus();
    await page.keyboard.press('Shift+1');
    return toPage(page, center(rect).x, center(rect).y);
  };

  // Abiertos: margen izquierdo 400 + 16 y derecho 248 + 16; el hueco va de 416 a 1176.
  await expect.poll(async () => Math.abs((await fitCenter()).x - (416 + 1176) / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs((await fitCenter()).y - 450)).toBeLessThanOrEqual(2);

  // Plegados: el lienzo no cambia de tamaño y el encuadre usa toda la ventana.
  await page.getByTestId('left-panel-toggle').click();
  await page.getByTestId('right-panel-toggle').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-state', 'collapsed');
  await expect(page.getByTestId('right-panel')).toHaveAttribute('data-state', 'collapsed');
  expect(await canvasRect(page)).toEqual(full);
  await expect.poll(async () => Math.abs((await fitCenter()).x - 720)).toBeLessThanOrEqual(2);
  expect(Math.abs((await fitCenter()).y - 450)).toBeLessThanOrEqual(2);

  // Desplegados otra vez, siguen a toda la ventana.
  await page.getByTestId('left-panel-toggle').click();
  await page.getByTestId('right-panel-toggle').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-state', 'open');
  expect(await canvasRect(page)).toEqual(full);
});

test('tras recargar, los paneles conservan su plegado y su ancho', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await createVerifiedAccount(page.request, `maqueta-guardada-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);

  const resizer = page.getByRole('separator', { name: 'Ancho del panel de propiedades' });
  await resizer.focus();
  // En el panel derecho el asa está a su izquierda: ← lo ensancha 8 px cada vez.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await expect(resizer).toHaveAttribute('aria-valuenow', '296');
  await page.getByTestId('left-panel-toggle').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-state', 'collapsed');
  await page.waitForTimeout(400);

  await page.reload();
  await openEditor(page, projectId);
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-state', 'collapsed');
  await expect(page.getByTestId('left-panel-pill')).toBeVisible();
  await expect(page.getByTestId('right-panel')).toHaveAttribute('data-state', 'open');
  expect(Math.round((await page.getByTestId('right-panel').boundingBox())!.width)).toBe(296);
});

test('Tab recorre el panel izquierdo, el lienzo, la barra de herramientas, la de zoom y el panel derecho, en ese orden', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await createVerifiedAccount(page.request, `tabulacion-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);

  const region = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return 'none';
      if (active.closest('[data-testid="left-panel"]')) return 'left';
      if (active.getAttribute('role') === 'application') return 'canvas';
      if (active.closest('[role="toolbar"]')) return 'toolbar';
      if (active.closest('[data-testid="canvas-bars"]')) return 'zoom';
      if (active.closest('[data-testid="right-panel"]')) return 'right';
      return 'other';
    });

  // El editor enfoca el lienzo al abrir y blur() deja ahí el punto de partida de Tab: se empieza desde el principio
  // del documento enfocando el body.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  const order: string[] = [];
  for (let i = 0; i < 80 && !order.includes('right'); i++) {
    await page.keyboard.press('Tab');
    const now = await region();
    if (now !== 'none' && now !== 'other' && order.at(-1) !== now) order.push(now);
  }
  expect(order).toEqual(['left', 'canvas', 'toolbar', 'zoom', 'right']);
});

test('Ctrl+\\ oculta la interfaz, también con AltGr del teclado español, y Ctrl+Shift+\\ la minimiza', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await createVerifiedAccount(page.request, `ocultar-interfaz-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });

  // AltGr+º del teclado español: llegan Ctrl y Alt, la tecla es «\» y el código, el de la tecla º.
  await canvas.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', code: 'Backquote', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('left-panel')).toBeHidden();
  await expect(page.getByTestId('right-panel')).toBeHidden();
  await expect(page.getByTestId('canvas-bars')).toBeHidden();
  await page.getByTestId('show-ui').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('canvas-bars')).toBeVisible();

  await canvas.focus();
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('show-ui')).toBeVisible();
  await page.keyboard.press('Control+\\');
  await expect(page.getByTestId('show-ui')).toHaveCount(0);

  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.getByTestId('left-panel-pill')).toBeVisible();
  await expect(page.getByTestId('right-panel-pill')).toBeVisible();
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('right-panel')).toHaveAttribute('data-state', 'open');
});

test('la barra contextual queda 12 px encima de la forma, baja si no cabe, no pisa la barra de herramientas y se oculta al arrastrar o desplazar', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await createVerifiedAccount(page.request, `barra-contextual-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const bar = page.getByTestId('context-bar');
  const gap = await canvasGap(page);

  await canvas.focus();
  await page.keyboard.press('r');
  const from = { x: gap.x + gap.width / 2 - 80, y: gap.y + gap.height / 2 - 40 };
  await drag(page, from, { x: from.x + 160, y: from.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-kind', 'shape');

  // Esquinas de la caja en la página y caja de la barra.
  const shapeBox = async () => {
    const node = (await nodes(page))[0]!;
    const a = await toPage(page, node.x, node.y);
    const b = await toPage(page, node.x + node.w, node.y + node.h);
    return { top: a.y, bottom: b.y, center: (a.x + b.x) / 2 };
  };
  const placed = async () => {
    const box = (await bar.boundingBox())!;
    return { top: box.y, bottom: box.y + box.height, center: box.x + box.width / 2, box };
  };

  await expect.poll(async () => Math.abs((await shapeBox()).top - 12 - (await placed()).bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs((await shapeBox()).center - (await placed()).center)).toBeLessThanOrEqual(1);
  const tools = (await toolbar(page).boundingBox())!;
  const own = (await placed()).box;
  const overlaps = own.x < tools.x + tools.width && tools.x < own.x + own.width && own.y < tools.y + tools.height && tools.y < own.y + own.height;
  expect(overlaps).toBe(false);

  // Mientras se arrastra no está; al soltar vuelve.
  const start = await shapeBox();
  const grab = { x: start.center, y: (start.top + start.bottom) / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y - 30, { steps: 4 });
  await expect(bar).toBeHidden();
  // Pegada arriba (su borde superior a unos 20 px de la ventana): la barra va debajo.
  await page.mouse.move(grab.x, grab.y - (start.top - 20), { steps: 6 });
  await page.mouse.up();
  await expect(bar).toBeVisible();
  await expect.poll(async () => Math.abs((await placed()).top - ((await shapeBox()).bottom + 12))).toBeLessThanOrEqual(1);

  // Diez eventos de rueda desplazan la vista: la barra se oculta y vuelve 150 ms después, otra vez junto a la forma.
  await page.mouse.move(gap.x + gap.width / 2, gap.y + gap.height / 2);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -12);
  await expect(bar).toBeHidden();
  await expect(bar).toBeVisible();
  await expect.poll(async () => {
    const shape = await shapeBox();
    const now = await placed();
    return Math.min(Math.abs(shape.top - 12 - now.bottom), Math.abs(now.top - shape.bottom - 12));
  }).toBeLessThanOrEqual(1);
});

test('Alt+A alinea a la izquierda los seleccionados en un solo paso de deshacer y Shift+H los voltea', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `alinear-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 150, y: box.y + box.height / 2 - 100 };
  const createRect = async (from: { x: number; y: number }, to: { x: number; y: number }, count: number) => {
    await canvas.focus();
    await page.keyboard.press('r');
    await drag(page, from, to);
    await expect.poll(async () => (await nodes(page)).length).toBe(count);
  };
  await createRect(origin, { x: origin.x + 100, y: origin.y + 60 }, 1);
  await createRect({ x: origin.x + 180, y: origin.y + 120 }, { x: origin.x + 300, y: origin.y + 200 }, 2);
  const before = (await nodes(page)).sort((a, b) => a.x - b.x);
  const left = before[0]!.x;
  expect(before[1]!.x).toBeGreaterThan(left + 100);

  await canvas.focus();
  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await selection(page)).length).toBe(2);
  await page.keyboard.press('Alt+a');
  await expect.poll(async () => (await nodes(page)).map((node) => node.x)).toEqual([left, left]);
  // Las y no cambian.
  expect((await nodes(page)).map((node) => node.y).sort((a, b) => a - b)).toEqual(before.map((node) => node.y).sort((a, b) => a - b));

  // Un solo Ctrl+Z devuelve las dos a su sitio.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await nodes(page)).map((node) => node.x).sort((a, b) => a - b)).toEqual(before.map((node) => node.x));

  // Shift+H refleja la selección respecto al centro de su caja: la de la izquierda pasa a la derecha.
  const span = { min: before[0]!.x, max: before[1]!.x + before[1]!.w };
  await page.keyboard.press('Shift+h');
  await expect.poll(async () => (await byId(page, before[0]!.id)).x).toBeCloseTo(span.max - before[0]!.w, 0);
  const flipped = (await nodes(page)) as Array<Node & { flipX?: boolean }>;
  expect(flipped.every((node) => node.flipX === true)).toBe(true);
  expect(flipped.every((node) => Math.abs(node.rotation) < 1e-6)).toBe(true);
});

// Panel de propiedades (§3.1).
const properties = (page: Page) => page.getByTestId('properties-panel');
// El asa del scrub es la etiqueta de la izquierda del campo (aria-hidden: el campo tiene su propio nombre).
const scrubHandle = (page: Page, testid: string) => page.getByTestId(testid).locator('xpath=preceding-sibling::span[1]');
type Styled = Node & { opacity: number; fill: string | null };

async function drawRect(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, count: number) {
  await page.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await page.keyboard.press('r');
  await drag(page, from, to);
  await expect.poll(async () => (await nodes(page)).length).toBe(count);
}

test('Rotación del panel: 45 gira sobre el centro, +15 suma y con dos formas muestra «Mixto» (CA-2.2, CA-2.3)', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `rotacion-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const gap = await canvasGap(page);
  const origin = { x: gap.x + gap.width / 2 - 160, y: gap.y + gap.height / 2 - 60 };
  await drawRect(page, origin, { x: origin.x + 120, y: origin.y + 80 }, 1);
  const rotation = properties(page).getByRole('spinbutton', { name: 'Rotación' });
  const [a0] = await nodes(page);

  await rotation.fill('45');
  await rotation.press('Enter');
  await expect.poll(async () => (await byId(page, a0!.id)).rotation).toBeCloseTo(Math.PI / 4, 6);
  const a1 = await byId(page, a0!.id);
  expect(Math.abs(center(a1).x - center(a0!).x)).toBeLessThan(0.001);
  expect(Math.abs(center(a1).y - center(a0!).y)).toBeLessThan(0.001);
  await expect(rotation).toHaveValue('45');

  // Solo el + inicial es relativo.
  await rotation.fill('+15');
  await rotation.press('Enter');
  await expect.poll(async () => (await byId(page, a0!.id)).rotation).toBeCloseTo(Math.PI / 3, 6);

  // Una segunda forma girada 30°: con las dos, el campo muestra «Mixto».
  await drawRect(page, { x: origin.x + 220, y: origin.y }, { x: origin.x + 300, y: origin.y + 80 }, 2);
  const b0 = (await nodes(page)).find((node) => node.id !== a0!.id)!;
  await rotation.fill('30');
  await rotation.press('Enter');
  await expect.poll(async () => (await byId(page, b0.id)).rotation).toBeCloseTo(Math.PI / 6, 6);
  const before = await nodes(page);
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await selection(page)).length).toBe(2);
  await expect(rotation).toHaveValue('');
  await expect(rotation).toHaveAttribute('placeholder', 'Mixto');

  // 0 las deja a 0, cada una sobre su centro, y un solo Ctrl+Z las devuelve.
  await rotation.fill('0');
  await rotation.press('Enter');
  await expect.poll(async () => (await nodes(page)).map((node) => Math.abs(node.rotation) < 1e-6)).toEqual([true, true]);
  for (const node of await nodes(page)) {
    const was = before.find((item) => item.id === node.id)!;
    expect(Math.abs(center(node).x - center(was).x)).toBeLessThan(0.001);
    expect(Math.abs(center(node).y - center(was).y)).toBeLessThan(0.001);
  }
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await byId(page, a0!.id)).rotation).toBeCloseTo(Math.PI / 3, 6);
  expect((await byId(page, b0.id)).rotation).toBeCloseTo(Math.PI / 6, 6);
});

test('scrub de Opacidad y del área de color: nada se escribe hasta soltar, un paso de deshacer y Esc descarta (CA-3.7)', async ({ page }) => {
  test.setTimeout(90_000);
  const account = await createVerifiedAccount(page.request, `scrub-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const gap = await canvasGap(page);
  const origin = { x: gap.x + gap.width / 2 - 60, y: gap.y + gap.height / 2 - 40 };
  await drawRect(page, origin, { x: origin.x + 120, y: origin.y + 80 }, 1);
  const shape = async () => (await nodes(page))[0] as Styled;
  const { fill } = await shape();

  // 2 s de arrastre en el asa con dos pausas de 500 ms: el Y.Map no cambia en ninguna pausa.
  const handle = (await scrubHandle(page, 'props-opacity').boundingBox())!;
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const [i, dx] of [-10, -20, -30].entries()) {
    await page.mouse.move(start.x + dx, start.y, { steps: 5 });
    if (i < 2) {
      await page.waitForTimeout(500);
      expect((await shape()).opacity).toBe(1);
    }
  }
  await page.waitForTimeout(400);
  expect((await shape()).opacity).toBe(1);
  await page.mouse.up();
  // Unos 28 px a la izquierda (los 2 primeros solo arman el arrastre): en torno al 72 %.
  await expect.poll(async () => (await shape()).opacity).toBeLessThan(0.8);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await shape()).opacity).toBe(1);

  // Esc durante el scrub deja la opacidad como estaba y no escribe al soltar.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 40, start.y, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect((await shape()).opacity).toBe(1);
  await expect(page.getByTestId('props-opacity')).toHaveValue('100');

  // El área del selector de color sigue el mismo contrato.
  await page.getByTestId('props-fill-row-swatch').click();
  const area = page.getByRole('slider', { name: 'Saturación y brillo' });
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.waitForTimeout(500);
  expect((await shape()).fill).toBe(fill);
  await page.mouse.move(box.x + box.width - 10, box.y + 20, { steps: 5 });
  await page.waitForTimeout(500);
  expect((await shape()).fill).toBe(fill);
  await page.mouse.up();
  await expect.poll(async () => (await shape()).fill).not.toBe(fill);
  const picked = (await shape()).fill;
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect((await shape()).fill).toBe(picked);
});

test('el panel de propiedades no tiene scroll horizontal a 248 px con cualquier selección (CA-3.4)', async ({ page }) => {
  test.setTimeout(120_000);
  const account = await createVerifiedAccount(page.request, `panel-ancho-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const scroller = page.getByTestId('properties-scroll');
  await expect(page.getByTestId('right-panel')).toHaveAttribute('data-state', 'open');
  expect(Math.round((await page.getByTestId('right-panel').boundingBox())!.width)).toBe(248);
  const noHorizontalScroll = async (kind: string) => {
    await expect(properties(page)).toBeVisible();
    const sizes = await scroller.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(sizes, kind).toEqual({ scroll: sizes.client, client: sizes.client });
  };
  const select = async (x: number, y: number) => {
    await canvas.focus();
    await page.keyboard.press('Escape');
    const at = await toPage(page, x, y);
    await page.mouse.click(at.x, at.y);
  };
  const gap = await canvasGap(page);
  const origin = { x: gap.x + 40, y: gap.y + 40 };

  await noHorizontalScroll('sin selección');
  await drawRect(page, origin, { x: origin.x + 100, y: origin.y + 70 }, 1);
  await noHorizontalScroll('forma');

  await canvas.focus();
  await page.keyboard.press('t');
  await page.mouse.click(origin.x + 160, origin.y + 20);
  await page.keyboard.type('Texto del panel');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodes(page)).some((node) => node.type === 'text')).toBe(true);
  const text = (await nodes(page)).find((node) => node.type === 'text')!;
  await select(text.x + 4, text.y + text.h / 2);
  await expect.poll(async () => await selection(page)).toEqual([text.id]);
  await noHorizontalScroll('texto');

  await canvas.focus();
  await page.keyboard.press('l');
  await drag(page, { x: origin.x, y: origin.y + 120 }, { x: origin.x + 120, y: origin.y + 160 });
  await expect.poll(async () => (await nodes(page)).some((node) => node.type === 'line')).toBe(true);
  await noHorizontalScroll('línea');

  await page.getByTestId('image-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: solidPng(120) });
  await expect.poll(async () => (await nodes(page)).some((node) => node.type === 'image'), { timeout: 30_000 }).toBe(true);
  await noHorizontalScroll('imagen');

  await canvas.focus();
  await page.keyboard.press('f');
  await drag(page, { x: origin.x + 260, y: origin.y + 120 }, { x: origin.x + 420, y: origin.y + 220 });
  await expect.poll(async () => (await nodes(page)).some((node) => node.type === 'frame')).toBe(true);
  await noHorizontalScroll('marco');

  await canvas.focus();
  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await selection(page)).length).toBeGreaterThan(1);
  await noHorizontalScroll('selección múltiple');
});

// Selección y tiradores en el lienzo (§3.4).
const hud = (page: Page) => page.getByTestId('canvas-hud');
const cursor = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>('[role="application"]')!.style.cursor);

test('el cursor de giro sale a 14 px de la esquina NE y la píldora muestra el ángulo, en salvia al imantar (CA-2.1, RF-15.2)', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `cursor-giro-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const gap = await canvasGap(page);
  const origin = { x: gap.x + gap.width / 2 - 60, y: gap.y + gap.height / 2 - 40 };
  await drawRect(page, origin, { x: origin.x + 120, y: origin.y + 80 }, 1);
  const rect = (await nodes(page))[0]!;

  const ne = await toPage(page, rect.x + rect.w, rect.y);
  const start = { x: ne.x + 10, y: ne.y - 10 };
  await page.mouse.move(start.x - 4, start.y + 4);
  await page.mouse.move(start.x, start.y, { steps: 2 });
  await expect.poll(() => cursor(page)).toMatch(/^url\("data:image\/svg\+xml.*, grab$/);

  // Se gira unos 44° alrededor del centro sin soltar: la píldora dice el ángulo y está imantada a 45°.
  const c = await toPage(page, center(rect).x, center(rect).y);
  const radius = Math.hypot(start.x - c.x, start.y - c.y);
  const base = Math.atan2(start.y - c.y, start.x - c.x);
  await page.mouse.down();
  for (const deg of [10, 20, 30]) await page.mouse.move(c.x + Math.cos(base + (deg * Math.PI) / 180) * radius, c.y + Math.sin(base + (deg * Math.PI) / 180) * radius, { steps: 2 });
  await expect(hud(page)).toHaveAttribute('data-kind', 'angle');
  await expect(hud(page)).toHaveText(/^(29,\d|30(,\d)?)°$/);
  await expect(hud(page)).toHaveAttribute('data-snapped', 'false');
  await page.mouse.move(c.x + Math.cos(base + (44 * Math.PI) / 180) * radius, c.y + Math.sin(base + (44 * Math.PI) / 180) * radius, { steps: 2 });
  await expect(hud(page)).toHaveText('45°');
  await expect(hud(page)).toHaveAttribute('data-snapped', 'true');
  expect(await cursor(page)).toMatch(/^url\("data:image\/svg\+xml.*, grab$/);
  await page.mouse.up();
  await expect.poll(async () => (await byId(page, rect.id)).rotation).toBeCloseTo(Math.PI / 4, 6);
  await expect(hud(page)).toHaveAttribute('data-kind', 'size');
});

test('con una forma de 857×623 al 100 %, la píldora dice «857 × 623» centrada 8 px por debajo (CA-13.1)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await createVerifiedAccount(page.request, `pildora-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const gap = await canvasGap(page);
  await drawRect(page, { x: gap.x + 20, y: gap.y + 10 }, { x: gap.x + 120, y: gap.y + 90 }, 1);
  const panel = properties(page);
  for (const [name, value] of [
    ['Ancho', '857'],
    ['Alto', '623'],
  ] as const) {
    const field = panel.getByRole('spinbutton', { name, exact: true });
    await field.fill(value);
    await field.press('Enter');
  }
  await expect.poll(async () => (await nodes(page))[0]).toMatchObject({ w: 857, h: 623 });
  await expect.poll(() => zoomOf(page)).toBeCloseTo(1, 6);
  await expect(hud(page)).toHaveText('857 × 623');

  const rect = (await nodes(page))[0]!;
  const bottom = await toPage(page, rect.x + rect.w / 2, rect.y + rect.h);
  const pill = (await hud(page).boundingBox())!;
  expect(Math.abs(pill.x + pill.width / 2 - bottom.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(pill.y - (bottom.y + 8))).toBeLessThanOrEqual(1);
});

test('el tirador de radio no cambia nada si se pulsa sin mover y arrastrado 20 px deja 20, nunca más de 50 (CA-13.2)', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `radio-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  await expect.poll(() => zoomOf(page)).toBeCloseTo(1, 6);
  const gap = await canvasGap(page);
  const origin = { x: gap.x + gap.width / 2 - 100, y: gap.y + gap.height / 2 - 50 };
  await drawRect(page, origin, { x: origin.x + 200, y: origin.y + 100 }, 1);
  const rect = (await nodes(page))[0]! as Node & { cornerRadius: number };
  expect(rect).toMatchObject({ w: 200, h: 100, cornerRadius: 0 });
  const radiusHandles = () => page.evaluate(() => window.__parcifyTest!.overlayModel()?.selection?.radiusHandles ?? []);

  // Con el ratón lejos de las esquinas no hay tiradores de radio; cerca de una, aparecen dentro, a 12 px.
  const nw = await toPage(page, rect.x, rect.y);
  await page.mouse.move(nw.x + 100, nw.y + 50);
  await expect.poll(async () => (await radiusHandles()).length).toBe(0);
  await page.mouse.move(nw.x + 10, nw.y + 10, { steps: 3 });
  await expect.poll(async () => (await radiusHandles()).length).toBe(4);
  const canvasBox = (await page.getByRole('application', { name: 'Lienzo del proyecto' }).boundingBox())!;
  const handle = (await radiusHandles())[0]!;
  const at = { x: canvasBox.x + handle.x, y: canvasBox.y + handle.y };
  expect(at.x - nw.x).toBeCloseTo(12, 0);
  expect(at.y - nw.y).toBeCloseTo(12, 0);

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(((await nodes(page))[0] as typeof rect).cornerRadius).toBe(0);

  await drag(page, at, { x: at.x + 20, y: at.y + 20 });
  await expect.poll(async () => ((await nodes(page))[0] as typeof rect).cornerRadius).toBe(20);

  const moved = (await radiusHandles())[0]!;
  const from = { x: canvasBox.x + moved.x, y: canvasBox.y + moved.y };
  await drag(page, from, { x: from.x + 200, y: from.y + 200 });
  await expect.poll(async () => ((await nodes(page))[0] as typeof rect).cornerRadius).toBe(50);
});
