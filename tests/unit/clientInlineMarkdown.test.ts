// @mocha
/**
 * Tests src/webview/clientInlineMarkdown.ts — the browser-side twin of `renderInlineMarkdown`, injected into webview
 * scripts as source text. Evaluating that text is the only way to catch escaping faults: the function is built by a
 * template literal and parsed again by the browser, so a pattern can be valid in the TypeScript source and invalid
 * by the time it reaches `RegExp`.
 */

import * as assert from 'node:assert/strict';
import { clientRenderInlineMarkdownSource } from '../../src/webview/clientInlineMarkdown';
import { renderInlineMarkdown } from '../../src/webview/inlineMarkdown';

/** Evaluate the emitted source the way a webview does, and hand back the function it declares. */
function loadClientRenderer(): (text: string) => string {
  return new Function(`${clientRenderInlineMarkdownSource()}; return renderInlineMarkdown;`)();
}

suite('clientRenderInlineMarkdownSource', () => {
  test('the emitted source evaluates and its patterns compile', () => {
    // Every pattern is built when the function body first runs, so an invalid one throws here rather than on a
    // particular input.
    const render = loadClientRenderer();
    assert.equal(typeof render, 'function');
    assert.doesNotThrow(() => render('plain text with no markup'));
  });

  test('renders a markdown link', () => {
    assert.equal(
      loadClientRenderer()('see [docs](https://example.com/x)'),
      'see <a href="https://example.com/x">docs</a>',
    );
  });

  test('renders code, bold and italic', () => {
    assert.equal(
      loadClientRenderer()('use `x` and **y** and *z*'),
      'use <code>x</code> and <strong>y</strong> and <em>z</em>',
    );
  });

  test('escapes HTML-significant characters', () => {
    assert.equal(
      loadClientRenderer()(`<script>alert("x")</script> & 'q'`),
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;',
    );
  });

  test('matches the server renderer across representative descriptions', () => {
    const render = loadClientRenderer();
    const samples = [
      'CI Job template to deploy a service to an ECS cluster',
      'A [GitLab CI/CD component](https://example.com/c) that lints Dockerfiles using [hadolint](https://example.com/h)',
      'Installs the `yu-ci-tools` binary CLI',
      '**Bold** lead-in, *emphasis*, and a `code` span',
      'Ampersands & <angles> and "quotes"',
      '',
    ];

    for (const sample of samples) {
      assert.equal(render(sample), renderInlineMarkdown(sample), `mismatch for: ${sample}`);
    }
  });
});
