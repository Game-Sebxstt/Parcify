import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { canvasGap } from './helpers/canvas.ts';
import { samePixel, screenPixel } from './helpers/pixels.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; shadow?: unknown };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const panel = (page: Page) => page.getByTestId('versions-panel');
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

  // Vista previa de solo lectura con el estado de la versión.
  await named.getByRole('button', { name: 'Vista previa de Un rectángulo' }).click();
  const previewDialog = page.getByRole('dialog', { name: 'Un rectángulo' });
  await expect(previewDialog.getByTestId('version-preview')).toHaveAttribute('data-state', 'ready');

  // Restaurar desde la vista previa, con confirmación.
  await previewDialog.getByRole('button', { name: 'Restaurar', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '¿Restaurar esta versión?' });
  await confirm.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByText('Versión restaurada.')).toBeVisible();

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
    const dialog = page.getByRole('dialog', { name: 'Con caché' });
    await expect(dialog.getByTestId('version-preview')).toHaveAttribute('data-state', 'ready');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }

  await repaint(page);
  expect(await page.evaluate(() => window.__parcifyTest!.cachedContainers())).toBeGreaterThan(0);
  expect(await pixelAt(page, cached)).toEqual(before.render);
  expect(samePixel(await screenPixel(page, cached), before.screen)).toBe(true);
});
