'use strict';

/**
 * Mocha config for the unit-test suite.
 *
 * `tsx` (loaded via `require`) transparently handles TypeScript imports so tests can `require` or `import` `src/*.ts`
 * files directly without a separate emit step. The spec glob includes both `.ts` and `.js` so the suite can grow
 * either way.
 *
 * Reporter:
 *  - Locally → `spec` for readable terminal output.
 *  - In CI (`GITHUB_ACTIONS=true`) → Mocha's built-in `xunit` reporter, writing JUnit XML to `junit.xml`.
 *  - `MOCHA_REPORTER` env var overrides both, e.g. for debugging.
 */
const inCi = process.env.GITHUB_ACTIONS === 'true';
const override = process.env.MOCHA_REPORTER;

const reporter = override || (inCi ? 'xunit' : 'spec');

module.exports = {
  ui: 'tdd',
  timeout: 5000,
  reporter,
  'reporter-option': inCi && !override ? ['output=junit.xml'] : undefined,
  require: ['tsx/cjs'],
  extensions: ['ts', 'js'],
  spec: ['tests/unit/*.test.ts'],
};
