import { buildApp, type BuildAppOptions } from '../../src/api/app.js';
import type { Config } from '../../src/core/config.js';
import { testConfig } from './env.js';

export async function buildTestApp(
  overrides: Record<string, string | undefined> = {},
  options: BuildAppOptions & { config?: Config } = {},
) {
  const config = options.config ?? testConfig(overrides);
  const app = await buildApp(config, { logger: false, globalRateLimit: 100_000, ...options });
  await app.ready();
  return app;
}
