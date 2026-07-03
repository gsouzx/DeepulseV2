import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Legacy v1 engine, kept as `@ts-nocheck` until the step 2 modular
    // rewrite replaces it — see the migration note in src/main.ts.
    files: ['src/main.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
);
