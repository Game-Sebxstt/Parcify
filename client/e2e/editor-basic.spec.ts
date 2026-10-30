import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
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
  // Sin selección, para que el contorno que se ve sea el del hover. Abajo está la barra de zoom: se pulsa arriba.
  await page.mouse.click(box.x + 20, box.y + 20);
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection().length)).toBe(0);

  const hover = () => page.evaluate(() => (window.__parcifyTest!.overlayModel()?.hover ?? null) !== null);
  await page.mouse.move(origin.x + 60, origin.y + 40);
  await expect.poll(hover).toBe(true);
  await page.mouse.move(box.x + box.width / 2, Math.max(1, box.y - 10));
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
  // Hasta la maqueta móvil, la barra de zoom tapa el final de la barra a este ancho: se usa el grupo Formas.
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
