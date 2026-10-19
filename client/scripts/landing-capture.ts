import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

// Build servido con `node scripts/serve.ts`.
const url = process.argv[2] ?? 'http://localhost:4321/';
const target = resolve('public/landing/lienzo.png');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await page.goto(url);
  // El aro entra por la derecha y la ventana lo corta: para la captura se mete entero en pantalla.
  await page.addStyleTag({ content: '.hero-ring{right:2vw!important}' });
  await page.locator('[data-testid="landing-canvas"].is-ready').waitFor({ timeout: 30_000 });
  // Ana a mitad de su primer gesto: el cursor y la selección se ven en la captura.
  await page.waitForTimeout(1_600);
  mkdirSync(resolve('public/landing'), { recursive: true });
  await page.locator('.hero-stage').screenshot({ path: target, animations: 'disabled' });
  console.log(`Captura guardada en ${target}`);
} finally {
  await browser.close();
}
