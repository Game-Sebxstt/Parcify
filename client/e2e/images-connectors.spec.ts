import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { solidPng } from './helpers/image.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; from?: unknown; to?: unknown; assetId?: string };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const images = (page: Page) => page.evaluate(() => window.__parcifyTest!.images());
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

test('imagen subida al lienzo y conector entre dos formas, vistos por otra persona', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const label = `imgcon-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Imagen');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Imagen');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Imágenes y conectores');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Ana sube una imagen con la herramienta de imagen: se crea el nodo y los dos pintan su textura.
  await page.getByTestId('image-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: solidPng(300) });
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'image').length, { timeout: 30_000 }).toBe(1);
  const image = (await nodes(page)).find((node) => node.type === 'image')!;
  expect(image).toMatchObject({ w: 300, h: 300 });
  await expect.poll(async () => (await images(page))[image.id], { timeout: 30_000 }).toBe('ready');
  await expect.poll(async () => (await images(bea))[image.id], { timeout: 30_000 }).toBe('ready');

  // Dos rectángulos y un conector de uno a otro con la herramienta C.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  // Debajo de la imagen, dentro de la vista.
  const left = await toPage(page, image.x, image.y + image.h + 30);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, left, { x: left.x + 80, y: left.y + 60 });
  const right = await toPage(page, image.x + 220, image.y + image.h + 30);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, right, { x: right.x + 80, y: right.y + 60 });
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'rect').length).toBe(2);
  const [a, b] = (await nodes(page)).filter((node) => node.type === 'rect').sort((p, q) => p.x - q.x);

  await canvas.focus();
  await page.keyboard.press('c');
  const from = await toPage(page, a!.x + a!.w / 2, a!.y + a!.h / 2);
  const to = await toPage(page, b!.x + b!.w / 2, b!.y + b!.h / 2);
  await drag(page, from, to);
  await expect.poll(async () => (await nodes(bea)).filter((node) => node.type === 'connector').length).toBe(1);
  const connector = (await nodes(bea)).find((node) => node.type === 'connector')!;
  expect(connector.from).toMatchObject({ nodeId: a!.id });
  expect(connector.to).toMatchObject({ nodeId: b!.id });

  // Bea borra el destino: el conector se queda con el último punto como coordenada libre.
  // Lejos del extremo del conector, que está encima en el orden z.
  const target = await toPage(bea, b!.x + 8, b!.y + b!.h - 8);
  await bea.mouse.click(target.x, target.y);
  await bea.keyboard.press('Delete');
  await expect.poll(async () => (await nodes(page)).find((node) => node.type === 'connector')?.to).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });

  await otherContext.close();
});

test('al arrastrar el extremo de un conector, su tirador sigue al puntero en cada frame (CA-1.1)', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `tirador-conector-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const a = { x: box.x + box.width / 2 - 200, y: box.y + box.height / 2 - 60 };
  const b = { x: a.x + 160, y: a.y };

  await canvas.focus();
  await page.keyboard.press('c');
  await drag(page, a, b);
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'connector').length).toBe(1);
  const connector = (await nodes(page)).find((node) => node.type === 'connector')!;
  await expect.poll(() => page.evaluate(() => [...window.__parcifyTest!.selection()])).toEqual([connector.id]);

  const handle = () => page.evaluate(() => window.__parcifyTest!.overlayModel()?.selection?.lineHandles?.vertices[1] ?? null);
  await expect.poll(handle).not.toBeNull();
  const end = (await handle())!;
  const start = { x: box.x + end.x, y: box.y + end.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Tres lecturas a mitad del arrastre: el tirador está a menos de 1 px del puntero en cada una.
  for (const t of [0.25, 0.5, 0.75]) {
    const at = { x: start.x + 200 * t, y: start.y + 60 * t };
    await page.mouse.move(at.x, at.y, { steps: 3 });
    await expect
      .poll(async () => {
        const p = await handle();
        return p ? Math.hypot(box.x + p.x - at.x, box.y + p.y - at.y) : Infinity;
      })
      .toBeLessThan(1);
  }
  await page.mouse.move(start.x + 200, start.y + 60, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await nodes(page)).find((node) => node.type === 'connector')!.to).not.toEqual(connector.to);
});

