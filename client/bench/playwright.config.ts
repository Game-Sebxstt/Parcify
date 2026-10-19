import { defineConfig } from '@playwright/test';

// npm run bench: Chromium con ventana y GPU real contra un build con PARCIFY_BENCH=1. No necesita el servidor.
export const BENCH_PORT = 4322;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.bench\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${BENCH_PORT}`,
    browserName: 'chromium',
    headless: false,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1.25,
    launchOptions: {
      args: [
        '--enable-gpu-rasterization',
        '--ignore-gpu-blocklist',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
      ],
    },
  },
  webServer: {
    command: `npm run build && node scripts/serve.ts --host localhost --port ${BENCH_PORT}`,
    cwd: '..',
    url: `http://localhost:${BENCH_PORT}/_bench`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { PARCIFY_BENCH: '1' },
  },
});
