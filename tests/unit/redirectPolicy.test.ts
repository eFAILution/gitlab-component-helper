// @mocha
/**
 * Tests for the credential-safe redirect policy the HTTP client applies before following a `Location`.
 * The security-critical guarantees are: the user's GitLab token (`PRIVATE-TOKEN`/`Authorization`) is never
 * replayed to a different origin, HTTPS is never silently downgraded to HTTP, and only genuine redirect
 * statuses are followed. These protect against token exfiltration when a moved component project's old
 * path is reclaimed by a third party.
 */

import * as assert from 'node:assert/strict';
import { NetworkError } from '../../src/errors/types';
import {
  planRedirect,
  stripCredentialHeaders,
  REDIRECT_STATUS_CODES,
} from '../../src/utils/redirectPolicy';

const BASE = 'https://gitlab.com/api/v4/projects/foo%2Fbar';

suite('planRedirect: non-redirect responses', () => {
  test('returns null for a 2xx status', () => {
    assert.equal(planRedirect(BASE, 200, undefined), null);
  });

  test('returns null for a 4xx status', () => {
    assert.equal(planRedirect(BASE, 404, 'https://gitlab.com/elsewhere'), null);
  });

  test('returns null for 304 Not Modified (a 3xx that is not a redirect)', () => {
    assert.equal(planRedirect(BASE, 304, undefined), null);
  });
});

suite('planRedirect: same-origin redirects keep credentials', () => {
  for (const status of REDIRECT_STATUS_CODES) {
    test(`HTTP ${status} to an absolute same-origin URL is followed without stripping`, () => {
      const plan = planRedirect(BASE, status, 'https://gitlab.com/api/v4/projects/newns%2Fbar');
      assert.ok(plan);
      assert.equal(plan.nextUrl, 'https://gitlab.com/api/v4/projects/newns%2Fbar');
      assert.equal(plan.stripCredentials, false);
    });
  }

  test('a relative Location resolves against the current URL and stays same-origin', () => {
    const plan = planRedirect(BASE, 302, '/api/v4/projects/999');
    assert.ok(plan);
    assert.equal(plan.nextUrl, 'https://gitlab.com/api/v4/projects/999');
    assert.equal(plan.stripCredentials, false);
  });

  test('same host on a non-default port is still same-origin when the port matches', () => {
    const plan = planRedirect('https://gitlab.example.com:8443/a', 302, 'https://gitlab.example.com:8443/b');
    assert.ok(plan);
    assert.equal(plan.stripCredentials, false);
  });
});

suite('planRedirect: cross-origin redirects strip credentials', () => {
  test('a different host is cross-origin', () => {
    const plan = planRedirect(BASE, 302, 'https://attacker.example/api/v4/projects/foo%2Fbar');
    assert.ok(plan);
    assert.equal(plan.nextUrl, 'https://attacker.example/api/v4/projects/foo%2Fbar');
    assert.equal(plan.stripCredentials, true);
  });

  test('a different port on the same host is cross-origin', () => {
    const plan = planRedirect('https://gitlab.example.com/a', 302, 'https://gitlab.example.com:9999/a');
    assert.ok(plan);
    assert.equal(plan.stripCredentials, true);
  });

  test('an HTTP→HTTPS upgrade to the same host is cross-origin (scheme differs) so credentials are stripped', () => {
    const plan = planRedirect('http://gitlab.example.com/a', 302, 'https://gitlab.example.com/a');
    assert.ok(plan);
    assert.equal(plan.stripCredentials, true);
  });
});

suite('planRedirect: malformed and unsafe redirects throw', () => {
  test('a redirect status with no Location throws', () => {
    assert.throws(() => planRedirect(BASE, 302, undefined), NetworkError);
  });

  test('a redirect status with an empty Location throws', () => {
    assert.throws(() => planRedirect(BASE, 301, '   '), NetworkError);
  });

  test('an HTTPS→HTTP downgrade is refused', () => {
    assert.throws(
      () => planRedirect(BASE, 302, 'http://gitlab.com/api/v4/projects/foo%2Fbar'),
      NetworkError
    );
  });
});

suite('stripCredentialHeaders', () => {
  test('removes Authorization, PRIVATE-TOKEN, and Cookie', () => {
    const stripped = stripCredentialHeaders({
      'User-Agent': 'VSCode-GitLabComponentHelper',
      'PRIVATE-TOKEN': 'glpat-secret',
      Authorization: 'Bearer secret',
      Cookie: '_gitlab_session=abc',
      Accept: 'application/json',
    });
    assert.deepEqual(stripped, {
      'User-Agent': 'VSCode-GitLabComponentHelper',
      Accept: 'application/json',
    });
  });

  test('matches credential header names case-insensitively', () => {
    const stripped = stripCredentialHeaders({
      'private-token': 'glpat-secret',
      authorization: 'Bearer secret',
      'X-Keep': 'yes',
    });
    assert.deepEqual(stripped, { 'X-Keep': 'yes' });
  });

  test('returns an equivalent map when there is nothing to strip', () => {
    const headers = { 'User-Agent': 'VSCode-GitLabComponentHelper' };
    assert.deepEqual(stripCredentialHeaders(headers), headers);
  });
});
