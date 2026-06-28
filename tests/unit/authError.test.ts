// @mocha
/**
 * Tests for the auth-error helpers used to keep an expired/invalid GitLab token from degrading into
 * spurious "unknown input" diagnostics. `isAuthError`/`extractStatusCode` are the single source of
 * truth that the HTTP client, component fetcher, and validation provider all branch on.
 */

import * as assert from 'node:assert/strict';
import { extractStatusCode, isAuthError } from '../../src/errors/guards';
import { NetworkError, GitLabComponentError, ErrorCode } from '../../src/errors/types';

suite('extractStatusCode', () => {
  test('reads statusCode from a NetworkError', () => {
    assert.equal(extractStatusCode(new NetworkError('nope', { statusCode: 401 })), 401);
  });

  test('reads a statusCode property off a plain error-shaped object', () => {
    assert.equal(extractStatusCode({ statusCode: 403 }), 403);
  });

  test('returns undefined when no status is present', () => {
    assert.equal(extractStatusCode(new Error('boom')), undefined);
    assert.equal(extractStatusCode('just a string'), undefined);
    assert.equal(extractStatusCode(undefined), undefined);
  });
});

suite('isAuthError', () => {
  test('true for a 401 NetworkError', () => {
    assert.equal(isAuthError(new NetworkError('expired', { statusCode: 401 })), true);
  });

  test('true for a 403 NetworkError', () => {
    assert.equal(isAuthError(new NetworkError('forbidden', { statusCode: 403 })), true);
  });

  test('true for an UNAUTHORIZED GitLabComponentError without a status', () => {
    assert.equal(isAuthError(new GitLabComponentError(ErrorCode.UNAUTHORIZED, 'no token')), true);
  });

  test('true for a raw object carrying a 401 statusCode', () => {
    assert.equal(isAuthError({ statusCode: 401 }), true);
  });

  test('false for a 404 NetworkError', () => {
    assert.equal(isAuthError(new NetworkError('missing', { statusCode: 404 })), false);
  });

  test('false for a 500 NetworkError', () => {
    assert.equal(isAuthError(new NetworkError('server', { statusCode: 500 })), false);
  });

  test('false for a generic error and non-error values', () => {
    assert.equal(isAuthError(new Error('boom')), false);
    assert.equal(isAuthError('401'), false);
    assert.equal(isAuthError(undefined), false);
  });
});
