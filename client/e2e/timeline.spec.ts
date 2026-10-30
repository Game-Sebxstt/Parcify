import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';

type Node = { id: string; x: number; y: number };
type Keyframe = { t: number; v: number | string };
type Animation = { duration: number; delay: number; loop: number; tracks: Partial<Record<string, Record<string, Keyframe>>> };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const animation = (page: Page, id: string) =>
  page.evaluate((nodeId) => (window.__parcifyTest!.animations() as unknown as Record<string, Animation>)[nodeId] ?? null, id);
const offsetX = async (page: Page, id: string) =>
  Object.values((await animation(page, id))?.tracks.offsetX ?? {})
    .map((kf) => ({ t: kf.t, v: kf.v }))
    .sort((a, b) => a.t - b.t);

// Solo el panel de la línea de tiempo (y el editor de keyframes, que vive dentro).
async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .include('[data-testid="timeline"]')
    .analyze();
  return results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.html.slice(0, 200)).slice(0, 5) }));
}

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('timeline: dos keyframes con el teclado, reproducir hasta el final, sincronizar y deshacer por usuario', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const label = `timeline-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Anima');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Anima');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Cartel animado');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await setOrgAccess(page.request, projectId, 'none');
  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  // Un rectángulo, seleccionado con el teclado.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 100, y: box.y + box.height / 2 - 80 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const rect = (await nodes(page))[0]!;
  await canvas.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection())).toEqual([rect.id]);

  // «Animar…» desde el menú contextual abre el panel con el foco en la fila del nodo.
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Acciones del lienzo' });
  await menu.getByRole('menuitem', { name: /Animar/ }).press('Enter');
  const panel = page.getByTestId('timeline');
  const grid = panel.getByRole('grid', { name: 'Línea de tiempo' });
  await expect(grid.getByRole('rowheader', { name: /fotogramas clave: 0/ })).toBeFocused();
  expect(await audit(page)).toEqual([]);

  // Solo se ven las pistas con datos: el menú de la fila añade una, con un keyframe en el cabezal (0 s).
  await page.keyboard.press('Tab');
  await expect(grid.getByRole('button', { name: /^Más acciones de/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Añadir pista' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Desplazamiento X' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(grid.getByRole('gridcell', { name: /Desplazamiento X, fotograma clave en 0,00 s/ })).toBeFocused();

  // El cabezal al final (1 s), de vuelta a la rejilla y otro keyframe.
  const head = panel.getByRole('slider', { name: 'Cabezal' });
  await head.focus();
  await page.keyboard.press('End');
  await expect(head).toHaveAttribute('aria-valuenow', '1000');
  await page.keyboard.press('Tab');
  await expect(grid.getByRole('gridcell', { name: /en 0,00 s/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(grid.getByRole('rowheader', { name: 'Desplazamiento X' })).toBeFocused();
  await page.keyboard.press('Enter');
  const keyframes = grid.getByRole('gridcell', { name: /^Desplazamiento X, fotograma clave/ });
  const first = keyframes.nth(0);
  const last = keyframes.nth(1);
  await expect(grid.getByRole('gridcell', { name: /Desplazamiento X, fotograma clave en 1,00 s/ })).toBeFocused();

  // Enter lo edita: valor 100 px y guardar con Enter.
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Fotograma clave de Desplazamiento X' });
  await expect(editor.getByRole('spinbutton', { name: 'Tiempo (ms)' })).toBeFocused();
  expect(await audit(page)).toEqual([]);
  // El editor de keyframes tampoco usa controles nativos (CA-3.3).
  expect(await editor.evaluate((root) => root.querySelectorAll('select, input[type=number], input[type=color], input[type=range]').length)).toBe(0);
  await editor.getByRole('spinbutton', { name: 'Valor (px)' }).fill('100');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(grid.getByRole('gridcell', { name: /en 1,00 s, valor 100 px/ })).toBeFocused();
  const expected = [
    { t: 0, v: 0 },
    { t: 1, v: 100 },
  ];
  await expect.poll(() => offsetX(page, rect.id)).toEqual(expected);
  // Bea ve los dos keyframes.
  await expect.poll(() => offsetX(bea, rect.id)).toEqual(expected);

  // Con el cabezal al inicio, Espacio reproduce: la vista pasa por valores intermedios y llega a +100 px en el último
  // frame. Con la línea de tiempo abierta se queda en la pose del cabezal, que ha llegado al final.
  await head.focus();
  await page.keyboard.press('Home');
  await expect(head).toHaveAttribute('aria-valuenow', '0');
  await expect.poll(async () => (await page.evaluate((id) => window.__parcifyTest!.view(id), rect.id))?.x).toBeCloseTo(rect.x, 3);
  await page.evaluate((id) => {
    const samples: number[] = [];
    (window as unknown as { __samples: number[] }).__samples = samples;
    const sample = () => {
      const view = window.__parcifyTest!.view(id);
      if (view) samples.push(view.x);
      if (samples.length < 600) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, rect.id);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.player()?.status)).toBe('playing');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.player()), { timeout: 15_000 }).toMatchObject({ status: 'paused', time: 1000, duration: 1000 });
  await expect(head).toHaveAttribute('aria-valuenow', '1000');
  await expect.poll(async () => (await page.evaluate((id) => window.__parcifyTest!.view(id), rect.id))?.x).toBeCloseTo(rect.x + 100, 3);
  const samples = await page.evaluate(() => (window as unknown as { __samples: number[] }).__samples);
  expect(Math.max(...samples) - rect.x).toBeCloseTo(100, 1);
  expect(samples.some((x) => x - rect.x > 5 && x - rect.x < 95)).toBe(true);
  expect((await nodes(page)).find((node) => node.id === rect.id)!.x).toBeCloseTo(rect.x, 3);

  // Bea abre su línea de tiempo, selecciona el rectángulo desde su fila y cambia la duración a 2 s en la sección
  // Animación (la barra de rango tiene ahí su alternativa con el teclado).
  await bea.getByRole('button', { name: 'Animar', exact: true }).click();
  const beaPanel = bea.getByTestId('timeline');
  await beaPanel.getByRole('rowheader', { name: /fotogramas clave: 2/ }).click();
  await expect.poll(() => bea.evaluate(() => window.__parcifyTest!.selection())).toEqual([rect.id]);
  const beaDuration = bea.getByTestId('properties-panel').getByTestId('props-anim-duration');
  await beaDuration.fill('2');
  await beaDuration.press('Enter');
  await expect.poll(async () => (await animation(page, rect.id))?.duration).toBe(2000);

  // Alt+← mueve el último keyframe un 1 %; Ctrl+Z de Ana solo deshace su movimiento, no la duración de Bea.
  await last.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => offsetX(bea, rect.id)).toEqual([expected[0], { t: 0.99, v: 100 }]);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => offsetX(bea, rect.id)).toEqual(expected);
  expect((await animation(bea, rect.id))?.duration).toBe(2000);

  // Mayús+Tab fuera del editor lo cierra y la rejilla sigue respondiendo.
  await last.focus();
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toHaveCount(0);
  await last.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(first).toBeFocused();

  // Si Bea borra el keyframe que Ana está editando, el editor de Ana se cierra y la rejilla sigue respondiendo.
  await last.focus();
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  const beaLast = beaPanel.getByRole('gridcell', { name: /Desplazamiento X, fotograma clave en 2,00 s/ });
  await beaLast.focus();
  await bea.keyboard.press('Delete');
  await expect.poll(() => offsetX(page, rect.id)).toEqual([expected[0]]);
  await expect(editor).toHaveCount(0);
  await first.focus();
  await page.keyboard.press('Home');
  await expect(grid.getByRole('rowheader', { name: 'Desplazamiento X' })).toBeFocused();
  expect(await audit(page)).toEqual([]);

  await otherContext.close();
});

const track = async (page: Page, id: string, prop: string) =>
  Object.values((await animation(page, id))?.tracks[prop] ?? {})
    .map((kf) => ({ t: kf.t, v: kf.v }))
    .sort((a, b) => a.t - b.t);
const record = async (page: Page, id: string) => (await nodes(page)).find((node) => node.id === id) as unknown as Record<string, number>;

test('grabación: lo animado graba sin Grabar, Grabar graba todo y cerrar la línea de tiempo vuelve al diseño (CA-5.2, 5.3, 5.8 a 5.11, 5.16)', async ({ page }) => {
  test.setTimeout(120_000);
  const account = await createVerifiedAccount(page.request, `grabar-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug, 'Grabación');
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 120 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const rect = (await nodes(page))[0]!;
  const properties = page.getByTestId('properties-panel');
  const frame = page.getByTestId('recording-frame');

  // Línea de tiempo abierta con el botón de la barra: Grabar apagado y sin borde.
  await page.getByRole('button', { name: 'Animar', exact: true }).click();
  const panel = page.getByTestId('timeline');
  const head = panel.getByRole('slider', { name: 'Cabezal' });
  const moveHead = async (ms: number) => {
    await head.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < ms / 100; i++) await page.keyboard.press('Shift+ArrowRight');
    await expect(head).toHaveAttribute('aria-valuenow', String(ms));
  };
  await moveHead(500);
  await expect(frame).toHaveCount(0);

  // Sin pistas de posición, mover cambia el diseño (CA-5.11).
  await canvas.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection())).toEqual([rect.id]);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await record(page, rect.id)).x).toBeCloseTo(rect.x + 10, 3);
  expect(await animation(page, rect.id)).toBeNull();

  // Con una pista de opacidad y Grabar apagado, la opacidad del panel crea el keyframe en el cabezal y no cambia el
  // diseño (CA-5.10).
  await properties.getByTestId('props-opacity-key').click();
  await expect.poll(() => track(page, rect.id, 'opacity')).toEqual([{ t: 0.5, v: 1 }]);
  // La pista nueva aparece en la línea de tiempo (solo se ven las que tienen datos).
  await expect(panel.getByRole('grid', { name: 'Línea de tiempo' }).getByRole('rowheader', { name: 'Opacidad' })).toBeVisible();
  await moveHead(300);
  const opacity = properties.getByTestId('props-opacity');
  await opacity.fill('40');
  await opacity.press('Enter');
  await expect.poll(() => track(page, rect.id, 'opacity')).toEqual([
    { t: 0.3, v: 0.4 },
    { t: 0.5, v: 1 },
  ]);
  expect((await record(page, rect.id)).opacity).toBe(1);
  await expect(page.getByTestId('record-announcer')).toHaveText('Keyframe de Opacidad en 0,30 s');

  // K enciende Grabar: borde y píldora. Mover 100 px crea offsetX 0 → 100 en el cabezal, y volver a moverla en el
  // mismo instante actualiza ese keyframe (CA-5.2).
  await moveHead(500);
  await canvas.focus();
  await page.keyboard.press('k');
  await expect(frame).toBeVisible();
  await expect(frame).toContainText('Grabando · 0,50 s');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => track(page, rect.id, 'offsetX')).toEqual([
    { t: 0, v: 0 },
    { t: 0.5, v: 50 },
  ]);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => track(page, rect.id, 'offsetX')).toEqual([
    { t: 0, v: 0 },
    { t: 0.5, v: 100 },
  ]);
  expect((await record(page, rect.id)).x).toBeCloseTo(rect.x + 10, 3);

  // Ancho de 120 a 180 con Grabar: scaleX 1,5 en el cabezal y el centro 30 px más allá; el diseño sigue en 120 (CA-5.3).
  const width = properties.getByTestId('props-w');
  await width.fill('180');
  await width.press('Enter');
  await expect.poll(() => track(page, rect.id, 'scaleX')).toEqual([
    { t: 0, v: 1 },
    { t: 0.5, v: 1.5 },
  ]);
  await expect.poll(() => track(page, rect.id, 'offsetX')).toEqual([
    { t: 0, v: 0 },
    { t: 0.5, v: 130 },
  ]);
  expect((await record(page, rect.id)).w).toBe(120);

  // El radio no se anima: va al diseño y se avisa (CA-5.9).
  const radius = properties.getByTestId('props-radius');
  await radius.fill('8');
  await radius.press('Enter');
  await expect.poll(async () => (await record(page, rect.id)).cornerRadius).toBe(8);
  await expect(page.getByRole('status').filter({ hasText: 'El radio no se anima: se ha cambiado el diseño' })).toBeVisible();

  // Grabar apagado: X muestra lo que se ve en el cabezal (el diseño más 130 de desplazamiento, con la caja escalada
  // sobre su centro) y escribir otra X graba la diferencia (CA-5.16).
  await canvas.focus();
  await page.keyboard.press('k');
  await expect(frame).toHaveCount(0);
  const x = properties.getByTestId('props-x');
  const shown = rect.x + 10 + 130 - 30;
  await expect(x).toHaveValue(String(shown));
  await x.fill(String(shown + 50));
  await x.press('Enter');
  await expect.poll(() => track(page, rect.id, 'offsetX')).toEqual([
    { t: 0, v: 0 },
    { t: 0.5, v: 180 },
  ]);
  expect((await record(page, rect.id)).x).toBeCloseTo(rect.x + 10, 3);
  await expect(x).toHaveValue(String(shown + 50));

  // Cerrar la línea de tiempo con Grabar encendido apaga la grabación: mover cambia x aunque haya pista offsetX (CA-5.8).
  await canvas.focus();
  await page.keyboard.press('k');
  await expect(frame).toBeVisible();
  await panel.getByRole('button', { name: 'Ocultar la línea de tiempo' }).click();
  await expect(frame).toHaveCount(0);
  await canvas.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await record(page, rect.id)).x).toBeCloseTo(rect.x + 20, 3);
  expect(await track(page, rect.id, 'offsetX')).toEqual([
    { t: 0, v: 0 },
    { t: 0.5, v: 180 },
  ]);
});

