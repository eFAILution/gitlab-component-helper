const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: [
      '**/*.d.ts',
      'node_modules/**',
      'out/**',
      'out-test/**',
      '.vscode-test/**',
      '.husky/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
  },
  ...tseslint.config({
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      'no-useless-assignment': 'warn',
      'no-prototype-builtins': 'warn',
    },
  }),
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  {
    // Webview client scripts run in the Electron renderer, not the extension host
    files: ['src/webview/client/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        // Injected by VS Code into the webview; not a browser global.
        acquireVsCodeApi: 'readonly',
      },
    },
  },
];
