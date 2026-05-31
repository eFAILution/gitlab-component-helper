const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = [
  {
    ignores: [
      '**/*.d.ts',
      'node_modules/**',
      'out/**',
      'out-test/**',
      'dist/**',
      '.vscode-test/**',
      '**/*.json',
      '**/*.yaml',
      '**/*.yml',
      '**/*.md',
      '**/*.sh',
      '.husky/**',
      'tests/**',
      'esbuild.js',
      'scripts/**',
      'src/services/cache/validate.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      curly: 'off',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      'no-useless-assignment': 'warn',
      'no-prototype-builtins': 'warn',
    },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        URL: 'readonly',
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
    },
  },
];
