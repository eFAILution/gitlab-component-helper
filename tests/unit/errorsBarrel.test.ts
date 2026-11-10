// @mocha
/**
 * The errors barrel must load from plain Node (no `vscode` module) so pure modules and the
 * standalone MCP server can import it. This suite runs without a `vscode` stub, so a
 * vscode-dependent re-export in `src/errors/index.ts` aborts the run with
 * "Cannot find module 'vscode'" at load time.
 */

import * as assert from 'node:assert/strict';
import * as errors from '../../src/errors';

suite('errors barrel', () => {
  test('re-exports the error types and guards consumers rely on', () => {
    assert.equal(typeof errors.NetworkError, 'function');
    assert.equal(typeof errors.isAuthError, 'function');
    assert.equal(typeof errors.extractStatusCode, 'function');
  });

  test('a 408 timeout NetworkError carries its status and is not an auth error', () => {
    const timeout = new errors.NetworkError('Request timeout', { statusCode: 408 });

    assert.equal(errors.extractStatusCode(timeout), 408);
    assert.equal(errors.isAuthError(timeout), false);
  });
});