test('grabación: con Grabar, el color de un texto va a su pista fill sin cambiar el diseño (CA-5.4)', async ({ page }) => {
  test.setTimeout(90_000);
  const account = await createVerifiedAccount(page.request, `grabar-texto-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug, 'Texto grabado');
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  await canvas.focus();
  await page.keyboard.press('t');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 120);
  await page.keyboard.type('Hola');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const text = (await nodes(page))[0]!;
  const color = (await record(page, text.id)).color as unknown as string;

  await page.getByRole('button', { name: 'Animar', exact: true }).click();
  const head = page.getByTestId('timeline').getByRole('slider', { name: 'Cabezal' });
  await head.focus();
  await page.keyboard.press('End');
  await canvas.focus();
  await page.keyboard.press('k');
  await expect(page.getByTestId('recording-frame')).toBeVisible();
  const hex = page.getByTestId('props-text-color-hex');
  await hex.fill('3366FF');
  await hex.press('Enter');
  await expect.poll(() => track(page, text.id, 'fill')).toEqual([
    { t: 0, v: color },
    { t: 1, v: '#3366FFFF' },
  ]);
  expect((await record(page, text.id)).color).toBe(color);
  // El lienzo pinta el color de la pista: el nuevo en el cabezal y el de partida en 0.
  const shown = async () => (await page.evaluate((id) => window.__parcifyTest!.view(id), text.id))?.color;
  await expect.poll(shown).toBe('#3366FFFF');
  await head.focus();
  await page.keyboard.press('Home');
  await expect.poll(shown).toBe(color);
});

test('biblioteca: la pestaña Animaciones reproduce sin abrir la línea de tiempo y «Animar con keyframes» graba (CA-5.1, CA-5.12)', async ({ page }) => {
  test.setTimeout(120_000);
  const account = await createVerifiedAccount(page.request, `biblioteca-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug, 'Biblioteca');
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 - 60 };
  const properties = page.getByTestId('properties-panel');
  const view = (id: string) => page.evaluate((nodeId) => window.__parcifyTest!.view(nodeId), id);
  const player = () => page.evaluate(() => window.__parcifyTest!.player());

  // Cuatro rectángulos; los tres primeros con «Aparecer» desde la sección Animación.
  const ids: string[] = [];
  for (const dx of [-280, -140, 0, 140]) {
    const before = new Set((await nodes(page)).map((node) => node.id));
    await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
    await drag(page, { x: center.x + dx, y: center.y }, { x: center.x + dx + 80, y: center.y + 60 });
    await expect.poll(async () => (await nodes(page)).length).toBe(before.size + 1);
    const id = (await nodes(page)).find((node) => !before.has(node.id))!.id;
    await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection())).toEqual([id]);
    ids.push(id);
    if (ids.length > 3) break;
    await properties.getByTestId('props-anim-presets').getByRole('button', { name: 'Aparecer' }).click();
    await expect.poll(async () => Object.keys((await animation(page, id))?.tracks.opacity ?? {}).length).toBe(2);
  }
  const [a, b, c, plain] = ids as [string, string, string, string];
  await expect.poll(async () => (await player())?.status, { timeout: 5000 }).toBe('stopped');

  // La duración de A pasa a 5 s desde la sección, para que la vista previa dure lo bastante.
  await page.mouse.click(center.x - 240, center.y + 30);
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection())).toEqual([a]);
  const duration = properties.getByTestId('props-anim-duration');
  await duration.fill('5');
  await duration.press('Enter');
  await expect.poll(async () => (await animation(page, a))?.duration).toBe(5000);

  // La pestaña lista las 3 animaciones de la página.
  const left = page.getByTestId('left-panel');
  await left.getByRole('tab', { name: 'Animaciones' }).click();
  const rows = left.getByTestId('animation-row');
  await expect(rows).toHaveCount(3);
  await expect(left.getByText('5 s')).toBeVisible();
  const rowOf = (id: string) => left.locator(`[data-testid="animation-row"][data-node-id="${id}"]`);

  // ▶ en la fila de B reproduce solo B y al terminar el lienzo vuelve al estado base (CA-5.1).
  await rowOf(b).getByRole('button', { name: /^Reproducir la animación de/ }).click();
  await expect.poll(async () => (await player())?.previewIds).toEqual([b]);
  await expect.poll(async () => (await view(b))?.opacity).toBeLessThan(1);
  expect((await view(a))?.opacity).toBe(1);
  expect((await view(c))?.opacity).toBe(1);
  await expect(rowOf(b)).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('timeline')).toHaveCount(0);
  await expect.poll(async () => (await player())?.status, { timeout: 5000 }).toBe('stopped');
  expect((await view(b))?.opacity).toBe(1);
  await expect(rowOf(b)).toHaveAttribute('data-playing', 'false');

  // Esc con el foco en el panel la detiene, y ■ también.
  const playA = rowOf(a).getByRole('button', { name: /^Reproducir la animación de/ });
  await playA.click();
  await expect.poll(async () => (await player())?.preview).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await player())?.preview).toBe(false);
  expect((await view(a))?.opacity).toBe(1);
  await playA.click();
  await expect(rowOf(a).getByRole('button', { name: /^Detener la animación de/ })).toBeVisible();
  await rowOf(a).getByRole('button', { name: /^Detener la animación de/ }).click();
  await expect.poll(async () => (await player())?.preview).toBe(false);

  // Un clic en el lienzo también la detiene.
  await left.getByRole('button', { name: 'Reproducir todas' }).click();
  await expect.poll(async () => [...((await player())?.previewIds ?? [])].sort()).toEqual([a, b, c].sort());
  await page.mouse.click(center.x, center.y + 200);
  await expect.poll(async () => (await player())?.preview).toBe(false);
  expect((await view(a))?.opacity).toBe(1);

  // «Animar con keyframes» en un rectángulo sin animación abre la línea de tiempo con Grabar y el borde (CA-5.12).
  await page.mouse.click(center.x + 180, center.y + 30);
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection())).toEqual([plain]);
  await properties.getByTestId('props-anim-keyframes').click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(page.getByTestId('recording-frame')).toBeVisible();
  await expect(page.getByTestId('timeline-record')).toHaveAttribute('aria-pressed', 'true');

  // Con la línea de tiempo abierta, el rombo de Opacidad añade y quita el keyframe en el cabezal.
  const key = properties.getByTestId('props-opacity-key');
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await key.click();
  await expect.poll(async () => Object.keys((await animation(page, plain))?.tracks.opacity ?? {}).length).toBe(1);
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await key.click();
  await expect.poll(async () => Object.keys((await animation(page, plain))?.tracks.opacity ?? {}).length).toBe(0);
  await page.getByTestId('timeline').getByRole('button', { name: 'Ocultar la línea de tiempo' }).click();
  await expect(key).toHaveCount(0);
});

