import type { Page } from '@playwright/test';

export const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Barra de herramientas' });

// Elige una herramienta de un grupo de la barra flotante (Formas, Líneas) desde su desplegable.
export async function pickTool(page: Page, group: 'Formas' | 'Líneas' | 'Seleccionar y mano', name: string) {
  await toolbar(page).getByRole('button', { name: group, exact: true }).click();
  await page.getByRole('menu', { name: group }).getByRole('menuitemcheckbox', { name, exact: true }).click();
}
