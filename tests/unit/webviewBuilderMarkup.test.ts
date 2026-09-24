// @mocha
/**
 * Source-level guards over the webview HTML builders in `componentBrowserProvider.ts`.
 *
 * The builders are private methods on a class that imports `vscode`, so the unit suite cannot call them. These read
 * the file as text instead — enough to catch markup faults that every other tool is blind to, because the HTML lives
 * inside template literals where `tsc`, eslint and stylelint all see an ordinary string.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROVIDER = path.resolve(
  __dirname, '..', '..', 'src', 'providers', 'componentBrowserProvider.ts',
);

/** Tag-open spans, e.g. `<pre class="a" id="b">`. Close tags and text between elements are ignored. */
function openingTags(source: string): string[] {
  return source.match(/<[a-zA-Z][^<>]*>/g) ?? [];
}

suite('componentBrowserProvider markup', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');

  test('no element carries the same attribute twice', () => {
    // `<pre class="error-raw" id="error-raw" class="is-hidden">` shipped in the fatal-error view: HTML5 keeps the
    // first `class` and drops the rest, so `is-hidden` never applied and the raw error rendered expanded, with the
    // toggle's label inverted from then on. Silent in every linter, and in the one view that cannot be triggered
    // deliberately to check by hand.
    const offenders: string[] = [];
    for (const tag of openingTags(source)) {
      const seen = new Set<string>();
      for (const [, name] of tag.matchAll(/(?:^|\s)([a-zA-Z-]+)=/g)) {
        if (seen.has(name)) {
          offenders.push(`${name} repeated in: ${tag.trim()}`);
        }
        seen.add(name);
      }
    }
    assert.deepEqual(offenders, [], `duplicate attributes:\n${offenders.join('\n')}`);
  });
});

suite('component details link handling', () => {
  const client = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'webview', 'client', 'componentDetails.ts'), 'utf8',
  );
  const provider = fs.readFileSync(PROVIDER, 'utf8');

  test('the client script never assigns a URL to a navigable property', () => {
    // Component metadata reaches this script by message and is attacker-influenced (`documentation_url` is set by
    // whoever publishes the component). Links are opened by the extension host instead, so there must be no sink here.
    assert.doesNotMatch(client, /\.(href|src|action)\s*=/);
    assert.doesNotMatch(client, /\b(location|window\.open)\b/);
  });

  test('the builder never interpolates a metadata URL into an href', () => {
    assert.doesNotMatch(provider, /href="\$\{[^}]*(documentationUrl|templateFileUrl|safeDocUrl|safeTemplateUrl)/);
  });
});
