import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';

// Recoge las violaciones de CSP de la página desde antes de que cargue su primer script.
async function watchCsp(page: Page) {
  const violations: string[] = [];
  await page.exposeFunction('__cspViolation', (text: string) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      void (window as unknown as { __cspViolation: (text: string) => void }).__cspViolation(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content[- ]Security[- ]Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

test('sin violaciones de CSP en la landing, el overlay, /app y el editor', async ({ page }) => {
  const violations = await watchCsp(page);

  const landing = await page.goto('/');
  // Las cabeceras del Caddyfile llegan también en el servidor de pruebas (scripts/serve.ts).
  expect(landing!.headers()['content-security-policy']).toBe("frame-ancestors 'none'");
  expect(landing!.headers()['x-content-type-options']).toBe('nosniff');
  await expect(page.locator('meta[http-equiv="content-security-policy"]')).toHaveCount(1);
  await expect(page.getByTestId('landing-canvas')).toHaveClass(/is-ready/, { timeout: 20_000 });

  await page.getByRole('navigation', { name: 'Acceso a tu cuenta' }).getByRole('link', { name: 'Entrar' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Entrar en Parcify' })).toBeVisible();

  const account = await createVerifiedAccount(page.request, `csp-${test.info().project.name}`);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: `Hola, ${account.name}` })).toBeVisible();

  const projectId = await createProject(page.request, account.workspaceSlug);
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  await page.waitForTimeout(500);

  expect(violations).toEqual([]);
});

test('el worker del documento tiene su propia CSP: no conecta fuera de los orígenes del producto ni usa eval', async ({ page }) => {
  const account = await createVerifiedAccount(page.request, `csp-worker-${test.info().project.name}`);
  const projectId = await createProject(page.request, account.workspaceSlug);
  const landing = await page.request.get('/');
  expect(landing.headers()['content-security-policy']).toBe("frame-ancestors 'none'");
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  const worker = page.workers().find((candidate) => candidate.url().includes('collab.worker-'));
  expect(worker, 'worker del documento').toBeDefined();
  const header = (await page.request.get(new URL(worker!.url()).pathname)).headers()['content-security-policy'];
  expect(header).toContain("default-src 'none'");
  expect(header).toContain("connect-src 'self'");
  expect(header).toContain('ws://localhost:3001');
  // Un servidor local que cuenta los intentos de conexión.
  let upgrades = 0;
  const server = createServer((_request, response) => response.end());
  server.on('upgrade', (_request, socket) => {
    upgrades++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await worker!.evaluate((target) => {
      try {
        new WebSocket(target);
      } catch {
        // Firefox lo bloquea en el constructor.
      }
    }, `ws://127.0.0.1:${port}/`);
    await page.waitForTimeout(1_000);
    expect(upgrades).toBe(0);
    const violations = await worker!.evaluate(() => (globalThis as unknown as { __cspViolations?: Array<{ directive: string }> }).__cspViolations ?? []);
    expect(violations.some((violation) => violation.directive === 'connect-src')).toBe(true);
    expect(violations.some((violation) => violation.directive.startsWith('script-src'))).toBe(false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});