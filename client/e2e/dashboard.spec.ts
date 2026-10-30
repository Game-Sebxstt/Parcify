import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';

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
  await page.getByRole('navigation', { name: 'Navegación de la app' }).getByRole('link', { name: `Espacio de ${account.name}` }).click();
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
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByRole('list', { name: 'Favoritos' }).getByRole('link', { name: 'Plano de la casa', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recientes' }).getByRole('listitem')).toHaveCount(3);
});
