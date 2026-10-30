import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const serverDir = resolve(process.env.PARCIFY_SERVER_DIR || '../server');
const SITE = 'http://localhost:4321';
const API = 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // Los guiones de diagnóstico se ejecutan a mano y una sola vez: DIAG=1 npx playwright test e2e/diagnostics.
  testIgnore: process.env.DIAG === '1' ? [] : ['**/diagnostics/**'],
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: SITE,
    trace: 'retain-on-failure',
  },
  projects: [
    // El benchmark tiene su propia configuración (bench/playwright.config.ts): no necesita el servidor.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@touch/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: /@touch/ },
    // Los gestos táctiles se simulan con CDP (Input.dispatchTouchEvent), así que los dos van en Chromium.
    { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' }, grep: /@touch/ },
    { name: 'tablet', use: { ...devices['iPad Pro 11'], defaultBrowserType: 'chromium' }, grep: /@touch/ },
  ],
  webServer: [
    {
      // api y collab compilados contra compose.test.yml (requiere npm run stack:test:up en el servidor).
      command: 'npm run start:e2e',
      cwd: serverDir,
      url: `${API}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        CLIENT_ORIGINS: SITE,
        // Las cuentas que crean las pruebas por la API llegan con X-Forwarded-For distintos (e2e/helpers/account.ts).
        TRUST_PROXY_HOPS: '1',
        // Credenciales ficticias, solo de pruebas: bastan para que la API genere la URL de autorización de Google.
        GOOGLE_CLIENT_ID: 'parcify-e2e.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'parcify-e2e-google-secret',
        // Proveedor de IA simulado (solo existe con NODE_ENV=test): salidas fijas, sin red ni claves.
        AI_MODEL_ASSISTANT: 'mock:assistant',
        AI_MODEL_ANIMATION: 'mock:animation',
        AI_MODEL_CHAT: 'mock:chat',
        AI_MODEL_IMAGE: 'mock:image',
      },
    },
    {
      // scripts/serve.ts reproduce las reescrituras del Caddyfile (/p/:id, /app/e/:slug).
      command: 'npm run build && node scripts/serve.ts --host localhost --port 4321',
      url: SITE,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        PUBLIC_TEST_HOOKS: '1',
        PUBLIC_API_ORIGIN: API,
        PUBLIC_COLLAB_ORIGIN: 'http://localhost:3001',
        PUBLIC_SITE_ORIGIN: SITE,
        PUBLIC_STORAGE_ORIGIN: API,
      },
    },
  ],
});
