// @mocha
/**
 * Tests src/webview/inlineMarkdown.ts — the escape + inline-Markdown renderer used for component
 * descriptions in webviews. Descriptions can now originate from a third-party README (see readmeDescription),
 * so the XSS regressions below are load-bearing: escaping must run before any tag is (re-)introduced, and
 * only `http(s)` links may become an href.
 */

import * as assert from 'node:assert/strict';
import { escapeHtml, renderInlineMarkdown } from '../../src/webview/inlineMarkdown';

suite('escapeHtml', () => {
  test('escapes all five significant characters', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });

  test('escapes & first so entities are not double-broken', () => {
    assert.equal(escapeHtml('a & <b>'), 'a &amp; &lt;b&gt;');
  });
});

suite('renderInlineMarkdown — formatting', () => {
  test('renders an http(s) link', () => {
    assert.equal(
      renderInlineMarkdown('see [docs](https://example.com/x)'),
      'see <a href="https://example.com/x">docs</a>',
    );
  });

  test('renders code, bold, and italic', () => {
    assert.equal(renderInlineMarkdown('use `x` and **y** and *z*'), 'use <code>x</code> and <strong>y</strong> and <em>z</em>');
  });

  test('leaves plain prose untouched', () => {
    assert.equal(renderInlineMarkdown('just some text.'), 'just some text.');
  });
});

suite('renderInlineMarkdown — XSS regressions', () => {
  test('escapes a raw script/img payload to inert text', () => {
    assert.equal(
      renderInlineMarkdown('<img src=x onerror=alert(1)>'),
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    assert.ok(!renderInlineMarkdown('<script>alert(1)</script>').includes('<script>'));
  });

  test('does not linkify a javascript: URL (http(s) only)', () => {
    const out = renderInlineMarkdown('[click](javascript:alert(1))');
    assert.ok(!out.includes('<a '), 'javascript: must not become an href');
    assert.ok(!out.toLowerCase().includes('href'));
  });

  test('does not linkify a data: URL', () => {
    const out = renderInlineMarkdown('[x](data:text/html,<script>alert(1)</script>)');
    assert.ok(!out.includes('<a '));
  });

  test('escapes a quote inside a link href so it cannot break out of the attribute', () => {
    const out = renderInlineMarkdown('[a](https://e/?q=")after');
    assert.ok(out.includes('&quot;'), 'the quote must be escaped');
    assert.ok(!/href="[^"]*"[^>]*"/.test(out), 'no stray closing quote that escapes the attribute');
  });

  test('does not reinterpret $-sequences from the content as replacement patterns', () => {
    // `$1` / `$&` in a *link label* would be dangerous only if content were used as a replacement string;
    // here content is only ever the replace *subject*, so the sequences stay literal (with `&` escaped as usual).
    assert.equal(renderInlineMarkdown('[$1 and $&](https://e/x)'), '<a href="https://e/x">$1 and $&amp;</a>');
    assert.equal(renderInlineMarkdown('plain $1 $& text'), 'plain $1 $&amp; text');
  });
});
