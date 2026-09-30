const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

/**
 * JSX the webview views must not contain.
 *
 * @param {{ allowRawHtml?: boolean }} [options] `allowRawHtml` admits `dangerouslySetInnerHTML`, for `Page.tsx` only.
 * @returns {{ selector: string, message: string }[]} `no-restricted-syntax` entries.
 */
function viewRestrictions({ allowRawHtml = false } = {}) {
  return [
    {
      selector: "JSXAttribute[name.name='style']",
      message: 'Inline styles are blocked by the webview CSP; add a class in src/webview/styles.',
    },
    {
      selector: 'JSXAttribute[name.name=/^on/]',
      message: 'Inline handlers are blocked by the webview CSP; use a data-action attribute.',
    },
    {
      selector: "JSXOpeningElement[name.name='script']:not(:has(JSXAttribute[name.name=/^(src|type)$/]))",
      message: 'Inline scripts are blocked by the webview CSP; put code in src/webview/client.',
    },
    {
      selector: "JSXOpeningElement[name.name='style']",
      message: 'Inline styles are blocked by the webview CSP; add a stylesheet in src/webview/styles.',
    },
    ...(allowRawHtml ? [] : [{
      selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
      message: 'Raw HTML bypasses escaping; use JsonScript or InlineMarkdown from Page.tsx.',
    }]),
  ];
}

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
    files: ['**/*.ts', '**/*.tsx'],
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
    // Demo GIF recorder, a maintainer tool. Its page.evaluate callbacks run in the workbench, hence browser globals.
    files: ['scripts/demo-gifs/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  {
    // Webview views render under a nonce CSP: inline styles and handlers are blocked, and raw HTML bypasses escaping.
    files: ['src/webview/views/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...viewRestrictions()],
    },
  },
  {
    // The two helpers that emit pre-sanitised content are the only place raw HTML is allowed.
    files: ['src/webview/views/Page.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...viewRestrictions({ allowRawHtml: true })],
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
