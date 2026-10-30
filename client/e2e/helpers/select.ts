import type { Locator, Page } from '@playwright/test';

// Elige una opción de un `Select` propio: el botón abre una lista que va en un portal, fuera del diálogo o la región.
export async function chooseOption(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}
