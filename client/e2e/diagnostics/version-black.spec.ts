import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from '../helpers/account.ts';
import { canvasGap } from '../helpers/canvas.ts';

// Reproducción del lienzo negro al ver versiones. Solo se ejecuta con DIAG=1 y una vez: anota lo que pasa,
// no protege ningún comportamiento.
type Node = { id: string; type: string; x: number; y: number; w: number; h: number; shadow?: unknown };
type Rgba = [number, number, number, number];

const VERSION = 'Diagnóstico';
const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const canvasArea = (page: Page) => page.getByRole('application', { name: 'Lienzo del proyecto' });

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

async function drawRect(page: Page, dx: number, dy: number) {
  const box = (await canvasArea(page).boundingBox())!;
  const from = { x: box.x + box.width / 2 - 200 + dx, y: box.y + box.height / 2 - 100 + dy };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 40, { steps: 4 });
  await page.mouse.move(from.x + 100, from.y + 80, { steps: 4 });
  await page.mouse.up();
}

const toPage = (page: Page, x: number, y: number) => page.evaluate(([wx, wy]) => window.__parcifyTest!.toPage(wx!, wy!), [x, y]);

const pixelAt = (page: Page, point: { x: number; y: number }) =>
  page.evaluate(([x, y]) => window.__parcifyTest!.pixelAt(x!, y!), [point.x, point.y]) as Promise<Rgba | null>;

// Lo que de verdad se ve: una captura de 1×1 px decodificada en la página (sin dependencias de PNG en Node).
async function screenPixel(page: Page, point: { x: number; y: number }): Promise<Rgba> {
  const shot = await page.screenshot({ clip: { x: Math.floor(point.x), y: Math.floor(point.y), width: 1, height: 1 } });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0]!, data[1]!, data[2]!, data[3]!] as Rgba;
  }, shot.toString('base64'));
}

// Un movimiento del ratón por el lienzo cambia el hover y obliga al editor a pintar un frame nuevo.
async function repaint(page: Page) {
  const box = await canvasGap(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, { steps: 3 });
  await page.mouse.move(box.x + box.width - 40, box.y + 40, { steps: 3 });
  await page.waitForTimeout(300);
}

type Sample = { cached: Rgba | null; shadow: Rgba | null; empty: Rgba | null; screenCached: Rgba; screenShadow: Rgba; screenEmpty: Rgba; cachedContainers: number };

async function sample(page: Page, points: { cached: { x: number; y: number }; shadow: { x: number; y: number }; empty: { x: number; y: number } }): Promise<Sample> {
  await repaint(page);
  return {
    cached: await pixelAt(page, points.cached),
    shadow: await pixelAt(page, points.shadow),
    empty: await pixelAt(page, points.empty),
    screenCached: await screenPixel(page, points.cached),
    screenShadow: await screenPixel(page, points.shadow),
    screenEmpty: await screenPixel(page, points.empty),
    cachedContainers: await page.evaluate(() => window.__parcifyTest!.cachedContainers()),
  };
}

// Un grupo de 256 rectángulos (más de CACHE_MIN_CHILDREN) que el renderer acaba pintando desde una textura y un
// rectángulo con sombra (filtro).
async function prepareScene(page: Page) {
  const ana = await createVerifiedAccount(page.request, `diag-${test.info().project.name}`, 'Ana Diagnóstico');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Lienzo negro');
  await openEditor(page, projectId);
  await drawRect(page, 0, 0);
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

  await drawRect(page, 0, 260);
  await expect.poll(async () => (await nodes(page)).length).toBe(258);
  await page.getByRole('checkbox', { name: 'Sombra' }).check();
  const withShadow = (node: Node) => node.type === 'rect' && !!node.shadow;
  await expect.poll(async () => (await nodes(page)).some(withShadow)).toBe(true);
  const shadowed = (await nodes(page)).find(withShadow)!;

  await canvasArea(page).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.cachedContainers()), { timeout: 20_000 }).toBeGreaterThan(0);

  const box = (await canvasArea(page).boundingBox())!;
  return {
    cached: await toPage(page, first.x + first.w / 2, first.y + first.h / 2),
    shadow: await toPage(page, shadowed.x + shadowed.w / 2, shadowed.y + shadowed.h + 6),
    empty: { x: box.x + box.width / 2 + 150, y: box.y + box.height / 2 - 150 },
  };
}

async function report(name: string, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  console.log(`[diagnóstico ${test.info().project.name}] ${name}\n${body}`);
  await test.info().attach(name, { body, contentType: 'application/json' });
}

