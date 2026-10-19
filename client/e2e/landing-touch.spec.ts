import { expect, test } from '@playwright/test';

test.use({ hasTouch: true, viewport: { width: 412, height: 915 } });

test('con el dedo, el lienzo de la landing deja desplazar la página en vertical', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const live = page.getByTestId('landing-canvas');
  await expect(live).toHaveClass(/is-ready/, { timeout: 20_000 });

  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  await expect(live).toHaveCSS('touch-action', 'pan-y');
  await expect(live.locator('canvas')).toHaveCSS('touch-action', 'pan-y');
});
