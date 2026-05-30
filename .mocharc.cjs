'use strict';

/**
 * Mocha config for the unit-test suite.
 *
 * `tsx` (loaded via `require`) transparently handles TypeScript imports so tests can `require` or `import` `src/*.ts`
 * files directly without a separate emit step. The spec glob includes both `.ts` and `.js` so the suite can grow
 * either way.
 *
 * Reporter defaults to `spec` for readable local output. In CI we switch to `mocha-reporter-gha` so failures surface
 * as inline GitHub annotations on the PR diff (file + line + message). The `MOCHA_REPORTER` env var overrides both,
 * e.g. for debugging.
 */
const reporter =
  process.env.MOCHA_REPORTER ||
  (process.env.GITHUB_ACTIONS === 'true' ? 'mocha-reporter-gha' : 'spec');

module.exports = {
  ui: 'tdd',
  timeout: 5000,
  reporter,
  require: ['tsx/cjs'],
  extensions: ['ts', 'js'],
  spec: ['tests/unit/url-parsing.test.ts'],
};