test('diagnóstico: el lienzo principal tras abrir y cerrar 5 vistas previas de versión', async ({ page }) => {
  test.setTimeout(240_000);
  const points = await prepareScene(page);

  const panel = page.getByTestId('versions-panel');
  await page.getByTestId('versions-toggle').click();
  await panel.getByRole('button', { name: 'Crear versión con nombre' }).click();
  const nameDialog = page.getByRole('dialog', { name: 'Crear versión con nombre' });
  await nameDialog.getByLabel('Nombre de la versión').fill(VERSION);
  await nameDialog.getByRole('button', { name: 'Crear versión' }).click();
  const item = panel.getByTestId('version-item').filter({ hasText: VERSION });
  await expect(item).toBeVisible();

  const before = await sample(page, points);
  await test.info().attach('antes', { body: await canvasArea(page).screenshot(), contentType: 'image/png' });

  const previews: Array<{ round: number; previewEmpty: Rgba | null }> = [];
  for (let round = 1; round <= 5; round++) {
    await item.getByRole('button', { name: `Vista previa de ${VERSION}` }).click();
    const dialog = page.getByRole('dialog', { name: VERSION });
    const preview = dialog.getByTestId('version-preview');
    await expect(preview).toHaveAttribute('data-state', 'ready');
    const rect = (await preview.boundingBox())!;
    previews.push({ round, previewEmpty: await screenPixel(page, { x: rect.x + 8, y: rect.y + 8 }) });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }

  const after = await sample(page, points);
  await test.info().attach('después', { body: await canvasArea(page).screenshot(), contentType: 'image/png' });
  await report('vistas-previas', { before, after, previews });

  expect.soft(after.cachedContainers, 'contenedores cacheados tras las vistas previas').toBeGreaterThan(0);
  expect.soft(after.cached, 'píxel de la forma cacheada (render nuevo)').toEqual(before.cached);
  expect.soft(after.shadow, 'píxel de la sombra (render nuevo)').toEqual(before.shadow);
  expect.soft(after.screenCached, 'píxel de la forma cacheada en pantalla').toEqual(before.screenCached);
  expect.soft(after.screenEmpty, 'píxel vacío en pantalla').toEqual(before.screenEmpty);
});

test('diagnóstico: reapertura del motor con un reinicio del documento', async ({ page }) => {
  test.setTimeout(240_000);
  const points = await prepareScene(page);
  const before = await sample(page, points);
  await page.evaluate(() => {
    (window as unknown as { __diagCanvas?: Element | null }).__diagCanvas = document.querySelector('[role=application] canvas');
  });

  // El depurador se activa antes: con el hilo principal ocupado ya no respondería a Debugger.enable.
  const cdp = test.info().project.name === 'chromium' ? await page.context().newCDPSession(page) : null;
  await cdp?.send('Debugger.enable');
  await page.evaluate(() => {
    void window.__parcifyTest!.forceCollabReset();
  });
  const synced = await page
    .waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced() && window.__parcifyTest.nodes().length === 258, undefined, {
      timeout: 20_000,
    })
    .then(
      () => true,
      () => false,
    );
  // El motor se vuelve a montar después de sincronizar: se espera y se comprueba que la página siga respondiendo.
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const responsive = await Promise.race([page.evaluate(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000))]);
  const recovered = synced && responsive;
  if (!recovered) {
    // La página no responde: se pausa el hilo principal para ver en qué bucle está.
    let stack: string[] = [];
    if (cdp) {
      const paused = new Promise<string[]>((resolve) => {
        cdp.once('Debugger.paused', (event) =>
          resolve(event.callFrames.slice(0, 25).map((frame) => `${frame.functionName || '(anónima)'} ${frame.url.replace(/^.*\/_astro\//, '')}:${frame.location.lineNumber + 1}:${(frame.location.columnNumber ?? 0) + 1}`)),
        );
      });
      void cdp.send('Debugger.pause').catch(() => {});
      stack = await Promise.race([paused, new Promise<string[]>((resolve) => setTimeout(() => resolve(['sin pausa en 10 s']), 10_000))]);
    }
    await report('reinicio', { before, synced, responsive, stack });
    expect.soft(recovered, 'la página vuelve a responder tras el reinicio').toBe(true);
    return;
  }
  await page.waitForTimeout(500);

  const after = await sample(page, points);
  const sameCanvas = await page.evaluate(
    () => (window as unknown as { __diagCanvas?: Element | null }).__diagCanvas === document.querySelector('[role=application] canvas'),
  );
  const contextLost = await page.evaluate(() => {
    const canvas = document.querySelector('[role=application] canvas') as HTMLCanvasElement | null;
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    return gl ? gl.isContextLost() : null;
  });
  await test.info().attach('tras-reinicio', { body: await canvasArea(page).screenshot(), contentType: 'image/png' });
  await report('reinicio', { before, after, sameCanvas, contextLost });

  expect.soft(after.screenCached, 'píxel de la forma en pantalla tras el reinicio').toEqual(before.screenCached);
  expect.soft(after.screenEmpty, 'píxel vacío en pantalla tras el reinicio').toEqual(before.screenEmpty);
});
