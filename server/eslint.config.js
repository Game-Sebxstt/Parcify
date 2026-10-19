import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'src/generated/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Lee la configuración desde src/core/config.ts.' },
      ],
    },
  },
  {
    files: ['src/core/config.ts', 'scripts/**', 'prisma.config.ts', 'vitest*.config.ts', 'test/**', 'src/**/*.test.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['local-deploy/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { 'no-restricted-properties': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['src/shared/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!zod$|zod/|yjs$|fractional-indexing$|\\.)',
              message: 'src/shared solo puede importar zod, yjs y fractional-indexing.',
            },
          ],
        },
      ],
    },
  },
);
