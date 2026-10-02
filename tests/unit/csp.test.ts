// @mocha
/**
 * Tests src/webview/csp.ts — the nonce and Content-Security-Policy every webview document is rendered with.
 */

import * as assert from 'node:assert/strict';
import { createNonce, cspPolicy } from '../../src/webview/csp';

const CSP_SOURCE = 'vscode-webview://test-origin';

suite('createNonce', () => {
  test('returns 32 characters from the nonce alphabet', () => {
    const nonce = createNonce();
    assert.equal(nonce.length, 32);
    assert.match(nonce, /^[A-Za-z0-9\-_]{32}$/);
  });

  test('returns a different value on each call', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));
    assert.equal(nonces.size, 50);
  });

  test('draws uniformly across the alphabet', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      for (const char of createNonce()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    const frequencies = [...counts.values()];
    const expected = (2000 * 32) / 64;
    assert.equal(counts.size, 64, 'every character in the alphabet should appear');
    assert.ok(
      Math.max(...frequencies) < expected * 1.15,
      `no character should be over-represented: max ${Math.max(...frequencies)} vs expected ${expected}`,
    );
  });
});

suite('cspPolicy', () => {
  test('denies everything by default', () => {
    assert.match(cspPolicy(CSP_SOURCE, 'abc123'), /default-src 'none'/);
  });

  test('admits scripts only with the supplied nonce', () => {
    const tag = cspPolicy(CSP_SOURCE, 'abc123');
    assert.match(tag, /script-src 'nonce-abc123'/);
    assert.doesNotMatch(tag, /script-src[^;]*'unsafe-inline'/);
  });

  test('admits styles from the webview origin but not inline', () => {
    const tag = cspPolicy(CSP_SOURCE, 'abc123');
    assert.match(tag, new RegExp(`style-src ${CSP_SOURCE}`));
    // Inline styles are what the external-stylesheet pattern exists to avoid; permitting them here would silently
    // undo it for every document built on this helper.
    assert.doesNotMatch(tag, /style-src[^;]*'unsafe-inline'/);
  });

  test('carries the webview origin and no markup', () => {
    // The policy is an attribute value; the view renders the meta tag around it.
    const policy = cspPolicy(CSP_SOURCE, 'abc123');
    assert.ok(policy.includes(CSP_SOURCE));
    assert.doesNotMatch(policy, /[<>"]/);
  });
});
