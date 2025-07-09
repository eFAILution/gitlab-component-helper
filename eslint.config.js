const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Add browser and node globals
        console: 'readonly',
        URL: 'readonly',
        module: 'readonly',
        require: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'warn', // Downgrade unused vars to warnings
    },
    ignores: [
      // Files to ignore
      '**/*.d.ts',
      'node_modules/**',
      'out/**',
      '**/*.json',
      '.vscode-test/**'
    ]
  }
];
