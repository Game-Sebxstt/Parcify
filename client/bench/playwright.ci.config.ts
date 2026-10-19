import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

// npm run bench:ci: sin GPU (SwiftShader) y con la CPU limitada ×4; solo cuenta el trabajo JS del motor.
process.env.PARCIFY_BENCH_MODE = 'ci';

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    headless: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling'] },
  },
});
