import { expect, test, type Page } from '@playwright/test';
import { countMails, readCode, RESET_SUBJECT, VERIFY_SUBJECT } from './helpers/mail.ts';

test.describe.configure({ mode: 'serial' });

let email = '';
const name = 'Ana Prueba';
const password = 'clave-de-prueba-1';
const newPassword = 'clave-de-prueba-2';

test.beforeAll(({ browserName }) => {
  email = `e2e-${browserName}-${Date.now()}@example.com`;
});

function overlay(page: Page) {
  return page.getByRole('dialog');
}

async function signIn(page: Page, address: string, secret: string) {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Acceso a tu cuenta' }).getByRole('link', { name: 'Entrar' }).click();
  const dialog = overlay(page);
  await expect(dialog.getByRole('heading', { name: 'Entrar en Parcify' })).toBeVisible();
  await dialog.getByLabel('Email').fill(address);
  await dialog.getByLabel('Contraseña').fill(secret);
  await dialog.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('registro con código leído del correo y sesión en /app', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Crear cuenta gratis' }).first().click();
  const dialog = overlay(page);
  await expect(dialog.getByRole('heading', { name: 'Crear tu cuenta' })).toBeVisible();
  await expect(page).toHaveURL('/');

  await dialog.getByLabel('Nombre').fill(name);
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Contraseña').fill(password);
  await dialog.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(dialog.getByRole('heading', { name: 'Verifica tu email' })).toBeVisible();
  const code = await readCode(request, email, VERIFY_SUBJECT);
  await dialog.getByLabel('Código de verificación').fill(code);
  await dialog.getByRole('button', { name: 'Verificar email' }).click();

  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: `Hola, ${name}` })).toBeVisible();
  await expect(page.getByText('Tu cuenta está lista.')).toBeVisible();
});

// /sign-in/email admite 5 intentos por minuto y por IP: cada navegador usa dos (este y el de recuperar).
// El error de credenciales se cubre en la prueba del componente.
test('entrar con email y contraseña', async ({ page }) => {
  await signIn(page, email, password);
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: `Hola, ${name}` })).toBeVisible();
});

test('recuperar la contraseña con código y entrar con la nueva', async ({ page, request }) => {
  await page.goto('/?acceso=entrar');
  const dialog = overlay(page);
  await dialog.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
  await expect(dialog.getByRole('heading', { name: 'Recuperar la contraseña' })).toBeVisible();
  const before = await countMails(request, email, RESET_SUBJECT);
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Enviar código' }).click();

  await expect(dialog.getByRole('heading', { name: 'Nueva contraseña' })).toBeVisible();
  const code = await readCode(request, email, RESET_SUBJECT, before);
  await dialog.getByLabel('Código de verificación').fill(code);
  await dialog.getByLabel('Contraseña nueva').fill(newPassword);
  await dialog.getByRole('button', { name: 'Cambiar contraseña' }).click();

  await expect(dialog.getByRole('heading', { name: 'Entrar en Parcify' })).toBeVisible();
  await expect(dialog.getByText('Contraseña cambiada. Entra con la nueva.')).toBeVisible();
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Contraseña').fill(newPassword);
  await dialog.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('/app');
});

test('sin sesión, /app lleva al overlay con «volver»', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL('/?acceso=entrar&volver=%2Fapp');
  await expect(overlay(page).getByRole('heading', { name: 'Entrar en Parcify' })).toBeVisible();
});

test('el botón de Google redirige a accounts.google.com', async ({ page }) => {
  // No se completa el flujo: se intercepta la página de Google para no salir a la red.
  await page.route('https://accounts.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google</title>' }),
  );
  await page.goto('/?acceso=entrar');
  await overlay(page).getByRole('button', { name: 'Continuar con Google' }).click();
  await page.waitForURL(/^https:\/\/accounts\.google\.com\//);
  const url = new URL(page.url());
  expect(url.searchParams.get('client_id')).toBe('parcify-e2e.apps.googleusercontent.com');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback/google');
});

test('no existen /login ni /register', async ({ request }) => {
  for (const path of ['/login', '/register']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }
});
