import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
