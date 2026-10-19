import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';

const PASSWORD = 'clave-de-prueba-1';

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
}

async function createLink(page: Page, projectName: string, options: { role: 'Puede editar' | 'Solo puede ver'; days: string; uses?: string }) {
  const panel = page.getByRole('dialog', { name: `Compartir «${projectName}»` });
  await panel.getByLabel('Rol del enlace').selectOption({ label: options.role });
  await panel.getByText(options.days, { exact: true }).click();
  await panel.getByLabel('Usos máximos (opcional)').fill(options.uses ?? '');
  await panel.getByRole('button', { name: 'Crear enlace' }).click();
  const field = panel.getByTestId('share-link-url');
  await expect(field).toHaveValue(/\/invitacion#t=[A-Za-z0-9_-]{43}$/);
  return field.inputValue();
}

test('enlace de proyecto de principio a fin: sin sesión, overlay, aceptar y editor sin el token en la URL', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const label = `share-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Comparte');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Cartel por enlace');

  // Bea tiene cuenta, pero abre el enlace en un navegador sin sesión.
  const setup = await browser.newContext();
  const bea = await createVerifiedAccount(setup.request, `${label}-b`, 'Bea Enlace');
  await setup.close();
  const carlaContext = await browser.newContext();
  const carla = await carlaContext.newPage();
  await createVerifiedAccount(carla.request, `${label}-c`, 'Carla Tarde');

  await openEditor(page, projectId);
  await page.getByTestId('share').click();
  const panel = page.getByRole('dialog', { name: 'Compartir «Cartel por enlace»' });
  await expect(panel.getByTestId('share-person').filter({ hasText: 'Ana Comparte' })).toBeVisible();
  const url = await createLink(page, 'Cartel por enlace', { role: 'Puede editar', days: '1 día', uses: '1' });
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('t')!;
  await expect(panel.getByTestId('share-link')).toContainText('Puede editar');
  await expect(panel.getByTestId('share-link')).toContainText('0 de 1 usos');
  await expect(panel.getByRole('button', { name: /^Revocar el enlace/ })).toBeVisible();

  // El enlace se muestra una sola vez: al reabrir el panel solo queda el resumen.
  await panel.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByTestId('share').click();
  await expect(panel.getByTestId('share-link')).toHaveCount(1);
  await expect(panel.getByTestId('share-link-url')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Cerrar' }).click();

  const beaContext = await browser.newContext();
  const beaPage = await beaContext.newPage();
  const visited: string[] = [];
  beaPage.on('framenavigated', (frame) => frame === beaPage.mainFrame() && visited.push(frame.url()));
  await beaPage.goto(url);
  const overlay = beaPage.getByRole('dialog', { name: 'Entrar en Parcify' });
  await expect(overlay).toBeVisible();
  expect(beaPage.url()).not.toContain(token);
  await overlay.getByLabel('Email').fill(bea.email);
  await overlay.getByLabel('Contraseña').fill(PASSWORD);
  await overlay.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(beaPage.getByTestId('invite-message')).toHaveText(
    /^Ana Comparte te invita a editar «Cartel por enlace» en el espacio .+\.$/,
  );
  expect(beaPage.url()).not.toContain(token);
  await beaPage.getByRole('button', { name: 'Aceptar' }).click();
  await expect(beaPage).toHaveURL(`/p/${projectId}`);
  await beaPage.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  expect(await beaPage.evaluate(() => window.__parcifyTest!.readOnly())).toBe(false);
  // Solo la primera carga lleva el fragmento; ninguna navegación posterior ni el almacenamiento guardan el token.
  expect(visited.slice(1).some((address) => address.includes(token))).toBe(false);
  expect(await beaPage.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain(token);

  // Ana ve a Bea con acceso directo; el enlace de un uso ya no está activo.
  await page.getByTestId('share').click();
  await expect(panel.getByTestId('share-person').filter({ hasText: 'Bea Enlace' })).toContainText('Acceso directo');
  await expect(panel.getByText('No hay enlaces activos.')).toBeVisible();

  // Un enlace revocado ya no deja entrar a nadie.
  const second = await createLink(page, 'Cartel por enlace', { role: 'Solo puede ver', days: '7 días' });
  await panel.getByRole('button', { name: /^Revocar el enlace/ }).click();
  await expect(page.getByText('Enlace revocado. Ya nadie puede entrar con él.')).toBeVisible();
  await expect(panel.getByText('No hay enlaces activos.')).toBeVisible();

  await carla.goto(url);
  await expect(carla.getByTestId('invite-error')).toHaveText(
    'Este enlace ya se usó todas las veces permitidas. Pide uno nuevo a quien te lo envió.',
  );
  await carla.goto(second);
  await expect(carla.getByTestId('invite-error')).toHaveText('Este enlace ya no está activo. Pide uno nuevo a quien te lo envió.');
  expect(carla.url()).not.toContain('#t=');

  await beaContext.close();
  await carlaContext.close();
});

test('el botón Compartir solo funciona para quien administra el proyecto', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const label = `share-viewer-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Admin');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Solo admins');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Lectora');
  const url = await (async () => {
    const response = await page.request.post(`http://localhost:3000/v1/projects/${projectId}/share-links`, {
      headers: { origin: 'http://localhost:4321' },
      data: { role: 'viewer', expiresInDays: 1 },
    });
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { url: string }).url;
  })();

  await bea.goto(url);
  await expect(bea.getByTestId('invite-message')).toHaveText(/^Ana Admin te invita a ver «Solo admins»/);
  await bea.getByRole('button', { name: 'Aceptar' }).click();
  await expect(bea).toHaveURL(`/p/${projectId}`);
  await bea.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  const share = bea.getByTestId('share');
  await expect(share).toHaveAttribute('aria-disabled', 'true');
  await share.click({ force: true });
  await expect(bea.getByRole('dialog')).toHaveCount(0);

  // Volver a abrir el enlace con el acceso ya concedido no gasta nada y lleva al proyecto.
  await bea.goto(url);
  await expect(bea.getByText('Ya tienes acceso a «Solo admins».')).toBeVisible();
  await otherContext.close();
});
