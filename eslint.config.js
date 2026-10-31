import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'dev-dist', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.ts', '*.js', '*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
