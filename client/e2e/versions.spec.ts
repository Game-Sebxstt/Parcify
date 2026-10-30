import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { canvasGap } from './helpers/canvas.ts';
import { samePixel, screenPixel } from './helpers/pixels.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; shadow?: unknown };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const panel = (page: Page) => page.getByTestId('versions-panel');
const overlay = (page: Page) => page.getByTestId('version-overlay');
const canvasArea = (page: Page) => page.getByRole('application', { name: 'Lienzo del proyecto' });
const toPage = (page: Page, x: number, y: number) => page.evaluate(([wx, wy]) => window.__parcifyTest!.toPage(wx!, wy!), [x, y]);
const pixelAt = (page: Page, point: { x: number; y: number }) => page.evaluate(([x, y]) => window.__parcifyTest!.pixelAt(x!, y!), [point.x, point.y]);

// Centro de un nodo en coordenadas de la página.
async function centerOf(page: Page, node: Node) {
  return toPage(page, node.x + node.w / 2, node.y + node.h / 2);
}

// Marca el canvas actual para saber después si el motor montó otro.
async function markCanvas(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __oldCanvas?: Element | null }).__oldCanvas = document.querySelector('[role=application] canvas');
  });
}

const canvasState = (page: Page) =>
  page.evaluate(() => {
    const canvases = document.querySelectorAll('[role=application] canvas');
    const canvas = canvases[0] as HTMLCanvasElement | undefined;
    const gl = canvas ? (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) : null;
    return {
      count: canvases.length,
      replaced: canvas !== undefined && (window as unknown as { __oldCanvas?: Element | null }).__oldCanvas !== canvas,
      lost: gl ? gl.isContextLost() : null,
    };
  });

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

async function drawRect(page: Page, offset: number) {
  const box = (await page.getByRole('application', { name: 'Lienzo del proyecto' }).boundingBox())!;
  const from = { x: box.x + box.width / 2 - 200 + offset, y: box.y + box.height / 2 - 100 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 40, { steps: 4 });
  await page.mouse.move(from.x + 100, from.y + 80, { steps: 4 });
  await page.mouse.up();
}

// Píxel de una zona vacía del lienzo (su centro, en un proyecto sin nodos).
async function emptyPixel(page: Page) {
  const box = (await page.getByRole('application', { name: 'Lienzo del proyecto' }).boundingBox())!;
  return page.evaluate(([x, y]) => window.__parcifyTest!.pixelAt(x!, y!), [box.x + box.width / 2, box.y + box.height / 2]);
}

test('el fondo del documento es el mismo al abrir sin caché y con la copia de IndexedDB', async ({ page, browser }) => {
  const ana = await createVerifiedAccount(page.request, `fondo-${test.info().project.name}`, 'Ana Fondo');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Fondo');
  // DEFAULT_BACKGROUND de shared/document/init.ts (#141416).
  const expected = [0x14, 0x14, 0x16];
  const close = (pixel: number[] | null) => pixel !== null && expected.every((channel, i) => Math.abs(pixel[i]! - channel) <= 2);

  // Primera carga: sin copia local, el documento llega del servidor.
  await openEditor(page, projectId);
  await expect.poll(async () => close(await emptyPixel(page))).toBe(true);

  // Recarga: el primer lote sale de IndexedDB y ya trae meta.
  await page.waitForTimeout(1_000);
  await page.reload();
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await expect.poll(async () => close(await emptyPixel(page))).toBe(true);

  // Un segundo contexto con la misma sesión y sin la copia local da el mismo color.
  const fresh = await browser.newContext({ storageState: await page.context().storageState() });
  const other = await fresh.newPage();
  await openEditor(other, projectId);
  await expect.poll(async () => close(await emptyPixel(other))).toBe(true);
  await fresh.close();
});

