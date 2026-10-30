import { expect, test, type Page, type Request } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';

const API = 'http://localhost:3000';
const ORIGIN = { origin: 'http://localhost:4321' };

const projectQuery = (request: Request) => {
  const url = new URL(request.url());
  return /\/v1\/workspaces\/[^/]+\/projects$/.test(url.pathname) ? url.searchParams.get('q') : null;
};

const card = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem').filter({ has: page.getByRole('link', { name, exact: true }) });

const filter = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Mostrar' }).getByRole('radio', { name, exact: true }).click();

async function openMenu(page: Page, name: string) {
  await page.getByRole('button', { name: `Acciones de ${name}` }).click();
}

test('crear, renombrar, buscar, marcar favorito, duplicar, borrar en lote y restaurar', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `dash-${test.info().project.name}`);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: `Hola, ${account.name}` })).toBeVisible();
  await expect(page.getByText('Aún no tienes proyectos.')).toBeVisible();

  // El espacio personal está en la barra lateral.
  await page
    .getByRole('navigation', { name: 'Navegación de la app' })
    .getByRole('link', { name: `Proyectos de Espacio de ${account.name}` })
    .click();
  await expect(page).toHaveURL(`/app/e/${account.workspaceSlug}`);
  await expect(page.getByText('Aún no hay proyectos en este espacio.')).toBeVisible();

  // Crear desde la acción principal abre el editor.
  await page.getByRole('button', { name: 'Nuevo proyecto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear un proyecto' });
  await dialog.getByRole('textbox', { name: 'Nombre del proyecto' }).fill('Plano de la casa');
  await expect(dialog.getByText('Este espacio aún no tiene plantillas.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Proyecto en blanco' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('textbox', { name: 'Nombre del proyecto' })).toHaveValue('Plano de la casa');

  await createProject(page.request, account.workspaceSlug, 'Mapa del barrio');
  await createProject(page.request, account.workspaceSlug, 'Cartel');
  await page.goto(`/app/e/${account.workspaceSlug}`);
  await expect(card(page, 'Cartel')).toBeVisible();
  await expect(card(page, 'Plano de la casa')).toContainText('Editado');

  // Renombrar.
  await openMenu(page, 'Cartel');
  await page.getByRole('menuitem', { name: 'Cambiar el nombre' }).click();
  const rename = page.getByRole('dialog', { name: 'Cambiar el nombre del proyecto' });
  await rename.getByRole('textbox', { name: 'Nombre del proyecto' }).fill('Cartel de la fiesta');
  await rename.getByRole('button', { name: 'Guardar el nombre' }).click();
  await expect(card(page, 'Cartel de la fiesta')).toBeVisible();

  // Buscar.
  await page.getByRole('searchbox', { name: 'Buscar proyectos' }).fill('barrio');
  await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(1);
  await expect(card(page, 'Mapa del barrio')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar proyectos' }).fill('');
  await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(3);

  // Favorito.
  await page.getByRole('button', { name: 'Marcar Plano de la casa como favorito' }).click();
  await expect(page.getByRole('button', { name: 'Quitar Plano de la casa de favoritos' })).toHaveAttribute('aria-pressed', 'true');
  await filter(page, 'Favoritos');
  await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(1);
  await expect(card(page, 'Plano de la casa')).toBeVisible();
  await filter(page, 'Todos');

  // Duplicar.
  await openMenu(page, 'Mapa del barrio');
  await page.getByRole('menuitem', { name: 'Duplicar' }).click();
  await expect(card(page, 'Mapa del barrio (copia)')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(4);

  // Borrar en lote.
  await page.getByRole('checkbox', { name: 'Seleccionar Mapa del barrio (copia)' }).click();
  await page.getByRole('checkbox', { name: 'Seleccionar Mapa del barrio', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: 'Acciones de la selección' });
  await expect(bar).toContainText('2 proyectos seleccionados');
  await bar.getByRole('button', { name: 'Mover a la papelera' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Mover 2 proyectos a la papelera?' });
  await confirm.getByRole('button', { name: 'Mover a la papelera' }).click();
  await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(2);
  await expect(card(page, 'Mapa del barrio')).toHaveCount(0);

  // Restaurar desde la papelera.
  await filter(page, 'Papelera');
  const trash = page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem');
  await expect(trash).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Seleccionar Mapa del barrio', exact: true }).click();
  await bar.getByRole('button', { name: 'Restaurar' }).click();
  await expect(trash).toHaveCount(1);
  await filter(page, 'Todos');
  await expect(card(page, 'Mapa del barrio')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(3);

  // El inicio refleja los recientes y el favorito.
  await page.getByRole('link', { name: 'Recientes' }).click();
  await expect(page.getByRole('list', { name: 'Favoritos' }).getByRole('link', { name: 'Plano de la casa', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recientes' }).getByRole('listitem')).toHaveCount(3);
});

test('el buscador de la barra lateral encuentra proyectos y plantillas y solo pinta la última consulta (CA-7.3)', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `search-${test.info().project.name}`);
  const spring = await createProject(page.request, account.workspaceSlug, 'Campaña de primavera');
  await createProject(page.request, account.workspaceSlug, 'Primer boceto');
  await createProject(page.request, account.workspaceSlug, 'Cartel');
  const published = await page.request.post(`${API}/v1/projects/${spring}/template`, { headers: ORIGIN, data: { name: 'Primavera en verde' } });
  expect(published.ok(), await published.text()).toBe(true);

  await page.goto('/app');
  await expect(page.getByTestId('shell-workspace')).toBeVisible();

  // Ctrl/⌘+K abre el buscador con el foco en el campo; con una letra no se busca.
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: 'Buscar' });
  const input = search.getByRole('combobox', { name: 'Buscar proyectos y plantillas' });
  await expect(input).toBeFocused();
  await input.fill('p');
  await expect(search.getByRole('status')).toHaveText('Escribe al menos 2 letras.');

  // «prima»: el proyecto y la plantilla salen en menos de 500 ms desde la última respuesta.
  const projectsDone = page.waitForResponse((response) => projectQuery(response.request()) === 'prima');
  const templatesDone = page.waitForResponse((response) => response.url().includes('/templates?') && new URL(response.url()).searchParams.get('q') === 'prima');
  await input.fill('prima');
  await Promise.all([projectsDone, templatesDone]);
  const answered = Date.now();
  const results = search.getByRole('listbox', { name: 'Resultados' });
  await expect(results.getByRole('option', { name: /Campaña de primavera/ })).toBeVisible();
  expect(Date.now() - answered).toBeLessThan(500);
  await expect(results.getByRole('group', { name: 'Proyectos' }).getByRole('option')).toHaveCount(1);
  await expect(results.getByRole('group', { name: 'Plantillas' }).getByRole('option', { name: /Primavera en verde/ })).toBeVisible();

  // Escribir con pausas mientras el servidor tarda: cada consulta cancela la anterior y solo quedan las de «prima».
  await input.fill('');
  const queries: string[] = [];
  const aborted: string[] = [];
  page.on('request', (request) => {
    const q = projectQuery(request);
    if (q) queries.push(q);
  });
  page.on('requestfailed', (request) => {
    const q = projectQuery(request);
    if (q) aborted.push(q);
  });
  await page.route(/\/v1\/workspaces\/[^/]+\/projects\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue().catch(() => undefined);
  });
  for (const step of ['pr', 'pri', 'prima']) {
    await input.fill(step);
    await page.waitForTimeout(400);
  }
  await expect(results.getByRole('option', { name: /Campaña de primavera/ })).toBeVisible();
  await expect(results.getByRole('option', { name: /Primer boceto/ })).toHaveCount(0);
  expect(queries).toEqual(['pr', 'pri', 'prima']);
  expect(aborted).toEqual(['pr', 'pri']);
  await page.unroute(/\/v1\/workspaces\/[^/]+\/projects\?/);

  // La plantilla abre su vista previa en la galería del espacio; Enter en el proyecto abre el editor.
  await results.getByRole('option', { name: /Primavera en verde/ }).click();
  await expect(page).toHaveURL(`/app/e/${account.workspaceSlug}?vista=plantillas`);
  await expect(page.getByRole('dialog', { name: 'Primavera en verde' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Primavera en verde' })).toBeHidden();

  // El resultado de plantilla no filtra la pestaña Proyectos, y la búsqueda de Proyectos (?q=) sobrevive a las recargas.
  await page.getByRole('tab', { name: 'Proyectos' }).click();
  await expect(page).toHaveURL(`/app/e/${account.workspaceSlug}`);
  const searchbox = page.getByRole('searchbox', { name: 'Buscar proyectos' });
  await expect(searchbox).toHaveValue('');
  await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(3);
  await searchbox.fill('boceto');
  await expect(page).toHaveURL(`/app/e/${account.workspaceSlug}?q=boceto`);
  for (let round = 0; round < 2; round += 1) {
    await page.reload();
    await expect(card(page, 'Primer boceto')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Proyectos' }).getByRole('listitem')).toHaveCount(1);
    await expect(searchbox).toHaveValue('boceto');
    await expect(page).toHaveURL(`/app/e/${account.workspaceSlug}?q=boceto`);
  }

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Buscar proyectos y plantillas' }).fill('primavera');
  await expect(page.getByRole('option', { name: /Campaña de primavera/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/p/${spring}`);
});

test('el buscador espera a que lleguen los espacios y, si no llegan, avisa con Reintentar', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `search-spaces-${test.info().project.name}`);
  await createProject(page.request, account.workspaceSlug, 'Campaña de primavera');
  const LIST = /\/v1\/workspaces$/;
  const search = page.getByRole('dialog', { name: 'Buscar' });
  const input = search.getByRole('combobox', { name: 'Buscar proyectos y plantillas' });
  const openSearch = () =>
    expect(async () => {
      await page.keyboard.press('ControlOrMeta+k');
      await expect(input).toBeFocused({ timeout: 1000 });
    }).toPass();

  // Con la lista de espacios retenida, la consulta sigue en «Buscando…» y se lanza cuando llega.
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(LIST, async (route) => {
    await released;
    await route.continue();
  });
  await page.goto('/app');
  await openSearch();
  await input.fill('prima');
  await page.waitForTimeout(600);
  await expect(search.getByRole('status')).toHaveText('Buscando…');
  release();
  await expect(search.getByRole('option', { name: /Campaña de primavera/ })).toBeVisible();
  await page.unroute(LIST);

  // Si la lista falla, el aviso sustituye al resultado vacío y Reintentar vuelve a pedirla.
  await page.route(LIST, (route) => route.abort());
  await page.reload();
  await openSearch();
  await input.fill('prima');
  const alert = search.getByRole('alert');
  await expect(alert).toContainText('No se pudieron cargar tus espacios');
  await expect(search.getByText(/Nada se llama/)).toHaveCount(0);
  await page.unroute(LIST);
  await alert.getByRole('button', { name: 'Reintentar' }).click();
  await expect(search.getByRole('option', { name: /Campaña de primavera/ })).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test('la barra lateral se pliega a 56 px y lo recuerda al recargar', async ({ page }) => {
  await createVerifiedAccount(page.request, `collapse-${test.info().project.name}`);
  await page.goto('/app');
  const aside = page.getByRole('complementary', { name: 'Barra lateral' });
  await expect(aside.getByTestId('shell-workspace')).toBeVisible();
  expect((await aside.boundingBox())?.width).toBe(240);

  await aside.getByRole('button', { name: 'Plegar la barra lateral' }).click();
  expect((await aside.boundingBox())?.width).toBe(56);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
  expect((await aside.boundingBox())?.width).toBe(56);
  // Plegada, cada fila conserva su nombre accesible.
  await expect(aside.getByRole('link', { name: 'Recientes' })).toBeVisible();
  await aside.getByRole('button', { name: 'Desplegar la barra lateral' }).click();
  expect((await aside.boundingBox())?.width).toBe(240);
});

test('móvil @touch: ☰ abre la barra lateral como cajón y lleva a Plantillas y a Ajustes (CA-16.8)', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'Solo en el proyecto mobile');
  const account = await createVerifiedAccount(page.request, 'drawer-mobile');
  await page.goto('/app');
  await expect(page.getByRole('complementary', { name: 'Barra lateral' })).toBeHidden();

  const menu = page.getByRole('button', { name: 'Abrir el menú' });
  const drawer = page.getByRole('dialog', { name: 'Parcify' });
  await menu.tap();
  await expect(drawer).toBeVisible();
  expect((await drawer.boundingBox())?.width).toBeCloseTo(280, 0);
  await drawer.getByRole('link', { name: 'Plantillas' }).tap();
  await expect(page).toHaveURL(`/app/e/${account.workspaceSlug}?vista=plantillas`);
  await expect(page.getByRole('tab', { name: 'Plantillas', selected: true })).toBeVisible();

  // Un toque fuera lo cierra; Esc también.
  await menu.tap();
  await expect(drawer).toBeVisible();
  const viewport = page.viewportSize()!;
  await page.touchscreen.tap(viewport.width - 20, viewport.height / 2);
  await expect(drawer).toBeHidden();
  await menu.tap();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  await menu.tap();
  await drawer.getByRole('link', { name: 'Ajustes', exact: true }).tap();
  await expect(page).toHaveURL('/app/ajustes');
  await expect(page.getByRole('heading', { name: 'Ajustes de la cuenta', level: 1 })).toBeVisible();
});