test('línea de tiempo: zoom y pan del tiempo con la rueda, barra de rango, alto y sin controles nativos (RF-5.6)', async ({ page }) => {
  test.setTimeout(90_000);
  const account = await createVerifiedAccount(page.request, `tiempo-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug, 'Zoom del tiempo');
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 120 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const rect = (await nodes(page))[0]!;
  const properties = page.getByTestId('properties-panel');
  await properties.getByTestId('props-anim-presets').getByRole('button', { name: 'Aparecer' }).click();
  await expect.poll(async () => (await animation(page, rect.id))?.duration).toBe(400);

  await page.getByRole('button', { name: 'Animar', exact: true }).click();
  const panel = page.getByTestId('timeline');
  const tracks = panel.getByTestId('timeline-tracks');
  const diamonds = panel.getByTestId('keyframe');
  await expect(diamonds).toHaveCount(2);
  const centerX = async (index: number) => {
    const rect = (await diamonds.nth(index).boundingBox())!;
    return rect.x + rect.width / 2;
  };
  // Solo la pista con datos: Opacidad, sin Desplazamiento X ni las demás.
  await expect(panel.getByRole('rowheader')).toHaveCount(2);

  // Sin controles nativos ni `title` en botones (CA-3.3).
  const natives = () =>
    page.evaluate(() => {
      const root = document.querySelector('[data-testid="timeline"]')!;
      const selector = 'select, input[type=checkbox], input[type=radio], input[type=range], input[type=color], input[type=number]';
      return [...root.querySelectorAll(selector), ...root.querySelectorAll('button[title]')].map((element) => element.outerHTML.slice(0, 120));
    });
  expect(await natives()).toEqual([]);

  // Dispara un WheelEvent en el punto (x, y) de la ventana y devuelve si se anuló.
  const wheel = (x: number, y: number, init: { ctrlKey?: boolean; deltaX?: number; deltaY?: number }) =>
    tracks.evaluate(
      (element, { x, y, init }) => {
        const target = document.elementFromPoint(x, y) ?? element;
        const event = new WheelEvent('wheel', { ...init, clientX: x, clientY: y, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      },
      { x, y, init },
    );

  // Ctrl+rueda (pellizco del touchpad) sobre el segundo rombo: la escala crece y ese instante sigue bajo el puntero.
  const before = (await centerX(1)) - (await centerX(0));
  const anchor = await centerX(1);
  const row = (await diamonds.nth(1).boundingBox())!;
  for (let i = 0; i < 8; i++) expect(await wheel(anchor, row.y + row.height / 2, { ctrlKey: true, deltaY: -4 })).toBe(true);
  await expect.poll(async () => (await centerX(1)) - (await centerX(0))).toBeGreaterThan(before * 1.2);
  expect(Math.abs((await centerX(1)) - anchor)).toBeLessThan(3);

  // Más zoom para que el tiempo no quepa, y dos dedos en horizontal lo desplazan.
  for (let i = 0; i < 40; i++) await wheel(anchor, row.y + row.height / 2, { ctrlKey: true, deltaY: -10 });
  const scrollLeft = () => tracks.evaluate((element) => element.scrollLeft);
  const scrollBefore = await scrollLeft();
  expect(await wheel(anchor, row.y + row.height / 2, { deltaX: 20 })).toBe(true);
  await expect.poll(scrollLeft).toBeCloseTo(scrollBefore + 20, 0);
  // La rueda vertical sin modificadores no se intercepta: es el scroll nativo de las filas.
  expect(await wheel(anchor, row.y + row.height / 2, { deltaY: 20 })).toBe(false);

  // «Encajar el tiempo» vuelve a ver toda la duración.
  await panel.getByRole('button', { name: 'Encajar el tiempo' }).click();
  await expect.poll(scrollLeft).toBe(0);

  // Arrastrar la barra de rango entera cambia el retardo; su extremo derecho, la duración. Una escritura al soltar.
  const range = panel.getByTestId('timeline-range');
  const bar = (await range.boundingBox())!;
  await drag(page, { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 }, { x: bar.x + bar.width / 2 + 120, y: bar.y + bar.height / 2 });
  await expect.poll(async () => (await animation(page, rect.id))?.delay).toBeGreaterThan(0);
  const moved = (await animation(page, rect.id))!;
  expect(moved.duration).toBe(400);
  const end = (await panel.getByTestId('timeline-range-end').boundingBox())!;
  await drag(page, { x: end.x + end.width / 2, y: end.y + end.height / 2 }, { x: end.x + end.width / 2 + 80, y: end.y + end.height / 2 });
  await expect.poll(async () => (await animation(page, rect.id))?.duration).toBeGreaterThan(400);
  expect((await animation(page, rect.id))?.delay).toBe(moved.delay);
  // Los keyframes conservan su t: se mueven y se estiran con la barra.
  expect(Object.values((await animation(page, rect.id))!.tracks.opacity ?? {}).map((kf) => kf.t).sort()).toEqual([0, 1]);

  // El asa superior cambia el alto con las flechas y Esc no cierra la línea de tiempo.
  const resizer = panel.getByRole('separator', { name: 'Alto de la línea de tiempo' });
  const height = Number(await resizer.getAttribute('aria-valuenow'));
  await resizer.focus();
  await page.keyboard.press('ArrowUp');
  await expect(resizer).toHaveAttribute('aria-valuenow', String(height + 8));
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  expect(await natives()).toEqual([]);
});

// Instantes absolutos (ms) de los keyframes de una pista, de menor a mayor.
const times = async (page: Page, id: string, prop: string) => {
  const anim = await animation(page, id);
  return Object.values(anim?.tracks[prop] ?? {})
    // t se guarda con 4 decimales: en una iteración de 1,5 s, 500 ms se lee como 499,95.
    .map((kf) => Math.round(anim!.delay + kf.t * anim!.duration))
    .sort((a, b) => a - b);
};

test('keyframes: marquesina y Mayús+clic, arrastre en grupo, copiar y pegar, duplicar, estirar y curva (CA-5.5, 5.6, 5.15)', async ({ page }) => {
  test.setTimeout(120_000);
  const account = await createVerifiedAccount(page.request, `keyframes-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug, 'Keyframes en grupo');
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 120 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(async () => (await nodes(page)).length).toBe(1);
  const rect = (await nodes(page))[0]!;
  // «Deslizar»: Desplazamiento Y y Opacidad, cada una con keyframes en 0 y 500 ms.
  await page.getByTestId('properties-panel').getByTestId('props-anim-presets').getByRole('button', { name: 'Deslizar' }).click();
  await expect.poll(() => times(page, rect.id, 'offsetY')).toEqual([0, 500]);

  await page.getByRole('button', { name: 'Animar', exact: true }).click();
  const panel = page.getByTestId('timeline');
  const grid = panel.getByRole('grid', { name: 'Línea de tiempo' });
  const kf = (track: string, time: string) => grid.getByRole('gridcell', { name: new RegExp(`^${track}, fotograma clave en ${time}`) });
  const center = async (locator: Locator) => {
    const rect = (await locator.boundingBox())!;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const y0 = kf('Desplazamiento Y', '0,00 s');
  const y500 = kf('Desplazamiento Y', '0,50 s');
  const o0 = kf('Opacidad', '0,00 s');
  await expect(y0).toBeVisible();
  const zoom = ((await center(y500)).x - (await center(y0)).x) / 500;
  const selected = panel.locator('[data-testid="keyframe"][data-selected]');

  // Marquesina desde el vacío de Desplazamiento Y hasta el de Opacidad: los dos keyframes en 0. Mayús+clic suma el
  // de 500 ms de Desplazamiento Y.
  const a = await center(y0);
  const b = await center(o0);
  const rowOf = (cell: Locator) => cell.locator('xpath=ancestor::*[@role="row"][1]');
  const rowY = (await rowOf(y0).boundingBox())!;
  const rowO = (await rowOf(o0).boundingBox())!;
  await page.mouse.move(a.x + 24, rowY.y + 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, (rowY.y + rowO.y) / 2, { steps: 3 });
  await expect(panel.getByTestId('timeline-marquee')).toBeVisible();
  await page.mouse.move(b.x - 6, rowO.y + rowO.height - 2, { steps: 3 });
  await page.mouse.up();
  await expect(panel.getByTestId('timeline-marquee')).toHaveCount(0);
  await expect(selected).toHaveCount(2);
  await page.keyboard.down('Shift');
  await y500.click();
  await page.keyboard.up('Shift');
  await expect(selected).toHaveCount(3);
  await expect(grid).toHaveAttribute('aria-multiselectable', 'true');

  // Arrastrarlos 200 ms (Mayús tras apoyar, sin imán) los mueve juntos en un paso de deshacer (CA-5.5).
  const from = await center(y0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x + 100 * zoom, from.y, { steps: 4 });
  await page.mouse.move(from.x + 200 * zoom, from.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const tolerance = 1 / zoom + 0.5;
  await expect.poll(async () => (await times(page, rect.id, 'offsetY'))[0]!).toBeGreaterThan(150);
  const [movedY0, movedY1] = await times(page, rect.id, 'offsetY');
  const [movedO0, movedO1] = await times(page, rect.id, 'opacity');
  expect(Math.abs(movedY0! - 200)).toBeLessThan(tolerance);
  expect(Math.abs(movedY1! - 700)).toBeLessThan(tolerance);
  expect(Math.abs(movedO0! - 200)).toBeLessThan(tolerance);
  expect(movedO1).toBe(500);
  await page.keyboard.press('Control+z');
  await expect.poll(() => times(page, rect.id, 'offsetY')).toEqual([0, 500]);
  expect(await times(page, rect.id, 'opacity')).toEqual([0, 500]);

  // Ctrl+C sobre los 2 de Desplazamiento Y, el cabezal a 1 s y Ctrl+V: 2 keyframes nuevos con la misma separación
  // (CA-5.6). La selección pasa a las copias.
  await y0.click();
  await page.keyboard.down('Shift');
  await y500.click();
  await page.keyboard.up('Shift');
  await expect(selected).toHaveCount(2);
  await page.keyboard.press('Control+c');
  await expect(panel.getByTestId('timeline-announcement')).toHaveText('2 fotogramas clave copiados.');
  const time = panel.getByTestId('timeline-time-field');
  await time.fill('1');
  await time.press('Enter');
  await y0.focus();
  await page.keyboard.press('Control+v');
  await expect.poll(() => times(page, rect.id, 'offsetY')).toEqual([0, 500, 1000, 1500]);
  expect(await times(page, rect.id, 'opacity')).toEqual([0, 500]);
  expect((await nodes(page)).length).toBe(1);
  await expect(selected).toHaveCount(2);
  await expect(kf('Desplazamiento Y', '1,00 s')).toHaveAttribute('aria-selected', 'true');

  // Ctrl+D duplica la selección justo después: (1500 − 1000) + 100 ms más tarde.
  await kf('Desplazamiento Y', '1,00 s').focus();
  await page.keyboard.press('Control+d');
  await expect.poll(() => times(page, rect.id, 'offsetY')).toEqual([0, 500, 1000, 1500, 1600, 2100]);
  expect((await nodes(page)).length).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => times(page, rect.id, 'offsetY')).toEqual([0, 500, 1000, 1500]);

  // Con 3 keyframes en 0, 500 y 1000 ms, el asa derecha de la caja de estirado hasta 2000 ms los deja en 0, 1000 y
  // 2000 ms, en un paso de deshacer (CA-5.15). Antes, encajar y alejar para que quepan los 2 s.
  await panel.getByRole('button', { name: 'Encajar el tiempo' }).click();
  await panel.getByRole('button', { name: 'Alejar la línea de tiempo' }).click();
  await expect.poll(async () => (await center(y500)).x - (await center(y0)).x).toBeLessThan(500 * zoom * 0.9);
  const fitted = ((await center(y500)).x - (await center(y0)).x) / 500;
  await y0.click();
  await page.keyboard.down('Shift');
  await y500.click();
  await kf('Desplazamiento Y', '1,00 s').click();
  await page.keyboard.up('Shift');
  await expect(selected).toHaveCount(3);
  const handle = panel.getByTestId('timeline-stretch-end');
  await expect(handle).toBeVisible();
  const grip = await center(handle);
  const start = await center(y0);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x + 1500 * fitted, grip.y, { steps: 4 });
  await page.mouse.move(start.x + 2000 * fitted, grip.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await times(page, rect.id, 'offsetY')).at(-1)!).toBeGreaterThan(1900);
  const stretched = await times(page, rect.id, 'offsetY');
  expect(stretched).toHaveLength(4);
  const stretchTolerance = 2 / fitted + 0.5;
  expect(stretched[0]).toBe(0);
  expect(Math.abs(stretched[1]! - 1000)).toBeLessThan(stretchTolerance);
  expect(stretched[2]).toBe(1500);
  expect(Math.abs(stretched[3]! - 2000)).toBeLessThan(stretchTolerance);
  await page.keyboard.press('Control+z');
  await expect.poll(() => times(page, rect.id, 'offsetY')).toEqual([0, 500, 1000, 1500]);

  // Un clic en el tramo entre 0 y 0,5 s abre su curva; «Lineal» la cambia en el keyframe que lo empieza.
  const easingOf = async () => Object.values((await animation(page, rect.id))!.tracks.offsetY ?? {}).find((item) => item.t === 0) as { e?: unknown } | undefined;
  expect((await easingOf())?.e).toBe('easeOut');
  const segment = rowOf(y0).getByTestId('keyframe-segment').first();
  await segment.click({ force: true });
  const popover = page.getByRole('dialog', { name: 'Curva del tramo' });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('radio', { name: 'Salida suave', exact: true })).toHaveAttribute('aria-checked', 'true');
  await popover.getByRole('radio', { name: 'Lineal', exact: true }).click();
  await expect.poll(async () => (await easingOf())?.e).toBe('linear');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);

  // Clic derecho sobre un keyframe: el menú con las mismas acciones y la curva.
  await y500.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Acciones de los fotogramas clave' });
  await expect(menu).toBeVisible();
  for (const name of ['Editar valor…', 'Copiar', 'Pegar en el cabezal', 'Duplicar', 'Borrar', 'Estirar…', 'Curva']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Esc vacía la selección y, con ella vacía, devuelve el foco al lienzo.
  await y500.focus();
  await page.keyboard.press('Escape');
  await expect(selected).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(canvas).toBeFocused();
  expect(await audit(page)).toEqual([]);
});
