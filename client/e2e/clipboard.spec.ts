import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { solidPng } from './helpers/image.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; assetId?: string };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
const texts = (page: Page) => page.evaluate(() => window.__parcifyTest!.texts());
const images = (page: Page) => page.evaluate(() => window.__parcifyTest!.images());
const toPage = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__parcifyTest!.toPage(px!, py!), [x, y]);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

// Playwright solo concede los permisos del portapapeles en Chromium.
async function allowClipboard(context: BrowserContext) {
  if (test.info().project.name === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
}

// Firefox ignora clipboardData al construir un ClipboardEvent: ahí se copia desde un textarea y se pega con Ctrl+V.
async function paste(page: Page, data: Record<string, string>) {
  const dispatched = await page.evaluate((entries) => {
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(entries)) transfer.setData(type, value);
    const target = document.activeElement!;
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
    if (!event.clipboardData?.types.length) return false;
    target.dispatchEvent(event);
    return true;
  }, data);
  if (dispatched) return;
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  await page.evaluate((entries) => {
    const area = document.createElement('textarea');
    area.value = 'x';
    area.dataset.clipboardSource = '';
    area.addEventListener(
      'copy',
      (event) => {
        for (const [type, value] of Object.entries(entries)) event.clipboardData!.setData(type, value);
        event.preventDefault();
      },
      { once: true },
    );
    document.body.append(area);
    area.focus();
    area.select();
  }, data);
  await page.keyboard.press('ControlOrMeta+c');
  await page.locator('textarea[data-clipboard-source]').evaluate((area) => area.remove());
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+v');
}

test('copiar y pegar entre proyectos de espacios distintos conserva las imágenes', async ({ page, browser, context }) => {
  test.setTimeout(150_000);
  await allowClipboard(context);
  const label = `clip-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Portapapeles');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Portapapeles');
  // Ana edita un proyecto del espacio de Bea; Bea no ve el proyecto de origen.
  await joinWorkspace(bea.request, beaAccount.workspaceSlug, page.request, ana.email);
  const source = await createProject(page.request, ana.workspaceSlug, 'Origen');
  const target = await createProject(bea.request, beaAccount.workspaceSlug, 'Destino');
  await setProjectMember(bea.request, target, ana.userId, 'editor');

  await openEditor(page, source);
  await page.getByTestId('image-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: solidPng(120, [40, 120, 200]) });
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'image').length, { timeout: 30_000 }).toBe(1);
  const original = (await nodes(page)).find((node) => node.type === 'image')!;
  await expect.poll(async () => (await images(page))[original.id], { timeout: 30_000 }).toBe('ready');

  const center = await toPage(page, original.x + original.w / 2, original.y + original.h / 2);
  await page.mouse.click(center.x, center.y);
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection())).toEqual([original.id]);
  await page.keyboard.press('Control+c');

  await openEditor(page, target);
  await page.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'image').length, { timeout: 30_000 }).toBe(1);
  const pasted = (await nodes(page)).find((node) => node.type === 'image')!;
  expect(pasted.id).not.toBe(original.id);
  expect(pasted.assetId).not.toBe(original.assetId);
  expect(pasted).toMatchObject({ w: original.w, h: original.h });
  await expect.poll(async () => (await images(page))[pasted.id], { timeout: 30_000 }).toBe('ready');

  // Bea no puede leer el asset de origen: si lo ve, es porque se copió a su espacio.
  await openEditor(bea, target);
  await expect.poll(async () => (await images(bea))[pasted.id], { timeout: 30_000 }).toBe('ready');

  await otherContext.close();
});

test('pegar en otro proyecto del mismo espacio copia las imágenes al destino', async ({ page, browser, context }) => {
  test.setTimeout(150_000);
  await allowClipboard(context);
  const label = `clip-same-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Proyectos');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Proyectos');
  // Bea es del espacio de Ana, pero solo ve el proyecto de destino.
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const source = await createProject(page.request, ana.workspaceSlug, 'Privado');
  const target = await createProject(page.request, ana.workspaceSlug, 'Compartido');
  await setOrgAccess(page.request, source, 'none');
  await setOrgAccess(page.request, target, 'viewer');

  await openEditor(page, source);
  await page.getByTestId('image-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: solidPng(120, [200, 80, 40]) });
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'image').length, { timeout: 30_000 }).toBe(1);
  const original = (await nodes(page)).find((node) => node.type === 'image')!;
  await expect.poll(async () => (await images(page))[original.id], { timeout: 30_000 }).toBe('ready');
  const center = await toPage(page, original.x + original.w / 2, original.y + original.h / 2);
  await page.mouse.click(center.x, center.y);
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection())).toEqual([original.id]);
  await page.keyboard.press('Control+c');

  await openEditor(page, target);
  await page.getByRole('application', { name: 'Lienzo del proyecto' }).focus();
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'image').length, { timeout: 30_000 }).toBe(1);
  const pasted = (await nodes(page)).find((node) => node.type === 'image')!;
  expect(pasted.assetId).not.toBe(original.assetId);
  await expect.poll(async () => (await images(page))[pasted.id], { timeout: 30_000 }).toBe('ready');

  await openEditor(bea, target);
  await expect.poll(async () => (await images(bea))[pasted.id], { timeout: 30_000 }).toBe('ready');

  await otherContext.close();
});

