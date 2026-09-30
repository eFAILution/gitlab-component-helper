// @mocha
/**
 * Tests src/webview/views/LoadingView.tsx through src/webview/render.ts — the first view rendered from TSX.
 */

import * as assert from 'node:assert/strict';
import { renderDocument } from '../../src/webview/render';
import { LoadingView } from '../../src/webview/views/LoadingView';

const PROPS = { cspSource: 'vscode-webview://test-origin', nonce: 'abc123', styleUri: 'https://x/loading.css' };

suite('LoadingView', () => {
  test('renders a complete document with the doctype first', () => {
    const doc = renderDocument(LoadingView, PROPS);
    assert.match(doc, /^<!doctype html><html lang="en"><head>/);
    assert.match(doc, /<\/body><\/html>$/);
  });

  test('carries the CSP and the stylesheet', () => {
    const doc = renderDocument(LoadingView, PROPS);
    assert.match(
      doc,
      /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; [^"]*script-src 'nonce-abc123';"/,
    );
    assert.match(doc, /<link rel="stylesheet" href="https:\/\/x\/loading.css"/);
  });

  test('escapes attribute values', () => {
    const doc = renderDocument(LoadingView, { ...PROPS, styleUri: '"><script>x</script>' });
    assert.doesNotMatch(doc, /<script>/);
    assert.match(doc, /href="&quot;>&lt;script>x&lt;\/script>"/);
  });
});
