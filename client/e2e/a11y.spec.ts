import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';

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

// CA-3.3: ningún control nativo visible y ningún botón con `title`. Los `input` ocultos que bits-ui pone para los
// formularios llevan `aria-hidden` y no cuentan.
const NATIVE = 'select, input[type=checkbox], input[type=radio], input[type=range], input[type=color], input[type=number]';
// `within` limita la búsqueda a un diálogo abierto, sin contar el panel de propiedades ni la línea de tiempo.
const nativeControls = (page: Page, within?: string) =>
  page.evaluate(
    ([selector, scope]) => {
      const root = scope ? document.querySelector(scope) : document;
      if (!root) return { controls: ['sin raíz'], titled: [] };
      const controls = [...root.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.checkVisibility())
        .map((element) => element.outerHTML.slice(0, 120));
      const titled = [...root.querySelectorAll<HTMLElement>('button[title]')].map((element) => element.outerHTML.slice(0, 120));
      return { controls, titled };
    },
    [NATIVE, within ?? null] as const,
  );
const NO_NATIVE = { controls: [], titled: [] };

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

test('el panel de propiedades no usa controles nativos, con los paneles abiertos y plegados (CA-3.3)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const account = await createVerifiedAccount(page.request, `a11y-props-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug, 'Panel sin nativos');
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  const nodes = () => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);
  const panel = page.getByTestId('properties-panel');
  // Solo los controles nativos (CA-3.3): los `title` de los botones del chat los quita su ventana nueva.
  const controls = async () => (await nativeControls(page)).controls;
  await expect(panel).toBeVisible();
  expect(await controls()).toEqual([]);

  // Una forma con relleno, trazo y sombra: todas las secciones de una forma a la vista.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 80, y: box.y + box.height / 2 - 60 };
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, origin, { x: origin.x + 140, y: origin.y + 90 });
  await expect.poll(async () => (await nodes()).length).toBe(1);
  await panel.getByRole('button', { name: 'Añadir sombra' }).click();
  await expect(panel.getByRole('spinbutton', { name: 'Desenfoque de la sombra' })).toBeVisible();
  await expect(panel.getByRole('spinbutton', { name: 'Rotación' })).toBeVisible();
  expect(await controls()).toEqual([]);
  expect(await audit(page)).toEqual([]);

  // El selector de color abierto tampoco.
  await panel.getByRole('button', { name: 'Relleno', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Selector de color' })).toBeVisible();
  expect(await controls()).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Selector de color' })).toBeHidden();
  // Esc cierra solo el selector: la forma sigue seleccionada.
  expect(await page.evaluate(() => window.__parcifyTest!.selection().length)).toBe(1);

  // Con la interfaz minimizada los paneles quedan como pastillas.
  await canvas.focus();
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.getByTestId('left-panel-pill')).toBeVisible();
  expect(await controls()).toEqual([]);
});

// Abre un `Select` dentro de un diálogo o una región y comprueba que su lista sale por el portal sin recortes.
async function openSelectList(page: Page, trigger: Locator, options: number) {
  await expect(trigger).toBeVisible();
  await trigger.click();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  await expect(list.getByRole('option')).toHaveCount(options);
  expect(await floatingClips(page)).toEqual({ open: 1, clips: [] });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-floating]')).toHaveCount(0);
}