type Handles = {
  vertices: Array<{ x: number; y: number }>;
  mids: Array<{ x: number; y: number; segment: number }>;
  segments: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; axis: 'x' | 'y'; index: number }>;
  activeVertex: number | null;
};
type PathNode = Node & { points?: number[][]; waypoints?: number[][]; route?: string };

const lineHandles = (page: Page) => page.evaluate(() => (window.__parcifyTest!.overlayModel()?.selection?.lineHandles ?? null) as unknown as Handles | null);
const pathNode = async (page: Page, id: string) => (await nodes(page)).find((node) => node.id === id) as PathNode | undefined;

test('líneas: un punto medio añade un vértice, el doble clic lo quita y Supr borra el vértice marcado (CA-1.3)', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `vertices-linea-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const a = { x: box.x + box.width / 2 - 150, y: box.y + box.height / 2 };
  const b = { x: a.x + 300, y: a.y };

  await canvas.focus();
  await page.keyboard.press('l');
  await drag(page, a, b);
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'line').length).toBe(1);
  const id = (await nodes(page)).find((node) => node.type === 'line')!.id;
  await expect.poll(() => page.evaluate(() => [...window.__parcifyTest!.selection()])).toEqual([id]);

  // Con el ratón encima aparece el punto medio; arrastrarlo deja 3 puntos.
  const mid = { x: (a.x + b.x) / 2, y: a.y };
  await page.mouse.move(mid.x, mid.y, { steps: 2 });
  await expect.poll(async () => (await lineHandles(page))?.mids.length ?? 0).toBe(1);
  await drag(page, mid, { x: mid.x, y: mid.y + 80 });
  await expect.poll(async () => (await pathNode(page, id))?.points?.length).toBe(3);

  // Doble clic en el vértice central: vuelve a 2.
  const center = (await lineHandles(page))!.vertices[1]!;
  await page.mouse.dblclick(box.x + center.x, box.y + center.y);
  await expect.poll(async () => (await pathNode(page, id))?.points?.length).toBe(2);

  // Con 2 puntos, el doble clic en un vértice no hace nada.
  const end = (await lineHandles(page))!.vertices[0]!;
  await page.mouse.dblclick(box.x + end.x, box.y + end.y);
  await page.waitForTimeout(200);
  expect((await pathNode(page, id))?.points?.length).toBe(2);

  // Otro vértice, marcado con un clic: Supr lo borra y la línea se queda.
  await page.mouse.move(mid.x, mid.y, { steps: 2 });
  await expect.poll(async () => (await lineHandles(page))?.mids.length ?? 0).toBe(1);
  await drag(page, mid, { x: mid.x, y: mid.y - 60 });
  await expect.poll(async () => (await pathNode(page, id))?.points?.length).toBe(3);
  await page.waitForTimeout(500);
  const added = (await lineHandles(page))!.vertices[1]!;
  await page.mouse.click(box.x + added.x, box.y + added.y);
  await expect.poll(async () => (await lineHandles(page))?.activeVertex).toBe(1);
  await expect(page.getByTestId('context-delete-point')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await pathNode(page, id))?.points?.length).toBe(2);
  expect(await pathNode(page, id)).toBeDefined();
});

test('conector en codo: el tramo se desplaza y se conserva al mover los nodos; reanclar resalta el destino (CA-1.4, 1.5, 1.9, RF-1.5)', async ({ page }) => {
  test.setTimeout(90_000);
  const account = await createVerifiedAccount(page.request, `codo-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 260, y: box.y + box.height / 2 - 160 };

  // A arriba a la izquierda, B abajo a la derecha y C a la derecha de B.
  for (const [dx, dy] of [
    [0, 0],
    [300, 200],
    [520, 200],
  ] as const) {
    await canvas.focus();
    await page.keyboard.press('r');
    await drag(page, { x: origin.x + dx, y: origin.y + dy }, { x: origin.x + dx + 100, y: origin.y + dy + 60 });
  }
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'rect').length).toBe(3);
  const [a, b, c] = (await nodes(page)).filter((node) => node.type === 'rect').sort((p, q) => p.x - q.x) as [Node, Node, Node];

  // Conector del lado derecho de A al izquierdo de B (en codo, el recorrido por defecto).
  await canvas.focus();
  await page.keyboard.press('c');
  await drag(page, await toPage(page, a.x + a.w - 2, a.y + a.h / 2), await toPage(page, b.x + 2, b.y + b.h / 2));
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'connector').length).toBe(1);
  const connector = (await nodes(page)).find((node) => node.type === 'connector')!;
  expect(connector.from).toEqual({ nodeId: a.id, anchor: 'right' });
  expect(connector.to).toEqual({ nodeId: b.id, anchor: 'left' });
  await expect.poll(async () => (await lineHandles(page))?.segments.length ?? 0).toBeGreaterThan(0);

  // Tramo central (vertical): 40 px a la derecha.
  const vertical = (await lineHandles(page))!.segments.find((segment) => segment.axis === 'x')!;
  const grab = { x: box.x + (vertical.a.x + vertical.b.x) / 2, y: box.y + (vertical.a.y + vertical.b.y) / 2 };
  await drag(page, grab, { x: grab.x + 40, y: grab.y });
  await expect.poll(async () => (await pathNode(page, connector.id))?.waypoints?.length ?? 0).toBeGreaterThan(0);
  const shifted = (await pathNode(page, connector.id))!.waypoints!;
  const zoom = await page.evaluate(() => {
    const hooks = window.__parcifyTest!;
    return (hooks.toPage(100, 0).x - hooks.toPage(0, 0).x) / 100;
  });
  const verticalAt = (await toPage(page, shifted[0]![0]!, 0)).x;
  expect(Math.abs(verticalAt - grab.x - 40)).toBeLessThan(1.5);

  // CA-1.9: A y B (sin el conector) 100 px a la derecha: los waypoints se trasladan lo mismo.
  const start = await toPage(page, a.x + 20, a.y + 20);
  const inB = await toPage(page, b.x + 50, b.y + 30);
  await page.mouse.click(start.x, start.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(inB.x, inB.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await page.evaluate(() => [...window.__parcifyTest!.selection()])).sort()).toEqual([a.id, b.id].sort());
  await drag(page, start, { x: start.x + 100, y: start.y }, ['Control']);
  await expect.poll(async () => (await pathNode(page, connector.id))!.waypoints![0]![0]).toBeCloseTo(shifted[0]![0]! + 100 / zoom, 2);
  const moved = (await pathNode(page, connector.id))!.waypoints!;
  moved.forEach((point, i) => {
    expect(point[0]!).toBeCloseTo(shifted[i]![0]! + 100 / zoom, 2);
    expect(point[1]!).toBeCloseTo(shifted[i]![1]!, 2);
  });

  // CA-1.4: solo B, 100 px hacia abajo: el tramo desplazado sigue en su sitio y el recorrido, ortogonal.
  const bNow = (await nodes(page)).find((node) => node.id === b.id)!;
  const bCenter = await toPage(page, bNow.x + bNow.w / 2, bNow.y + bNow.h / 2);
  await page.mouse.click(bCenter.x, bCenter.y);
  await drag(page, bCenter, { x: bCenter.x, y: bCenter.y + 100 }, ['Control']);
  await expect.poll(async () => (await nodes(page)).find((node) => node.id === b.id)!.y).toBeCloseTo(bNow.y + 100 / zoom, 0);
  expect((await pathNode(page, connector.id))!.waypoints).toEqual(moved);
  const cid = connector.id;

  // Un clic en el tramo vertical, que sigue en la x desplazada, selecciona el conector.
  const aNow = (await nodes(page)).find((node) => node.id === a.id)!;
  const bMoved = (await nodes(page)).find((node) => node.id === b.id)!;
  const movedAt = (await toPage(page, moved[0]![0]!, 0)).x;
  const top = (await toPage(page, 0, aNow.y + aNow.h / 2)).y;
  const bottom = (await toPage(page, 0, bMoved.y + bMoved.h / 2)).y;
  await page.mouse.click(movedAt, (top + bottom) / 2);
  await expect.poll(() => page.evaluate(() => [...window.__parcifyTest!.selection()])).toEqual([cid]);
  const segments = (await lineHandles(page))!.segments;
  for (const segment of segments) expect(Math.abs(segment.a.x - segment.b.x) < 0.01 || Math.abs(segment.a.y - segment.b.y) < 0.01).toBe(true);
  expect(segments.some((segment) => segment.axis === 'x' && Math.abs(box.x + segment.a.x - movedAt) < 1)).toBe(true);

  // RF-1.5: llevar el extremo final hacia C resalta C y sus 5 anclas; al soltar queda anclado a C.
  const end = (await lineHandles(page))!.vertices[1]!;
  const cNow = (await nodes(page)).find((node) => node.id === c.id)!;
  const target = await toPage(page, cNow.x + 4, cNow.y + cNow.h / 2);
  await page.mouse.move(box.x + end.x, box.y + end.y);
  await page.mouse.down();
  await page.mouse.move(target.x - 20, target.y, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 2 });
  await expect
    .poll(() => page.evaluate(() => window.__parcifyTest!.overlayModel()?.anchorTarget ?? null))
    .toMatchObject({ anchors: expect.arrayContaining([expect.any(Object)]), active: 3 });
  expect((await page.evaluate(() => window.__parcifyTest!.overlayModel()!.anchorTarget!.anchors)).length).toBe(5);
  await page.mouse.up();
  await expect.poll(async () => (await pathNode(page, cid))?.to).toEqual({ nodeId: c.id, anchor: 'left' });
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.overlayModel()?.anchorTarget ?? null)).toBeNull();

  // CA-1.5: «Restablecer recorrido» quita la clave.
  await page.getByTestId('props-route-reset').click();
  await expect.poll(async () => 'waypoints' in ((await pathNode(page, cid)) ?? {})).toBe(false);
  await expect(page.getByTestId('props-route-reset')).toHaveCount(0);
});

