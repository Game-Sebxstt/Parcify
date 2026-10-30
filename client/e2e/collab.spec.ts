import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinProjectByLink } from './helpers/invite.ts';
import { chooseOption } from './helpers/select.ts';
import { pickTool } from './helpers/tools.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const remote = (page: Page) => page.evaluate(() => window.__parcifyTest!.remote());
const toPage = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__parcifyTest!.toPage(px!, py!), [x, y]);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
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

async function canvasOrigin(page: Page) {
  const box = (await page.getByRole('application', { name: 'Lienzo del proyecto' }).boundingBox())!;
  return { x: box.x + box.width / 2 - 150, y: box.y + box.height / 2 - 120 };
}

test('dos personas en el mismo proyecto: cambios, cursores, deshacer propio y degradar en vivo', async ({ page, browser }) => {
  // Dos navegadores con el motor y la colaboración: más lento que el resto, sobre todo en Firefox.
  test.setTimeout(150_000);
  const label = `collab-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Colabora');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Colabora');

  // Bea entra como editora con un enlace de proyecto; no es del espacio de Ana.
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Cartel compartido');
  await joinProjectByLink(page.request, projectId, bea.request, 'editor');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Ana crea un rectángulo y Bea lo ve.
  const origin = await canvasOrigin(page);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(bea)).length).toBe(1);
  const created = (await nodes(page))[0]!;

  // Ana lo mueve y Bea ve la posición nueva.
  const start = await toPage(page, created.x + created.w / 2, created.y + created.h / 2);
  await drag(page, start, { x: start.x + 90, y: start.y + 40 }, ['Control']);
  await expect.poll(async () => (await nodes(bea)).find((node) => node.id === created.id)!.x).toBeCloseTo(created.x + 90, 0);

  // Cursor y selección de Ana en la pantalla de Bea.
  await page.mouse.move(start.x + 20, start.y + 60, { steps: 3 });
  await expect
    .poll(async () => (await remote(bea)).find((state) => state.name === 'Ana Colabora'))
    .toMatchObject({ cursor: expect.objectContaining({ x: expect.any(Number) }), selection: [created.id] });

  // Bea crea una elipse; Ana deshace y solo se deshace su movimiento.
  const beaOrigin = await canvasOrigin(bea);
  await pickTool(bea, 'Formas', 'Elipse');
  await drag(bea, { x: beaOrigin.x + 260, y: beaOrigin.y }, { x: beaOrigin.x + 340, y: beaOrigin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(2);
  await page.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await nodes(page)).find((node) => node.id === created.id)!.x).toBeCloseTo(created.x, 0);
  await expect.poll(async () => (await nodes(bea)).find((node) => node.id === created.id)!.x).toBeCloseTo(created.x, 0);
  expect(await nodes(page)).toHaveLength(2);

  // Ana degrada a Bea a lectora desde el panel Compartir con el proyecto abierto: pasa a solo lectura sin recargar.
  await page.getByTestId('share').click();
  const panel = page.getByRole('dialog', { name: 'Compartir «Cartel compartido»' });
  await chooseOption(page, panel.getByLabel(`Rol de ${beaAccount.name}`), 'Solo puede ver');
  await expect(page.getByText(`${beaAccount.name}: Solo puede ver.`)).toBeVisible();
  await panel.getByRole('button', { name: 'Cerrar' }).click();
  await expect.poll(() => bea.evaluate(() => window.__parcifyTest!.readOnly()), { timeout: 15_000 }).toBe(true);
  await expect(bea.getByText('Solo lectura', { exact: true })).toBeVisible();

  // Como lectora no puede crear nada.
  const before = (await nodes(bea)).length;
  await bea.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await bea.keyboard.press('r');
  await drag(bea, { x: beaOrigin.x - 100, y: beaOrigin.y + 160 }, { x: beaOrigin.x, y: beaOrigin.y + 240 });
  await bea.waitForTimeout(500);
  expect(await nodes(bea)).toHaveLength(before);
  expect(await nodes(page)).toHaveLength(before);

  await otherContext.close();
});

test('sin Worker el documento se abre en el hilo principal y dos personas siguen editando juntas', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const label = `noworker-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Sin Worker');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Con Worker');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Sin worker');
  await joinProjectByLink(page.request, projectId, bea.request, 'editor');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', { value: undefined, configurable: true });
  });
  const warnings: string[] = [];
  page.on('console', (message) => message.type() === 'warning' && warnings.push(message.text()));
  await openEditor(page, projectId);
  await openEditor(bea, projectId);
  expect(warnings.some((text) => text.includes('sin worker'))).toBe(true);
  const origin = await canvasOrigin(page);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(bea)).length).toBe(1);
  const created = (await nodes(bea))[0]!;
  const start = await toPage(bea, created.x + created.w / 2, created.y + created.h / 2);
  await drag(bea, start, { x: start.x + 60, y: start.y }, ['Control']);
  await expect.poll(async () => (await nodes(page)).find((node) => node.id === created.id)!.x).toBeCloseTo(created.x + 60, 0);
  await otherContext.close();
});

