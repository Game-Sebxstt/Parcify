import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { canvasGap } from './helpers/canvas.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';
import { doubleTap, pinch, twoFingerPan } from './helpers/touch.ts';

type Node = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  autoWidth?: boolean;
  fixedHeight?: boolean;
  fontSize?: number;
  fontWeight?: number;
};

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const texts = (page: Page) => page.evaluate(() => window.__parcifyTest!.texts());
const editing = (page: Page) => page.evaluate(() => window.__parcifyTest!.editing());
const toPage = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__parcifyTest!.toPage(px!, py!), [x, y]);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

test('dos personas editan el mismo texto a la vez y cada una ve el caret de la otra', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const label = `text-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Texto');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Texto');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Textos compartidos');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await setOrgAccess(page.request, projectId, 'none');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Ana crea un texto con la herramienta T y escribe.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Texto (T)' }).click();
  await page.mouse.click(box.x + box.width / 2 - 100, box.y + box.height / 2 - 40);
  const anaEditor = page.getByRole('textbox', { name: 'Texto', exact: true });
  await expect(anaEditor).toBeFocused();
  await page.keyboard.type('Hola mundo');
  await expect.poll(async () => Object.values(await texts(bea))).toEqual(['Hola mundo']);
  const node = (await nodes(page)).find((n) => n.type === 'text')!;

  // Bea abre el mismo texto con doble clic y pone el caret al principio.
  // En el centro: cerca de los bordes, el segundo clic cae en un handle de la selección.
  const at = await toPage(bea, node.x + node.w / 2, node.y + node.h / 2);
  await bea.mouse.dblclick(at.x, at.y);
  await expect.poll(() => editing(bea)).toBe(node.id);
  const beaEditor = bea.getByRole('textbox', { name: 'Texto', exact: true });
  await expect(beaEditor).toBeFocused();
  await bea.keyboard.press('Control+Home');

  // Los dos escriben a la vez: Ana al final, Bea al principio.
  await Promise.all([page.keyboard.type('!!'), bea.keyboard.type('>> ')]);
  await expect.poll(async () => (await texts(page))[node.id]).toBe('>> Hola mundo!!');
  await expect.poll(async () => (await texts(bea))[node.id]).toBe('>> Hola mundo!!');
  await expect(anaEditor).toHaveText('>> Hola mundo!!');
  await expect(beaEditor).toHaveText('>> Hola mundo!!');

  // Cada caret siguió en su sitio: una letra más entra justo tras lo que escribió cada uno.
  await page.keyboard.type('A');
  await bea.keyboard.type('B');
  await expect.poll(async () => (await texts(page))[node.id]).toBe('>> BHola mundo!!A');

  // Cada uno ve el caret remoto del otro con su nombre.
  await expect(page.locator('[data-remote-caret]')).toHaveText('Bea Texto');
  await expect(bea.locator('[data-remote-caret]')).toHaveText('Ana Texto');

  // Un contenido con marcado se pinta como texto.
  await bea.keyboard.type('<img src=x onerror=alert(1)>');
  await expect(anaEditor).toContainText('<img src=x onerror=alert(1)>');
  expect(await anaEditor.locator('img').count()).toBe(0);

  // Escape confirma; el texto sigue en el documento.
  await page.keyboard.press('Escape');
  await expect.poll(() => editing(page)).toBeNull();
  expect((await nodes(page)).some((n) => n.id === node.id)).toBe(true);

  await otherContext.close();
});

test('un texto vacío se borra al salir', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `text-empty-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  await canvas.focus();
  await page.keyboard.press('t');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodes(page)).length).toBe(0);
});

const textNodes = async (page: Page) => (await nodes(page)).filter((n) => n.type === 'text');
const editorBox = (page: Page) => page.getByRole('textbox', { name: 'Texto', exact: true });
// Píxeles de pantalla por unidad de la página.
const zoomOf = async (page: Page) => {
  const [a, b] = await Promise.all([toPage(page, 0, 0), toPage(page, 100, 0)]);
  return (b.x - a.x) / 100;
};

