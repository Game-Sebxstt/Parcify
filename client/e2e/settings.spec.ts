import { expect, test } from '@playwright/test';
import { clientIpHeaders, createProject, createVerifiedAccount } from './helpers/account.ts';
import { solidPng } from './helpers/image.ts';
import { joinWorkspace } from './helpers/invite.ts';

const API = 'http://localhost:3000';
const ORIGIN = { origin: 'http://localhost:4321' };

test('perfil y avatar, el avatar en la presencia, cerrar las demás sesiones y borrar la cuenta', async ({ page, browser }) => {
  const label = `settings-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, label);

  await page.goto('/app/ajustes');
  await expect(page.getByRole('heading', { name: 'Ajustes de la cuenta', level: 1 })).toBeVisible();

  // Nombre y bio.
  const profile = page.getByRole('region', { name: 'Perfil' });
  await profile.getByRole('textbox', { name: 'Nombre' }).fill('Ana Renombrada');
  await profile.getByRole('textbox', { name: 'Sobre ti' }).fill('Diseño carteles para el barrio.');
  await profile.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Perfil guardado.')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Barra lateral' })).toContainText('Ana Renombrada');

  // Avatar subido con purpose avatar y visible en el perfil.
  await page.getByTestId('avatar-input').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: solidPng() });
  await expect(page.getByText('Foto actualizada.')).toBeVisible();
  await expect(profile.getByRole('img', { name: 'Ana Renombrada' })).toBeVisible();

  // Otra persona del espacio ve el avatar de Ana en la presencia del editor.
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Cartel con presencia');
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const bea = await createVerifiedAccount(other.request, `${label}-b`, 'Bea Colabora');
  await joinWorkspace(page.request, ana.workspaceSlug, other.request, bea.email);
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  await other.goto(`/p/${projectId}`);
  await other.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  const presence = other.getByRole('list', { name: 'Personas en el proyecto' });
  await expect(presence.getByRole('img', { name: 'Ana Renombrada' })).toBeVisible();
  await otherContext.close();

  // Una segunda sesión de Ana en otro contexto puede escribir...
  const secondContext = await browser.newContext();
  const signIn = await secondContext.request.post(`${API}/api/auth/sign-in/email`, {
    headers: clientIpHeaders(),
    data: { email: ana.email, password: 'clave-de-prueba-1' },
  });
  expect(signIn.ok(), await signIn.text()).toBe(true);
  const before = await secondContext.request.patch(`${API}/v1/me`, { headers: ORIGIN, data: { bio: 'Desde el portátil.' } });
  expect(before.status()).toBe(200);

  // ...hasta que se cierran las demás sesiones desde los ajustes.
  await page.goto('/app/ajustes');
  const sessions = page.getByRole('region', { name: 'Sesiones activas' });
  await expect(sessions.getByRole('listitem')).toHaveCount(2);
  await sessions.getByRole('button', { name: 'Cerrar sesión en los demás dispositivos' }).click();
  await expect(page.getByText('Se cerraron las demás sesiones.')).toBeVisible();
  await expect(sessions.getByRole('listitem')).toHaveCount(1);
  const after = await secondContext.request.patch(`${API}/v1/me`, { headers: ORIGIN, data: { bio: 'Ya no debería.' } });
  expect(after.status()).toBe(401);
  await secondContext.close();
  await expect(page.getByRole('region', { name: 'Historial de seguridad' }).getByText('Sesión cerrada').first()).toBeVisible();

  // Borrar la cuenta con la sesión recién creada.
  await page.getByRole('button', { name: 'Borrar mi cuenta' }).click();
  const dialog = page.getByRole('dialog', { name: '¿Borrar tu cuenta?' });
  await dialog.getByRole('button', { name: 'Borrar la cuenta' }).click();
  await expect(page).toHaveURL('/');
  const me = await page.request.get(`${API}/v1/me`);
  expect(me.status()).toBe(401);
});
