import { defineConfig } from 'vitest/config';

// Stack de compose.test.yml; globalSetup y los tests leen estas variables.
process.env.TEST_DATABASE_URL ??= 'postgresql://parcify:parcify_test@127.0.0.1:55433/parcify_test';
process.env.TEST_REDIS_URL ??= 'redis://:parcify_test@127.0.0.1:56380/0';
// SeaweedFS del perfil s3; las pruebas de storage lo usan si responde (TEST_REQUIRE_S3=1 lo exige).
process.env.TEST_S3_ENDPOINT ??= 'http://127.0.0.1:58334';

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts', 'test/**/*.int.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    environment: 'node',
    globalSetup: ['test/int/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