test('pegar HTML o texto malicioso crea texto plano y no mete nada en el DOM', async ({ page }) => {
  test.setTimeout(90_000);
  const ana = await createVerifiedAccount(page.request, `clip-xss-${test.info().project.name}`, 'Ana Segura');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Pegar seguro');
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  await canvas.focus();

  const payload = '<img src="x-pegado" onerror="window.__xss = 1">';
  await paste(page, { 'text/html': `<div>${payload}<script>window.__xss = 2</script></div>`, 'text/plain': payload });
  await expect.poll(async () => Object.values(await texts(page))).toEqual([payload]);

  // Un bloque de Parcify cuyo texto intenta cerrar el comentario.
  const json = await page.evaluate(() => {
    const id = 'n00000000000000000xss';
    const node = {
      id,
      type: 'text',
      pageId: 'p00000000000000000xss',
      parentId: null,
      index: 'a0',
      x: 0,
      y: 0,
      w: 200,
      h: 30,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      createdBy: 'x',
      fontFamily: 'Manrope',
      fontSize: 24,
      fontWeight: 400,
      italic: false,
      underline: false,
      strike: false,
      color: '#EEF2F6FF',
      align: 'left',
      lineHeight: 1.25,
      autoWidth: true,
    };
    return JSON.stringify({ v: 1, source: null, nodes: [node], texts: { [id]: '--><img src="x-bloque" onerror="window.__xss = 3">' } });
  });
  // Sin escapar, el «-->» del texto corta el bloque y el JSON queda roto: no se pega nada.
  await paste(page, { 'text/html': `<!--parcify:${json}-->` });
  // Escapado como lo escribe Parcify al copiar, el texto llega entero.
  const escaped = json.replace(/[<>&]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  await paste(page, { 'text/html': `<!--parcify:${escaped}-->` });
  await expect.poll(async () => Object.values(await texts(page)).length).toBe(2);
  expect(Object.values(await texts(page))).toContain('--><img src="x-bloque" onerror="window.__xss = 3">');

  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await page.locator('img[src^="x-"]').count()).toBe(0);
});

test('menú contextual: acciones sobre la selección, exportar y copiar como PNG', async ({ page }) => {
  test.setTimeout(90_000);
  const ana = await createVerifiedAccount(page.request, `clip-menu-${test.info().project.name}`, 'Ana Menú');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Menú contextual');
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await nodes(page)).length).toBe(1);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Acciones del lienzo' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Copiar como PNG/ })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(menu.getByRole('menuitem', { name: /Exportar selección/ })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(menu.getByRole('menuitem', { name: /Animar/ })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(menu.getByRole('menuitem', { name: /^Cortar/ })).toBeFocused();
  await menu.getByRole('menuitem', { name: /^Duplicar/ }).click();
  await expect(menu).toBeHidden();
  await expect.poll(async () => (await nodes(page)).length).toBe(2);

  // Con el teclado: Shift+F10 abre el menú sobre la selección, Escape lo cierra y devuelve el foco al lienzo.
  await canvas.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(canvas).toBeFocused();
  await expect.poll(async () => (await page.evaluate(() => window.__parcifyTest!.selection())).length).toBe(1);
});