test('A crea una versión, cambia el lienzo y la restaura; B ve el cambio sin recargar', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const label = `versions-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Versiones');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Versiones');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Con historial');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await setOrgAccess(page.request, projectId, 'none');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  await drawRect(page, 0);
  await expect.poll(async () => (await nodes(bea)).length).toBe(1);
  const kept = (await nodes(page))[0]!.id;

  // Versión con nombre desde el panel.
  await page.getByTestId('versions-toggle').click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: 'Crear versión con nombre' }).click();
  const nameDialog = page.getByRole('dialog', { name: 'Crear versión con nombre' });
  await nameDialog.getByLabel('Nombre de la versión').fill('Un rectángulo');
  await nameDialog.getByRole('button', { name: 'Crear versión' }).click();
  const named = panel(page).getByTestId('version-item').filter({ hasText: 'Un rectángulo' });
  await expect(named).toBeVisible();

  // Ctrl+S guarda otra sin nombre.
  await page.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await page.keyboard.press('Control+s');
  await expect(panel(page).getByTestId('version-item').filter({ hasText: 'Versión guardada' })).toHaveCount(1);

  // Se cambia el lienzo: un segundo rectángulo.
  await drawRect(page, 220);
  await expect.poll(async () => (await nodes(bea)).length).toBe(2);

  // Vista previa de solo lectura con el estado de la versión, en la superposición sobre el lienzo.
  await named.getByRole('button', { name: 'Vista previa de Un rectángulo' }).click();
  const preview = overlay(page);
  await expect(preview).toContainText('Viendo: Un rectángulo');
  await expect(preview.getByTestId('version-preview')).toHaveAttribute('data-state', 'ready');

  // Restaurar desde la vista previa, con confirmación.
  await preview.getByRole('button', { name: 'Restaurar', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '¿Restaurar esta versión?' });
  await confirm.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByText('Versión restaurada.')).toBeVisible();
  await expect(preview).toHaveCount(0);

  await expect.poll(async () => (await nodes(bea)).map((node) => node.id)).toEqual([kept]);
  await expect.poll(async () => (await nodes(page)).map((node) => node.id)).toEqual([kept]);
  await expect(panel(page).getByTestId('version-item').filter({ hasText: 'Antes de restaurar' })).toHaveCount(1);

  await otherContext.close();
});

// Un movimiento del ratón por el lienzo cambia el hover y obliga al editor a pintar un frame nuevo.
async function repaint(page: Page) {
  const box = await canvasGap(page);
  await page.mouse.move(box.x + box.width - 40, box.y + 40, { steps: 3 });
  await page.mouse.move(box.x + box.width - 60, box.y + 60, { steps: 3 });
  await page.waitForTimeout(300);
}

async function editorWithRect(page: Page, name: string) {
  const ana = await createVerifiedAccount(page.request, `${name}-${test.info().project.name}`, 'Ana Lienzo');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Lienzo');
  await openEditor(page, projectId);
  await drawRect(page, 0);
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  await canvasArea(page).focus();
  await page.keyboard.press('Escape');
  await repaint(page);
  const point = await centerOf(page, (await nodes(page))[0]!);
  return { projectId, point, painted: await screenPixel(page, point) };
}

test('reabrir el motor (reinicio del documento) monta otro canvas y el lienzo vuelve a pintar', async ({ page }) => {
  test.setTimeout(90_000);
  const { point, painted } = await editorWithRect(page, 'reinicio');
  await markCanvas(page);

  await page.evaluate(() => window.__parcifyTest!.forceCollabReset());
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced() && window.__parcifyTest.nodes().length === 1);
  await expect.poll(async () => canvasState(page)).toEqual({ count: 1, replaced: true, lost: false });
  await expect
    .poll(async () => {
      await repaint(page);
      return samePixel(await screenPixel(page, point), painted);
    })
    .toBe(true);
});

test('si se pierde el contexto WebGL avisa y, al recuperarlo, vuelve a pintar', async ({ page }) => {
  test.setTimeout(90_000);
  const { point, painted } = await editorWithRect(page, 'contexto');
  type Holder = { __loseContext?: WEBGL_lose_context | null };

  await page.evaluate(() => {
    const canvas = document.querySelector('[role=application] canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context') ?? null;
    (window as unknown as Holder).__loseContext = extension;
    extension?.loseContext();
  });
  await expect(page.getByRole('status').filter({ hasText: 'Restaurando el lienzo…' })).toBeVisible();

  await page.evaluate(() => (window as unknown as Holder).__loseContext?.restoreContext());
  await expect(page.getByText('Restaurando el lienzo…')).toHaveCount(0);
  await expect
    .poll(async () => {
      await repaint(page);
      return samePixel(await screenPixel(page, point), painted);
    })
    .toBe(true);
});

test('abrir y cerrar 5 vistas previas no cambia el lienzo principal con contenido cacheado y sombras', async ({ page }) => {
  test.setTimeout(240_000);
  const ana = await createVerifiedAccount(page.request, `cacheado-${test.info().project.name}`, 'Ana Caché');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Caché');
  await openEditor(page, projectId);

  // Un grupo de 256 rectángulos (más de CACHE_MIN_CHILDREN), que el renderer acaba pintando desde una textura.
  await drawRect(page, 0);
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const first = (await nodes(page))[0]!;
  await canvasArea(page).focus();
  for (let round = 1; round <= 8; round++) {
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+d');
    await expect.poll(async () => (await nodes(page)).length, { timeout: 20_000 }).toBe(2 ** round);
  }
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'group').length).toBe(1);

  // Un rectángulo con sombra (filtro).
  const box = (await canvasArea(page).boundingBox())!;
  const from = { x: box.x + box.width / 2 - 200, y: box.y + box.height / 2 + 160 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 100, from.y + 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await nodes(page)).length).toBe(258);
  await page.getByRole('button', { name: 'Añadir sombra' }).click();
  await expect.poll(async () => (await nodes(page)).some((node) => node.type === 'rect' && !!node.shadow)).toBe(true);

  await canvasArea(page).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.cachedContainers()), { timeout: 20_000 }).toBeGreaterThan(0);

  await page.getByTestId('versions-toggle').click();
  await panel(page).getByRole('button', { name: 'Crear versión con nombre' }).click();
  const nameDialog = page.getByRole('dialog', { name: 'Crear versión con nombre' });
  await nameDialog.getByLabel('Nombre de la versión').fill('Con caché');
  await nameDialog.getByRole('button', { name: 'Crear versión' }).click();
  const item = panel(page).getByTestId('version-item').filter({ hasText: 'Con caché' });
  await expect(item).toBeVisible();

  const cached = await centerOf(page, first);
  await repaint(page);
  const before = { render: await pixelAt(page, cached), screen: await screenPixel(page, cached) };

  for (let round = 1; round <= 5; round++) {
    await item.getByRole('button', { name: 'Vista previa de Con caché' }).click();
    await expect(overlay(page).getByTestId('version-preview')).toHaveAttribute('data-state', 'ready');
    // El foco sigue en «Vista previa» de la lista: Esc cierra la superposición y no la vista de versiones.
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  }

  await repaint(page);
  expect(await page.evaluate(() => window.__parcifyTest!.cachedContainers())).toBeGreaterThan(0);
  expect(await pixelAt(page, cached)).toEqual(before.render);
  expect(samePixel(await screenPixel(page, cached), before.screen)).toBe(true);

  // 5 cambios de versión con la superposición abierta, y luego cerrar: el lienzo principal sigue igual.
  await panel(page).getByRole('button', { name: 'Crear versión con nombre' }).click();
  const otherDialog = page.getByRole('dialog', { name: 'Crear versión con nombre' });
  await otherDialog.getByLabel('Nombre de la versión').fill('Otra');
  await otherDialog.getByRole('button', { name: 'Crear versión' }).click();
  const other = panel(page).getByTestId('version-item').filter({ hasText: 'Otra' });
  await expect(other).toBeVisible();
  await item.getByRole('button', { name: 'Vista previa de Con caché' }).click();
  await expect(previewArea(page)).toHaveAttribute('data-state', 'ready');
  for (let round = 1; round <= 5; round++) {
    const [target, name] = round % 2 === 1 ? [other, 'Otra'] : [item, 'Con caché'];
    await target.getByRole('button', { name: `Vista previa de ${name}` }).click();
    await expect(overlay(page).locator('h2')).toContainText(name);
    await expect(previewArea(page)).toHaveAttribute('data-state', 'ready');
  }
  await page.keyboard.press('Escape');
  await expect(overlay(page)).toHaveCount(0);

  await repaint(page);
  expect(await page.evaluate(() => window.__parcifyTest!.cachedContainers())).toBeGreaterThan(0);
  expect(await pixelAt(page, cached)).toEqual(before.render);
  expect(samePixel(await screenPixel(page, cached), before.screen)).toBe(true);
});

// DEFAULT_BACKGROUND de shared/document/init.ts (#141416).
const BACKGROUND = [0x14, 0x14, 0x16];
const previewArea = (page: Page) => overlay(page).getByTestId('version-preview');
const previewRect = (page: Page) => page.evaluate(() => window.__parcifyTest!.previewPageRect());
const previewPixel = (page: Page, point: { x: number; y: number }) =>
  page.evaluate(([x, y]) => window.__parcifyTest!.previewPixelAt(x!, y!), [point.x, point.y]);

async function moveSelected(page: Page, x: number, y: number) {
  for (const [id, value] of [['props-x', x], ['props-y', y]] as const) {
    const field = page.getByTestId(id);
    await field.fill(String(value));
    await field.press('Enter');
  }
  await expect.poll(async () => (await nodes(page)).map((node) => [node.x, node.y])).toEqual([[x, y]]);
}

async function saveNamedVersion(page: Page, name: string) {
  await panel(page).getByRole('button', { name: 'Crear versión con nombre' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear versión con nombre' });
  await dialog.getByLabel('Nombre de la versión').fill(name);
  await dialog.getByRole('button', { name: 'Crear versión' }).click();
  await expect(panel(page).getByTestId('version-item').filter({ hasText: name })).toBeVisible();
}

test('la vista previa encaja el contenido lejano con el fondo real, cambia 5 veces de versión con un canvas nuevo y Restaurar pinta lo restaurado', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const ana = await createVerifiedAccount(page.request, `superposicion-${test.info().project.name}`, 'Ana Superposición');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Superposición');
  await openEditor(page, projectId);

  // Dos versiones con el único rectángulo lejos del origen, en sitios distintos.
  await drawRect(page, 0);
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  await moveSelected(page, 5000, 4000);
  await page.getByTestId('versions-toggle').click();
  await saveNamedVersion(page, 'Lejos');
  await canvasArea(page).focus();
  await page.keyboard.press('Control+a');
  await page.getByTestId('versions-toggle').click();
  await moveSelected(page, -3000, 2500);
  await page.getByTestId('versions-toggle').click();
  await saveNamedVersion(page, 'Izquierda');

  // Con la superposición abierta se elige otra versión de la lista 5 veces (CA-9.1, CA-9.2 y CA-10.1).
  for (const name of ['Lejos', 'Izquierda', 'Lejos', 'Izquierda', 'Lejos']) {
    await panel(page).getByTestId('version-item').filter({ hasText: name }).getByRole('button', { name: `Vista previa de ${name}` }).click();
    await expect(overlay(page)).toContainText(`Viendo: ${name}`);
    await expect(previewArea(page)).toHaveAttribute('data-state', 'ready');
    const box = (await previewArea(page).boundingBox())!;

    // Todo el contenido queda dentro y centrado.
    await expect
      .poll(async () => {
        const rect = await previewRect(page);
        if (!rect) return null;
        const inside = rect.left >= box.x && rect.top >= box.y && rect.right <= box.x + box.width && rect.bottom <= box.y + box.height;
        const dx = Math.abs((rect.left + rect.right) / 2 - (box.x + box.width / 2));
        const dy = Math.abs((rect.top + rect.bottom) / 2 - (box.y + box.height / 2));
        return inside && dx <= 2 && dy <= 2;
      })
      .toBe(true);

    // Un canvas nuevo cada vez, y solo uno en la vista previa.
    const canvas = await page.evaluate(() => {
      const holder = window as unknown as { __previewCanvas?: Element | null };
      const found = document.querySelectorAll('[data-testid="version-preview"] canvas');
      const same = holder.__previewCanvas === found[0];
      holder.__previewCanvas = found[0] ?? null;
      return { count: found.length, same };
    });
    expect(canvas).toEqual({ count: 1, same: false });

    // Una esquina vacía tiene el fondo del documento y el centro del contenido, el rectángulo.
    await expect.poll(async () => samePixel(await previewPixel(page, { x: box.x + 12, y: box.y + 12 }), BACKGROUND)).toBe(true);
    const rect = (await previewRect(page))!;
    const shape = await previewPixel(page, { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
    expect(shape).not.toBeNull();
    expect(samePixel(shape, BACKGROUND, 10)).toBe(false);
  }

  // La superposición deja libre el panel derecho con la lista.
  const overlayBox = (await overlay(page).boundingBox())!;
  const rightBox = (await page.getByTestId('right-panel').boundingBox())!;
  expect(overlayBox.x + overlayBox.width).toBeLessThanOrEqual(rightBox.x - 7);
  await expect(panel(page).getByTestId('version-item').first()).toBeVisible();

  // Dos dedos del touchpad (rueda sin Ctrl) desplazan la vista previa y no el editor de debajo.
  const box = (await previewArea(page).boundingBox())!;
  const editorBefore = await page.evaluate(() => window.__parcifyTest!.camera('editor'));
  const previewBefore = await page.evaluate(() => window.__parcifyTest!.camera('preview'));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await page.evaluate(() => window.__parcifyTest!.camera('preview')))?.y).not.toBe(previewBefore?.y);
  expect(await page.evaluate(() => window.__parcifyTest!.camera('editor'))).toEqual(editorBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Restaurar desde la superposición: el lienzo principal pinta el rectángulo de esa versión.
  await overlay(page).getByRole('button', { name: 'Restaurar', exact: true }).click();
  await page.getByRole('dialog', { name: '¿Restaurar esta versión?' }).getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByText('Versión restaurada.')).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await expect.poll(async () => (await nodes(page)).map((node) => [node.x, node.y])).toEqual([[5000, 4000]]);
  await canvasArea(page).focus();
  await page.keyboard.press('Shift+1');
  await expect
    .poll(async () => {
      await repaint(page);
      const node = (await nodes(page))[0];
      if (!node) return false;
      const pixel = await pixelAt(page, await centerOf(page, node));
      return pixel !== null && !samePixel(pixel, BACKGROUND, 10);
    })
    .toBe(true);
  expect(await page.evaluate(() => document.querySelectorAll('[role=application] canvas').length)).toBe(1);
});

// Tamaño natural y dos píxeles (centro y esquina) de la imagen de una miniatura, leídos con un canvas 2D fuera del DOM.
const thumbPixels = (thumb: Locator) =>
  thumb.locator('img').evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const read = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      center: read(Math.floor(img.naturalWidth / 2), Math.floor(img.naturalHeight / 2)),
      corner: read(1, 1),
    };
  });

// Estado de las miniaturas que se ven dentro de la lista desplazable.
const visibleThumbStates = (page: Page) =>
  panel(page)
    .locator('[data-thumb-root]')
    .evaluate((root) => {
      const area = root.getBoundingClientRect();
      return Array.from(root.querySelectorAll<HTMLElement>('[data-testid="version-thumb"]'))
        .filter((thumb) => {
          const rect = thumb.getBoundingClientRect();
          return rect.bottom > area.top && rect.top < area.bottom;
        })
        .map((thumb) => thumb.dataset.state ?? '');
    });

test('cada fila de la lista de versiones lleva una miniatura pintada con el renderer del editor, sin canvas por fila', async ({ page }) => {
  test.setTimeout(180_000);
  const ana = await createVerifiedAccount(page.request, `miniaturas-${test.info().project.name}`, 'Ana Miniaturas');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Miniaturas');
  await openEditor(page, projectId);
  const canvases = () => page.evaluate(() => document.querySelectorAll('canvas').length);
  expect(await canvases()).toBe(1);

  // Una versión vacía y varias con un rectángulo lejos del origen.
  await page.getByTestId('versions-toggle').click();
  await saveNamedVersion(page, 'Vacía');
  await page.getByTestId('versions-toggle').click();
  await drawRect(page, 0);
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  await moveSelected(page, 5000, 4000);
  await page.getByTestId('versions-toggle').click();
  for (let i = 1; i <= 6; i++) await saveNamedVersion(page, `Con rectángulo ${i}`);

  const items = panel(page).getByTestId('version-item');
  const thumbOf = (name: string) => items.filter({ hasText: name }).getByTestId('version-thumb');

  // La vacía avisa con texto; las demás muestran el rectángulo centrado sobre el fondo del documento.
  const filled = thumbOf('Con rectángulo 6');
  await expect(filled).toHaveAttribute('data-state', 'image');
  const box = (await filled.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([64, 40]);
  const pixels = await thumbPixels(filled);
  expect([pixels.width, pixels.height]).toEqual([128, 80]);
  expect(samePixel(pixels.corner, BACKGROUND, 6)).toBe(true);
  expect(samePixel(pixels.center, BACKGROUND, 10)).toBe(false);

  // Al desplazar la lista, las filas que se ven acaban pintadas y no aparece ningún canvas más en el documento.
  const list = panel(page).locator('[data-thumb-root]');
  for (const top of ['end', 'start', 'end'] as const) {
    await list.evaluate((node, where) => node.scrollTo({ top: where === 'end' ? node.scrollHeight : 0 }), top);
    await expect.poll(async () => (await visibleThumbStates(page)).filter((state) => state === 'loading').length, { timeout: 30_000 }).toBe(0);
    expect(await canvases()).toBe(1);
  }
  await thumbOf('Vacía').scrollIntoViewIfNeeded();
  await expect(thumbOf('Vacía')).toHaveAttribute('data-state', 'empty');
  await expect(thumbOf('Vacía').getByRole('img', { name: 'Página vacía' })).toBeVisible();
  expect(await canvases()).toBe(1);
});
