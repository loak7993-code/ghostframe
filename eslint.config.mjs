import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', Promise: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn', // count, don't fail — spoofing needs some 'any'
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': 'off',
      'no-debugger': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'prefer-const': 'error',
      'no-duplicate-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-throw-literal': 'error',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'netlayer/**', 'gui/**', 'profiles-state/**', 'data/**', 'mobile/**', 'packaging/**', 'src/inject/worker-source.ts', '**/gen-worker-embed.mjs', '*.cjs'],
  },
];
