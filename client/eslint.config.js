import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default tseslint.config(
  {
    // src/shared es una copia del servidor (npm run shared:sync) y se revisa allí.
    ignores: [
      'dist/**',
      '.astro/**',
      'node_modules/**',
      'src/paraglide/**',
      'src/shared/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Solo el host del documento escribe el Y.Doc: fuera de él, Yjs y el host se importan solo como tipos.
  {
    files: ['src/**/*.ts', 'src/**/*.svelte'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'yjs', message: 'El Y.Doc vive en el host del documento.', allowTypeImports: true },
            { name: 'y-indexeddb', message: 'La copia local vive en el host del documento.', allowTypeImports: true },
            { name: '@hocuspocus/provider', message: 'El proveedor vive en el host del documento.', allowTypeImports: true },
          ],
          patterns: [
            { group: ['y-protocols/*'], message: 'La Awareness vive en el host del documento.', allowTypeImports: true },
            { regex: '(^|/)doc/host(/|$)', message: 'El host del documento no se importa desde el motor.', allowTypeImports: true },
            { regex: '(^|/)collab-host(\\.ts)?$', message: 'CollabHost corre en el worker.', allowTypeImports: true },
            { regex: '(^|/)shared/document/(init|normalize)(\\.js|\\.ts)?$', message: 'Estos módulos importan Yjs.', allowTypeImports: true },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/engine/doc/host/**',
      'src/lib/collab-host.ts',
      'src/lib/collab.worker.ts',
      'src/landing/**',
      'src/islands/editor/version-preview.ts',
      'src/engine/export/thumbnail.ts',
      'src/engine/test-utils.ts',
      '**/*.test.ts',
    ],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
  },
);
