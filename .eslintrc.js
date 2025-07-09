module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 6,
    sourceType: 'module',
  },
  env: {
    node: true,
    es2021: true,
  },
  extends: [
    '@typescript-eslint/recommended',
  ],
  plugins: [
    '@typescript-eslint',
  ],
  rules: {
    '@typescript-eslint/naming-convention': [
      'warn',
      {
        'selector': 'import',
        'format': ['camelCase', 'PascalCase']
      }
    ],
    '@typescript-eslint/semi': 'warn',
    'curly': 'warn',
    'eqeqeq': 'warn',
    'no-throw-literal': 'warn',
    'semi': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'warn',
  },
  ignorePatterns: [
    'out',
    'dist',
    '**/*.d.ts',
    'esbuild.js',
    'node_modules',
    '*.json',
    '*.yaml',
    '*.yml',
    '*.md',
    '*.sh',
    '.husky',
    'tests',
    '*.vsix',
  ],
};