test('axe sin violaciones en el inicio, el espacio y los ajustes', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const account = await createVerifiedAccount(page.request, `a11y-${test.info().project.name}`);
  await createProject(page.request, account.workspaceSlug, 'Cartel accesible');
  // Un segundo espacio y otra persona en el personal: así existen el `Select` de espacio y el del rol de un miembro.
  const space = await page.request.post('http://localhost:3000/v1/workspaces', {
    headers: { origin: 'http://localhost:4321' },
    data: { name: 'Estudio accesible' },
  });
  expect(space.ok(), await space.text()).toBe(true);
  const context = await browser.newContext();
  const bea = await createVerifiedAccount(context.request, `a11y-bea-${test.info().project.name}`, 'Bea Accesible');
  await joinWorkspace(page.request, account.workspaceSlug, context.request, bea.email);
  await context.close();

  await page.goto('/app');
  await expect(page.getByRole('list', { name: 'Recientes' }).getByRole('listitem')).toHaveCount(1);
  expect(await audit(page)).toEqual([]);
  expect(await nativeControls(page)).toEqual(NO_NATIVE);

  // «Nuevo proyecto» e «Importar» con dos espacios: el `Select` de espacio existe y su lista no se recorta.
  await page.getByRole('button', { name: 'Nuevo proyecto' }).click();
  const create = page.getByRole('dialog', { name: 'Crear un proyecto' });
  await expect(create).toBeVisible();
  expect(await nativeControls(page, '[role=dialog]')).toEqual(NO_NATIVE);
  await openSelectList(page, create.getByRole('combobox', { name: /^Espacio: / }), 2);
  await expect(create).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(create).toBeHidden();

  await page.getByRole('button', { name: 'Importar .parcify' }).click();
  const importing = page.getByRole('dialog', { name: 'Importar un proyecto' });
  await expect(importing).toBeVisible();
  await openSelectList(page, importing.getByRole('combobox', { name: /^Espacio: / }), 2);
  await expect(importing).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(importing).toBeHidden();

  await page.goto(`/app/e/${account.workspaceSlug}`);
  await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(1);
  expect(await audit(page)).toEqual([]);
  expect(await nativeControls(page)).toEqual(NO_NATIVE);

  // «Ordenar por» abre su lista en el portal, sin ancestros que la recorten.
  await page.getByLabel('Ordenar por').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(await floatingClips(page)).toEqual({ open: 1, clips: [] });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-floating]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Nuevo proyecto' }).click();
  await expect(page.getByRole('dialog', { name: 'Crear un proyecto' })).toBeVisible();
  expect(await nativeControls(page)).toEqual(NO_NATIVE);
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Miembros' }).click();
  await expect(page.getByRole('list', { name: 'Miembros' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  // La invitación al espacio con su selector de rol.
  await expect(page.getByRole('region', { name: 'Invitar al espacio' })).toBeVisible();
  expect(await nativeControls(page)).toEqual(NO_NATIVE);
  // El rol de la otra persona se cambia con un `Select` propio; quien es propietario ve los tres roles.
  await openSelectList(page, page.getByRole('list', { name: 'Miembros' }).getByRole('combobox', { name: 'Rol de Bea Accesible: Miembro' }), 3);

  await page.goto('/app/ajustes');
  await expect(page.getByRole('region', { name: 'Sesiones activas' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Historial de seguridad' }).getByRole('listitem').first()).toBeVisible();
  expect(await audit(page)).toEqual([]);
  expect(await nativeControls(page)).toEqual(NO_NATIVE);
  const wheel = page.getByRole('radiogroup', { name: 'Rueda del ratón' });
  await expect(wheel).toBeVisible();
  await expect(wheel).toHaveAccessibleDescription(/^Con Ctrl o ⌘ la rueda siempre hace zoom/);
});

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
}

test('axe sin violaciones en los paneles del editor: IA, chat, versiones, timeline, compartir y exportar', async ({ page }) => {
  // Doce auditorías de axe sobre el editor: en Firefox cada una tarda varios segundos.
  test.setTimeout(240_000);
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

  await page.getByRole('button', { name: 'Animar', exact: true }).click();
  await expect(page.getByTestId('timeline').getByRole('grid', { name: 'Línea de tiempo' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.getByTestId('timeline').getByTestId('timeline-ai').click();
  await expect(page.getByTestId('ai-animate')).toBeVisible();
  expect(await audit(page)).toEqual([]);

  await page.getByTestId('share').click();
  const share = page.getByRole('dialog', { name: 'Compartir «Cartel accesible»' });
  await expect(share.getByTestId('share-person')).toHaveCount(1);
  expect(await audit(page)).toEqual([]);
  expect(await nativeControls(page, '[role=dialog]')).toEqual(NO_NATIVE);
  // La lista del rol sale del diálogo por el portal y queda por encima.
  await share.getByLabel('Rol del enlace').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(await floatingClips(page)).toEqual({ open: 1, clips: [] });
  expect(await audit(page)).toEqual([]);
  await page.getByRole('listbox').getByRole('option', { name: 'Puede editar', exact: true }).click();
  await expect(share.getByLabel('Rol del enlace')).toHaveAccessibleName('Rol del enlace: Puede editar');
  await share.getByRole('button', { name: 'Crear enlace' }).click();
  await expect(share.getByTestId('share-link-url')).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await share.getByRole('button', { name: 'Cerrar' }).click();

  // Exportar desde el menú contextual, con el rectángulo aún seleccionado.
  await canvas.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menu', { name: 'Acciones del lienzo' }).getByRole('menuitem', { name: 'Exportar selección' }).click();
  const exporting = page.getByRole('dialog', { name: 'Exportar imagen' });
  await expect(exporting).toBeVisible();
  expect(await audit(page)).toEqual([]);
  expect(await nativeControls(page, '[role=dialog]')).toEqual(NO_NATIVE);
  await page.keyboard.press('Escape');
});

// Contenidos flotantes abiertos y, de cada uno, los ancestros (sin contar body) que podrían recortarlo.
const floatingClips = (page: Page) =>
  page.evaluate(() => {
    const open = [...document.querySelectorAll<HTMLElement>('[data-floating]')];
    const clips: string[] = [];
    for (const element of open) {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
          clips.push(`${element.getAttribute('role') ?? element.tagName} dentro de ${node.tagName.toLowerCase()}.${node.className}`);
        }
      }
    }
    return { open: open.length, clips };
  });

test('los menús, submenús y tooltips abiertos no tienen ancestros que los recorten', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const account = await createVerifiedAccount(page.request, `a11y-flotantes-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug, 'Cartel accesible');
  await openEditor(page, projectId);
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 40 };
  await canvas.focus();
  await page.keyboard.press('r');
  await drag(page, origin, { x: origin.x + 120, y: origin.y + 80 });
  await expect.poll(() => page.evaluate(() => window.__parcifyTest!.selection().length)).toBe(1);

  // Tooltip de un botón del panel de páginas.
  await page.getByRole('button', { name: 'Añadir página' }).hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  expect(await floatingClips(page)).toEqual({ open: 1, clips: [] });
  await page.mouse.move(origin.x + 60, origin.y + 40);
  await expect(page.locator('[data-floating]')).toHaveCount(0);

  // Menú de una página, dentro de una lista con scroll.
  await page.getByRole('button', { name: 'Acciones de Página 1' }).click();
  await expect(page.getByRole('menu', { name: 'Acciones de Página 1' })).toBeVisible();
  expect(await floatingClips(page)).toEqual({ open: 1, clips: [] });
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');

  // Menú contextual del lienzo con el submenú «Ordenar» abierto.
  await canvas.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Acciones del lienzo' });
  await menu.getByRole('menuitem', { name: 'Ordenar' }).hover();
  await expect(page.getByRole('menuitem', { name: 'Traer al frente' })).toBeVisible();
  expect(await floatingClips(page)).toEqual({ open: 2, clips: [] });
  expect(await audit(page)).toEqual([]);
  await page.getByRole('menuitem', { name: 'Traer al frente' }).click();
  await expect(page.locator('[data-floating]')).toHaveCount(0);
});

test('axe sin violaciones en las plantillas, la actividad y los ajustes del espacio', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const account = await createVerifiedAccount(page.request, `a11y-space-${test.info().project.name}`);
  await createProject(page.request, account.workspaceSlug, 'Cartel accesible');

  await page.goto(`/app/e/${account.workspaceSlug}?vista=plantillas`);
  await expect(page.getByText('Este espacio aún no tiene plantillas.')).toBeVisible();
  expect(await audit(page)).toEqual([]);
  expect(await nativeControls(page)).toEqual(NO_NATIVE);

  await page.goto(`/app/e/${account.workspaceSlug}?vista=actividad`);
  // Cuenta nueva sin ediciones: el informe sale en su estado vacío.
  await expect(page.getByText('No hubo actividad en este periodo.')).toBeVisible();
  expect(await audit(page)).toEqual([]);
  expect(await nativeControls(page)).toEqual(NO_NATIVE);
  await page.getByLabel('Periodo').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(await floatingClips(page)).toEqual({ open: 1, clips: [] });
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.goto(`/app/e/${account.workspaceSlug}?vista=ajustes`);
  await expect(page.getByRole('heading', { name: 'Nombre' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  expect(await nativeControls(page)).toEqual(NO_NATIVE);
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