test('sin red, al recargar se ve lo que había en la copia local del navegador', async ({ page }) => {
  test.setTimeout(90_000);
  const ana = await createVerifiedAccount(page.request, `offline-${test.info().project.name}`, 'Ana Sin Red');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Copia local');
  await openEditor(page, projectId);
  const origin = await canvasOrigin(page);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const created = (await nodes(page))[0]!;
  // La copia local se escribe desde el worker; se le deja un momento.
  await page.waitForTimeout(1_000);
  // El servidor de colaboración deja de estar al alcance: el token apunta a un puerto cerrado.
  await page.route('**/v1/projects/*/collab-token', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { url: string };
    await route.fulfill({ response, json: { ...body, url: 'ws://localhost:1' } });
  });
  await page.reload();
  await page.waitForFunction(() => window.__parcifyTest !== undefined);
  await expect.poll(async () => (await nodes(page)).map((node) => node.id)).toEqual([created.id]);
  expect(await page.evaluate(() => window.__parcifyTest!.status())).not.toBe('connected');
  await expect(page.getByText('El editor dejó de responder')).toHaveCount(0);
});

test('dos personas editan los puntos de paso del mismo conector y ven el mismo recorrido (CA-1.6)', async ({ page, browser }) => {
  test.setTimeout(150_000);
  type Path = Node & { waypoints?: number[][] };
  type Handles = { vertices: Array<{ x: number; y: number }>; mids: Array<{ x: number; y: number }> };
  const label = `collab-waypoints-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Recorrido');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Recorrido');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Recorridos compartidos');
  await joinProjectByLink(page.request, projectId, bea.request, 'editor');
  await openEditor(page, projectId);
  await openEditor(bea, projectId);
  const handles = (who: Page) => who.evaluate(() => (window.__parcifyTest!.overlayModel()?.selection?.lineHandles ?? null) as unknown as Handles | null);
  const waypoints = async (who: Page) => ((await nodes(who)).find((node) => node.type === 'connector') as Path | undefined)?.waypoints;

  // Ana dibuja un conector libre y lo pasa a recto.
  const origin = await canvasOrigin(page);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  await canvas.focus();
  await page.keyboard.press('c');
  await drag(page, origin, { x: origin.x + 300, y: origin.y });
  await expect.poll(async () => (await nodes(bea)).filter((node) => node.type === 'connector').length).toBe(1);
  await page.getByTestId('props-route').getByRole('radio', { name: 'Recto' }).click();

  // Ana arrastra el punto medio hacia abajo: Bea ve el mismo punto de paso.
  const mid = { x: origin.x + 150, y: origin.y };
  await page.mouse.move(mid.x, mid.y, { steps: 2 });
  await expect.poll(async () => (await handles(page))?.mids.length ?? 0).toBe(1);
  await drag(page, mid, { x: mid.x, y: mid.y + 80 });
  await expect.poll(() => waypoints(page)).toHaveLength(1);
  const first = (await waypoints(page))!;
  await expect.poll(() => waypoints(bea)).toEqual(first);

  // Bea selecciona el conector y mueve ese punto; los dos acaban con el mismo valor.
  const connector = (await nodes(bea)).find((node) => node.type === 'connector')!;
  const point = await toPage(bea, first[0]![0]!, first[0]![1]!);
  await bea.mouse.click(point.x, point.y);
  await expect.poll(() => bea.evaluate(() => [...window.__parcifyTest!.selection()])).toEqual([connector.id]);
  await bea.waitForTimeout(500);
  await drag(bea, point, { x: point.x + 60, y: point.y + 20 });
  await expect.poll(async () => (await waypoints(bea))?.[0]?.[0]).toBeGreaterThan(first[0]![0]! + 30);
  const second = (await waypoints(bea))!;
  await expect.poll(() => waypoints(page)).toEqual(second);

  await otherContext.close();
});

test('dos personas mueven a la vez keyframes distintos de la misma pista y ven la misma animación (CA-5.7)', async ({ page, browser }) => {
  test.setTimeout(150_000);
  type Animation = { delay: number; duration: number; tracks: Partial<Record<string, Record<string, { t: number }>>> };
  const label = `collab-keyframes-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Keyframes');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Keyframes');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Keyframes compartidos');
  await joinProjectByLink(page.request, projectId, bea.request, 'editor');
  await openEditor(page, projectId);
  await openEditor(bea, projectId);
  const animation = (who: Page, id: string) => who.evaluate((nodeId) => (window.__parcifyTest!.animations() as unknown as Record<string, Animation>)[nodeId] ?? null, id);
  const times = async (who: Page, id: string) => {
    const anim = await animation(who, id);
    return Object.values(anim?.tracks.offsetY ?? {})
      .map((kf) => Math.round(anim!.delay + kf.t * anim!.duration))
      .sort((a, b) => a - b);
  };

  // Ana dibuja un rectángulo y le pone «Deslizar»: Desplazamiento Y con keyframes en 0 y 500 ms.
  const origin = await canvasOrigin(page);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(bea)).length).toBe(1);
  const rect = (await nodes(page))[0]!;
  await page.getByTestId('properties-panel').getByTestId('props-anim-presets').getByRole('button', { name: 'Deslizar' }).click();
  await expect.poll(() => times(bea, rect.id)).toEqual([0, 500]);

  // Las dos abren la línea de tiempo. Ana arrastra el de 500 ms 100 ms a la izquierda y Bea, a la vez, el de 0 ms
  // 100 ms a la derecha (con Mayús tras apoyar, sin imán).
  const grab = async (who: Page, time: string) => {
    await who.getByRole('button', { name: 'Animar', exact: true }).click();
    const panel = who.getByTestId('timeline');
    const first = panel.getByRole('gridcell', { name: /^Desplazamiento Y, fotograma clave en 0,00 s/ });
    const last = panel.getByRole('gridcell', { name: /^Desplazamiento Y, fotograma clave en 0,50 s/ });
    await expect(last).toBeVisible();
    const a = (await first.boundingBox())!;
    const b = (await last.boundingBox())!;
    const zoom = (b.x - a.x) / 500;
    const target = time === '0,00 s' ? a : b;
    return { x: target.x + target.width / 2, y: target.y + target.height / 2, zoom };
  };
  const anaPoint = await grab(page, '0,50 s');
  const beaPoint = await grab(bea, '0,00 s');
  const move = async (who: Page, point: { x: number; y: number; zoom: number }, deltaMs: number) => {
    await who.mouse.move(point.x, point.y);
    await who.mouse.down();
    await who.keyboard.down('Shift');
    await who.mouse.move(point.x + (deltaMs / 2) * point.zoom, point.y, { steps: 3 });
    await who.mouse.move(point.x + deltaMs * point.zoom, point.y, { steps: 3 });
    await who.mouse.up();
    await who.keyboard.up('Shift');
  };
  await Promise.all([move(page, anaPoint, -100), move(bea, beaPoint, 100)]);

  // Los dos ven los dos movimientos: ninguno pisa al otro.
  const bothMoved = async (who: Page) => {
    const [first, second] = await times(who, rect.id);
    return first! > 50 && second! < 450;
  };
  await expect.poll(() => bothMoved(page)).toBe(true);
  await expect.poll(() => bothMoved(bea)).toBe(true);
  await expect.poll(async () => JSON.stringify(await animation(page, rect.id)) === JSON.stringify(await animation(bea, rect.id))).toBe(true);
  const [first, second] = await times(page, rect.id);
  expect(Math.abs(first! - 100)).toBeLessThan(1 / beaPoint.zoom + 1);
  expect(Math.abs(second! - 400)).toBeLessThan(1 / anaPoint.zoom + 1);
  await expect.poll(async () => JSON.stringify(await times(bea, rect.id))).toBe(JSON.stringify([first, second]));
  await otherContext.close();
});
