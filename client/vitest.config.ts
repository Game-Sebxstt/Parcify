import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Sin la integración completa de Astro: los mensajes se compilan antes con npm run i18n.
export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: { dedupe: ['yjs', 'y-protocols', 'lib0'] },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // La primera consulta por rol en jsdom es lenta en frío.
    testTimeout: 20_000,
  },
});