test('Pluma: 3 clics y Enter crean una línea de 3 puntos; Esc con un punto no crea nada; Shift ajusta a 45° (CA-1.8)', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `pluma-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 150, y: box.y + box.height / 2 - 80 };
  const lines = async () => (await nodes(page)).filter((node) => node.type === 'line') as PathNode[];

  // Esc con un solo punto: no se crea nada.
  await canvas.focus();
  await page.keyboard.press('p');
  await page.mouse.click(origin.x, origin.y);
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.overlayModel()?.pen?.points.length ?? 0)).toBe(1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await lines()).toHaveLength(0);

  // Tres clics y Enter: una línea de 3 puntos sin puntas, seleccionada.
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.click(origin.x + 120, origin.y + 40);
  await page.mouse.click(origin.x + 240, origin.y);
  await expect(page.getByTestId('pen-finish')).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await lines()).length).toBe(1);
  const line = (await lines())[0]! as PathNode & { startCap?: string; endCap?: string };
  expect(line.points).toHaveLength(3);
  expect(line).toMatchObject({ startCap: 'none', endCap: 'none' });
  await expect.poll(() => page.evaluate(() => [...window.__parcifyTest!.selection()])).toEqual([line.id]);

  // Con Shift, el segundo punto queda a 45° del primero.
  await canvas.focus();
  await page.keyboard.press('p');
  const start = { x: origin.x, y: origin.y + 100 };
  await page.mouse.click(start.x, start.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(start.x + 100, start.y + 80);
  await page.keyboard.up('Shift');
  await page.mouse.dblclick(start.x + 220, start.y + 40);
  await expect.poll(async () => (await lines()).length).toBe(2);
  const snapped = (await lines()).find((node) => node.id !== line.id)!;
  const [p0, p1] = snapped.points! as [number[], number[]];
  const angle = (Math.atan2(p1[1]! - p0[1]!, p1[0]! - p0[0]!) * 180) / Math.PI;
  expect(Math.abs(angle - 45)).toBeLessThan(0.01);
});
