import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';

// WCAG 2.2 AA en lo que no es lienzo; el lienzo WebGL queda fuera porque axe no puede leerlo.
async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('canvas')
    .analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5),
  }));
}

test('axe sin violaciones en la landing y el overlay de acceso', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('landing-canvas')).toHaveClass(/is-ready/, { timeout: 20_000 });
  expect(await audit(page)).toEqual([]);

  await page.getByRole('navigation', { name: 'Acceso a tu cuenta' }).getByRole('link', { name: 'Entrar' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Entrar en Parcify' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

type Node = { id: string; type: string; x: number; y: number; w: number; h: number; parentId: string | null; name?: string; visible: boolean };

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('axe sin violaciones en el editor, y el lienzo y las capas se usan con el teclado', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const account = await createVerifiedAccount(page.request, `a11y-editor-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug, 'Cartel accesible');
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  const nodes = () => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
  const selection = () => page.evaluate(() => window.__parcifyTest!.selection());
  expect(await audit(page)).toEqual([]);

  // Dos rectángulos dibujados con la herramienta.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 200, y: box.y + box.height / 2 - 100 };
  for (const dx of [0, 220]) {
    await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
    await drag(page, { x: origin.x + dx, y: origin.y }, { x: origin.x + dx + 120, y: origin.y + 80 });
  }
  await expect.poll(async () => (await nodes()).length).toBe(2);
  const [first, second] = (await nodes()).sort((a, b) => a.x - b.x);

  // Con el foco en el lienzo, Tab recorre los nodos en orden z y la región en vivo anuncia la selección.
  await canvas.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect.poll(selection).toEqual([first!.id]);
  await expect(page.getByText('Rectángulo seleccionado, 120 por 80, en Página 1')).toBeAttached();
  const tree = page.getByRole('tree', { name: 'Capas' });
  await expect(tree.getByRole('treeitem', { selected: true })).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect.poll(selection).toEqual([second!.id]);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(selection).toEqual([first!.id]);
  // Las flechas mueven.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await nodes()).find((node) => node.id === first!.id)!.x).toBeCloseTo(first!.x + 1, 3);

  // Ctrl+A y Ctrl+G: el árbol muestra el grupo, sincronizado con la selección.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await expect.poll(async () => (await nodes()).filter((node) => node.type === 'group').length).toBe(1);
  const groupItem = tree.getByRole('treeitem', { name: 'Grupo' });
  await expect(groupItem).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/^Grupo seleccionado, \d+ por 80, en Página 1$/)).toBeAttached();

  // En el árbol: flecha derecha despliega, F2 renombra y H oculta.
  await groupItem.focus();
  await page.keyboard.press('ArrowRight');
  await expect(groupItem).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('treeitem')).toHaveCount(3);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('F2');
  const input = tree.getByRole('textbox', { name: 'Nombre de la capa' });
  await expect(input).toBeFocused();
  await input.fill('Logo');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await nodes()).filter((node) => node.name === 'Logo').length).toBe(1);
  const logo = tree.getByRole('treeitem', { name: 'Logo' });
  await expect(logo).toBeFocused();
  await page.keyboard.press('h');
  await expect(tree.getByRole('treeitem', { name: 'Logo, oculto' })).toBeVisible();
  expect((await nodes()).find((node) => node.name === 'Logo')!.visible).toBe(false);
  expect(await audit(page)).toEqual([]);

  // Páginas: añadir una y volver a la primera.
  await page.getByRole('button', { name: 'Añadir página' }).click();
  await expect(page.getByRole('button', { name: 'Página 2', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Esta página aún está vacía.')).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.getByRole('button', { name: 'Página 1', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'Grupo' })).toBeVisible();
});

test('axe sin violaciones en el inicio, el espacio y los ajustes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const account = await createVerifiedAccount(page.request, `a11y-${test.info().project.name}`);
  await createProject(page.request, account.workspaceSlug, 'Cartel accesible');

  await page.goto('/app');
  await expect(page.getByRole('list', { name: 'Recientes' }).getByRole('listitem')).toHaveCount(1);
  expect(await audit(page)).toEqual([]);

  await page.goto(`/app/e/${account.workspaceSlug}`);
  await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(1);
  expect(await audit(page)).toEqual([]);
  await page.getByRole('tab', { name: 'Miembros' }).click();
  await expect(page.getByRole('list', { name: 'Miembros' })).toBeVisible();
  expect(await audit(page)).toEqual([]);

  await page.goto('/app/ajustes');
  await expect(page.getByRole('region', { name: 'Sesiones activas' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Historial de seguridad' }).getByRole('listitem').first()).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
}

test('axe sin violaciones en los paneles del editor: IA, chat, versiones, timeline, compartir y exportar', async ({ page }) => {
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const account = await createVerifiedAccount(page.request, `a11y-panels-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug, 'Cartel accesible');
  await openEditor(page, projectId);

  // Un rectángulo seleccionado: el panel de propiedades y la timeline tienen contenido.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 40 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection().length)).toBe(1);
  expect(await audit(page)).toEqual([]);

  await page.getByTestId('ai-toggle').click();
  const ai = page.getByTestId('ai-panel');
  await expect(ai.getByTestId('ai-prompt')).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await ai.getByTestId('ai-prompt').fill('Añade un rectángulo naranja');
  await ai.getByTestId('ai-submit').click();
  await expect(ai.getByTestId('ai-preview')).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await ai.getByTestId('ai-discard').click();
  await ai.getByRole('tab', { name: 'Chat' }).click();
  await expect(ai.getByTestId('ai-chat-input')).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.getByTestId('ai-toggle').click();

  await page.getByTestId('chat-toggle').click();
  await expect(page.getByTestId('chat-panel').getByRole('combobox', { name: 'Mensaje' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.getByTestId('chat-toggle').click();

  await page.getByTestId('versions-toggle').click();
  await expect(page.getByTestId('versions-panel')).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.getByTestId('versions-toggle').click();

  await page.getByRole('button', { name: 'Mostrar la línea de tiempo' }).click();
  await expect(page.getByTestId('timeline').getByRole('grid', { name: 'Línea de tiempo' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.getByTestId('timeline').getByTestId('timeline-ai').click();
  await expect(page.getByTestId('ai-animate')).toBeVisible();
  expect(await audit(page)).toEqual([]);

  await page.getByTestId('share').click();
  const share = page.getByRole('dialog', { name: 'Compartir «Cartel accesible»' });
  await expect(share.getByTestId('share-person')).toHaveCount(1);
  expect(await audit(page)).toEqual([]);
  await share.getByRole('button', { name: 'Crear enlace' }).click();
  await expect(share.getByTestId('share-link-url')).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await share.getByRole('button', { name: 'Cerrar' }).click();

  // Exportar desde el menú contextual, con el rectángulo aún seleccionado.
  await canvas.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menu', { name: 'Acciones del lienzo' }).getByRole('menuitem', { name: 'Exportar selección' }).click();
  await expect(page.getByRole('dialog', { name: 'Exportar imagen' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');
});

test('axe sin violaciones en las plantillas, la actividad y los ajustes del espacio', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const account = await createVerifiedAccount(page.request, `a11y-space-${test.info().project.name}`);
  await createProject(page.request, account.workspaceSlug, 'Cartel accesible');

  await page.goto(`/app/e/${account.workspaceSlug}?vista=plantillas`);
  await expect(page.getByText('Este espacio aún no tiene plantillas.')).toBeVisible();
  expect(await audit(page)).toEqual([]);

  await page.goto(`/app/e/${account.workspaceSlug}?vista=actividad`);
  // Cuenta nueva sin ediciones: el informe sale en su estado vacío.
  await expect(page.getByText('No hubo actividad en este periodo.')).toBeVisible();
  expect(await audit(page)).toEqual([]);

  await page.goto(`/app/e/${account.workspaceSlug}?vista=ajustes`);
  await expect(page.getByRole('heading', { name: 'Nombre' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test('axe sin violaciones en /invitacion: sin invitación, con un enlace y con un error', async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const ana = await createVerifiedAccount(page.request, `a11y-invite-a-${test.info().project.name}`);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Cartel accesible');
  const created = await page.request.post(`http://localhost:3000/v1/projects/${projectId}/share-links`, {
    headers: { origin: 'http://localhost:4321' },
    data: { role: 'viewer', expiresInDays: 1, maxUses: 1 },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { url } = (await created.json()) as { url: string };

  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const bea = await context.newPage();
  await createVerifiedAccount(bea.request, `a11y-invite-b-${test.info().project.name}`, 'Bea Accesible');

  await bea.goto('/invitacion');
  await expect(bea.getByText('Este enlace no lleva ninguna invitación', { exact: false })).toBeVisible();
  expect(await audit(bea)).toEqual([]);

  await bea.goto(url);
  await expect(bea.getByTestId('invite-message')).toBeVisible();
  expect(await audit(bea)).toEqual([]);

  await bea.goto('/invitacion#t=enlace-que-no-existe');
  await expect(bea.getByTestId('invite-error')).toBeVisible();
  expect(await audit(bea)).toEqual([]);
  await context.close();
});