async function openNew(page: Page, label: string) {
  const account = await createVerifiedAccount(page.request, `${label}-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  await openEditor(page, projectId);
  const gap = await canvasGap(page);
  return { canvas: page.getByRole('application', { name: 'Lienzo del proyecto' }), center: { x: gap.x + gap.width / 2, y: gap.y + gap.height / 2 } };
}

test('T: un clic crea auto-ancho y un arrastre de 200 px, ancho fijo con w = 200/zoom (CA-4.1)', async ({ page }) => {
  const { canvas, center } = await openNew(page, 'text-create');
  await canvas.focus();
  await page.keyboard.press('t');
  await page.mouse.click(center.x - 200, center.y - 80);
  await expect(editorBox(page)).toBeFocused();
  await page.keyboard.type('Clic');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await textNodes(page)).length).toBe(1);
  expect((await textNodes(page))[0]!.autoWidth).toBe(true);

  await canvas.focus();
  await page.keyboard.press('t');
  const from = { x: center.x - 200, y: center.y + 20 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 100, from.y + 20, { steps: 4 });
  await page.mouse.move(from.x + 200, from.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect(editorBox(page)).toBeFocused();
  await page.keyboard.type('Arrastre');
  const fixedNode = async () => (await textNodes(page)).find((n) => n.autoWidth === false)!;
  await expect.poll(async () => (await fixedNode())?.h ?? 0).toBeGreaterThan(0);
  const oneLine = (await fixedNode()).h;
  // Con ancho fijo, Enter al final suma una línea a la caja antes de escribir nada en ella.
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await fixedNode()).h).toBeGreaterThan(oneLine * 1.6);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await textNodes(page)).length).toBe(2);
  const fixed = await fixedNode();
  expect(fixed.w).toBeCloseTo(200 / (await zoomOf(page)), 0);

  // Un arrastre que pasa el umbral pero deja menos de 24 px de ancho crea un texto auto-ancho.
  await canvas.focus();
  await page.keyboard.press('t');
  const narrow = { x: center.x + 120, y: center.y - 80 };
  await page.mouse.move(narrow.x, narrow.y);
  await page.mouse.down();
  await page.mouse.move(narrow.x + 8, narrow.y + 20, { steps: 4 });
  await page.mouse.move(narrow.x + 15, narrow.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect(editorBox(page)).toBeFocused();
  await page.keyboard.type('Estrecho');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await textNodes(page)).length).toBe(3);
  expect((await textNodes(page)).filter((n) => n.autoWidth === true)).toHaveLength(2);
});

test('doble clic en vacío crea un texto y Esc sin escribir no lo deja; entrar y salir no cambia la caja (CA-4.6, CA-4.8)', async ({ page }) => {
  const { center } = await openNew(page, 'text-dblclick');
  await page.mouse.dblclick(center.x, center.y);
  await expect.poll(() => editing(page)).not.toBeNull();
  await expect(editorBox(page)).toBeFocused();
  await expect.poll(async () => (await textNodes(page)).length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodes(page)).length).toBe(0);

  await page.mouse.dblclick(center.x - 100, center.y);
  await expect(editorBox(page)).toBeFocused();
  await page.keyboard.type('Una línea\ny otra');
  await page.keyboard.press('Escape');
  await expect.poll(() => editing(page)).toBeNull();
  const [before] = await textNodes(page);
  // Esc deja el texto seleccionado.
  expect(await page.evaluate(() => window.__parcifyTest!.selection())).toEqual([before!.id]);
  const at = await toPage(page, before!.x + before!.w / 2, before!.y + before!.h / 2);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(() => editing(page)).toBe(before!.id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await expect.poll(() => editing(page)).toBeNull();
  const [after] = await textNodes(page);
  expect({ w: after!.w, h: after!.h }).toEqual({ w: before!.w, h: before!.h });
});

test('cambiar el tamaño de 16 a 32 en el panel mide w y h en un solo paso; Ctrl+B alterna el peso al escribir (CA-4.5)', async ({ page }) => {
  const { canvas, center } = await openNew(page, 'text-style');
  await canvas.focus();
  await page.keyboard.press('t');
  await page.mouse.click(center.x - 150, center.y - 40);
  await expect(editorBox(page)).toBeFocused();
  await page.keyboard.type('Hola mundo');
  // Ctrl+B durante la edición: el peso pasa a 700 y vuelve a 400, y la edición sigue abierta.
  await page.keyboard.press('Control+b');
  await expect.poll(async () => (await textNodes(page))[0]!.fontWeight).toBe(700);
  await expect(editorBox(page)).toBeFocused();
  await page.keyboard.press('Control+b');
  await expect.poll(async () => (await textNodes(page))[0]!.fontWeight).toBe(400);
  await page.keyboard.press('Escape');
  await expect.poll(() => editing(page)).toBeNull();

  const size = page.getByTestId('properties-panel').getByTestId('props-font-size');
  await size.fill('16');
  await size.press('Enter');
  await expect.poll(async () => (await textNodes(page))[0]!.fontSize).toBe(16);
  const small = (await textNodes(page))[0]!;
  await size.fill('32');
  await size.press('Enter');
  await expect.poll(async () => (await textNodes(page))[0]!.fontSize).toBe(32);
  const big = (await textNodes(page))[0]!;
  expect(big.w / small.w).toBeGreaterThan(1.8);
  expect(big.w / small.w).toBeLessThan(2.2);
  expect(big.h / small.h).toBeGreaterThan(1.8);
  expect(big.h / small.h).toBeLessThan(2.2);
  // Un solo paso de deshacer devuelve el tamaño y la caja a la vez.
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await textNodes(page))[0]!.fontSize).toBe(16);
  const undone = (await textNodes(page))[0]!;
  expect({ w: undone.w, h: undone.h }).toEqual({ w: small.w, h: small.h });
});

test('doble clic en el hueco de una selección múltiple: el primer clic la vacía y el segundo crea un texto (CA-4.9)', async ({ page }) => {
  const { canvas, center } = await openNew(page, 'text-gap');
  for (const dx of [-220, 100]) {
    await canvas.focus();
    await page.keyboard.press('r');
    await page.mouse.move(center.x + dx, center.y - 60);
    await page.mouse.down();
    await page.mouse.move(center.x + dx + 60, center.y - 20, { steps: 4 });
    await page.mouse.move(center.x + dx + 120, center.y + 20, { steps: 4 });
    await page.mouse.up();
  }
  await expect.poll(async () => (await nodes(page)).length).toBe(2);
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await page.evaluate(() => window.__parcifyTest!.selection())).length).toBe(2);
  const hole = { x: center.x - 40, y: center.y - 20 };
  await page.mouse.click(hole.x, hole.y);
  await expect.poll(async () => (await page.evaluate(() => window.__parcifyTest!.selection())).length).toBe(0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await canvas.focus();
  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await page.evaluate(() => window.__parcifyTest!.selection())).length).toBe(2);
  await page.mouse.dblclick(hole.x, hole.y);
  await expect.poll(async () => (await textNodes(page)).length).toBe(1);
  await expect(editorBox(page)).toBeFocused();
});

test('móvil @touch: abrir la edición enfoca el texto; dos dedos no la cierran y un toque fuera sí (CA-4.7, CA-4.10)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Solo en el proyecto mobile');
  const { center } = await openNew(page, 'text-touch');
  await doubleTap(page, { x: center.x - 80, y: center.y - 60 });
  await expect.poll(() => editing(page)).not.toBeNull();
  await expect(editorBox(page)).toBeFocused();
  await page.keyboard.type('Hola');
  await expect.poll(async () => Object.values(await texts(page))).toEqual(['Hola']);

  await pinch(page, { x: center.x, y: center.y + 80 }, 80, 200);
  await page.waitForTimeout(150);
  await expect.poll(() => editing(page)).not.toBeNull();
  await expect(editorBox(page)).toBeFocused();
  await twoFingerPan(page, { x: center.x, y: center.y + 80 }, { x: 40, y: 30 });
  await page.waitForTimeout(150);
  await expect(editorBox(page)).toBeFocused();

  const editor = (await editorBox(page).boundingBox())!;
  await page.touchscreen.tap(center.x + 60, editor.y + editor.height + 160);
  await expect.poll(() => editing(page)).toBeNull();
  await expect(editorBox(page)).toHaveCount(0);
});

// Texto auto-ancho seleccionado, creado con la T en `at`, con este contenido y este tamaño de fuente.
async function selectedText(page: Page, at: { x: number; y: number }, content: string, fontSize: number) {
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  await canvas.focus();
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await expect(editorBox(page)).toBeFocused();
  await page.keyboard.type(content);
  await page.keyboard.press('Escape');
  await expect.poll(() => editing(page)).toBeNull();
  const size = page.getByTestId('properties-panel').getByTestId('props-font-size');
  await size.fill(String(fontSize));
  await size.press('Enter');
  await expect.poll(async () => (await textNodes(page))[0]?.fontSize).toBe(fontSize);
  return (await textNodes(page))[0]!;
}

async function dragFrom(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

test('tirador E: el auto-ancho pasa a auto-alto con w medido en la página y el texto se reparte en líneas (CA-4.2)', async ({ page }) => {
  const { center } = await openNew(page, 'text-resize-e');
  const start = await selectedText(page, { x: center.x - 250, y: center.y - 60 }, 'Hola mundo, esto es un texto largo', 32);
  expect(start.autoWidth).toBe(true);
  const zoom = await zoomOf(page);
  const e = await toPage(page, start.x + start.w, start.y + start.h / 2);
  await dragFrom(page, e, 100, 0);
  await expect.poll(async () => (await textNodes(page))[0]!.autoWidth).toBe(false);
  const wider = (await textNodes(page))[0]!;
  expect(wider.w - start.w).toBeCloseTo(100 / zoom, 0);
  expect(wider.h).toBe(start.h);
  expect(wider.fontSize).toBe(32);
  // Más estrecho que el contenido: el alto pasa a ser el de varias líneas.
  const e2 = await toPage(page, wider.x + wider.w, wider.y + wider.h / 2);
  await dragFrom(page, e2, -(wider.w * zoom) / 2, 0);
  await expect.poll(async () => (await textNodes(page))[0]!.h).toBeGreaterThan(start.h * 1.6);
  expect((await textNodes(page))[0]!.fixedHeight).toBeFalsy();
});

// Una línea de 24 px mide 30 de alto: al 80 % se queda en 24 en pantalla, y una de 16 px en 20 al 100 %.
for (const { fontSize, zoomOut } of [
  { fontSize: 24, zoomOut: false },
  { fontSize: 24, zoomOut: true },
  { fontSize: 16, zoomOut: false },
]) {
  const percent = zoomOut ? 80 : 100;
  test(`tirador E en un texto de una línea de ${fontSize} px al ${percent} % (CA-4.2)`, async ({ page }) => {
    const { canvas, center } = await openNew(page, `text-resize-e-${fontSize}-${percent}`);
    await canvas.focus();
    await page.keyboard.press('Control+Digit0');
    if (zoomOut) await page.keyboard.press('Control+Minus');
    await expect.poll(() => zoomOf(page)).toBeCloseTo(percent / 100, 2);
    const start = await selectedText(page, { x: center.x - 250, y: center.y - 60 }, 'Hola mundo', fontSize);
    expect(start.autoWidth).toBe(true);
    const zoom = await zoomOf(page);
    if (zoomOut || fontSize < 24) expect(start.h * zoom).toBeLessThan(28);
    const e = await toPage(page, start.x + start.w, start.y + start.h / 2);
    await dragFrom(page, e, 80, 0);
    await expect.poll(async () => (await textNodes(page))[0]!.autoWidth).toBe(false);
    const wider = (await textNodes(page))[0]!;
    expect(wider.w - start.w).toBeCloseTo(80 / zoom, 0);
    expect(wider.h).toBe(start.h);
    expect(wider.x).toBeCloseTo(start.x, 0);
    expect(wider.fontSize).toBe(fontSize);
  });
}

test('esquina SE al doble: fontSize 16 → 32 (CA-4.3)', async ({ page }) => {
  const { center } = await openNew(page, 'text-resize-corner');
  const start = await selectedText(page, { x: center.x - 200, y: center.y - 60 }, 'Escala', 16);
  const nw = await toPage(page, start.x, start.y);
  const se = await toPage(page, start.x + start.w, start.y + start.h);
  await dragFrom(page, se, se.x - nw.x, se.y - nw.y);
  await expect.poll(async () => (await textNodes(page))[0]!.fontSize).toBe(32);
  const scaled = (await textNodes(page))[0]!;
  expect(scaled.autoWidth).toBe(true);
  expect(scaled.x).toBeCloseTo(start.x, 0);
  expect(scaled.y).toBeCloseTo(start.y, 0);
  expect(scaled.w / start.w).toBeGreaterThan(1.8);
});

test('tirador S: deja fixedHeight y escribir después no cambia h; el panel cambia de modo (CA-4.4)', async ({ page }) => {
  const { center } = await openNew(page, 'text-resize-s');
  const start = await selectedText(page, { x: center.x - 200, y: center.y - 60 }, 'Alto fijo', 32);
  const s = await toPage(page, start.x + start.w / 2, start.y + start.h);
  await dragFrom(page, s, 0, 60);
  await expect.poll(async () => (await textNodes(page))[0]!.fixedHeight).toBe(true);
  const fixed = (await textNodes(page))[0]!;
  expect(fixed.autoWidth).toBe(false);
  expect(fixed.h).toBeGreaterThan(start.h);
  const mode = page.getByTestId('properties-panel').getByTestId('props-text-mode');
  await expect(mode.getByRole('radio', { name: 'Fijo' })).toHaveAttribute('aria-checked', 'true');

  const at = await toPage(page, fixed.x + fixed.w / 2, fixed.y + 10);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(() => editing(page)).toBe(fixed.id);
  await page.keyboard.press('End');
  await page.keyboard.type(' con mucho más texto\nen otra línea\ny otra más');
  await page.keyboard.press('Escape');
  await expect.poll(() => editing(page)).toBeNull();
  expect((await textNodes(page))[0]!.h).toBe(fixed.h);

  await mode.getByRole('radio', { name: 'Auto-ancho' }).click();
  await expect.poll(async () => (await textNodes(page))[0]!.autoWidth).toBe(true);
  const auto = (await textNodes(page))[0]!;
  expect(auto.fixedHeight).toBeFalsy();
  expect(auto.h).toBeGreaterThan(fixed.h);
});
