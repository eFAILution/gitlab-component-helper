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

/**
 * Inline code a webview builder must not emit. Every one of these is invisible to `tsc`, eslint, stylelint and CodeQL
 * while it lives in a template literal, and the document's nonce CSP blocks all but the first anyway.
 *
 * A `<script type="application/json">` block is data, not code, and is how a builder hands state to its client script
 * (see `getComponentDetailsHtml`), so it is allowed.
 */
const INLINE_CODE: Record<string, RegExp> = {
  'inline <script>': /<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>/g,
  'inline <style>': /<style[\s>]/g,
  'inline event handler': /\son[a-z]+\s*=\s*["'`]/gi,
  'inline style attribute': /\sstyle\s*=\s*["'`]/gi,
};

/**
 * Builders still being moved to external assets (#288), with the most of each kind they may carry. A ceiling rather
 * than an exemption: the count can only go down, and reaching zero fails the suite until the entry is deleted, so the
 * allowance cannot outlive the work it exists for.
 */
const NOT_YET_EXTRACTED: Record<string, Record<string, number>> = {
  getComponentBrowserHtml: {
    'inline <script>': 1,
    'inline <style>': 1,
    'inline event handler': 21,
    'inline style attribute': 5,
  },
};

/** Each `get…Html` builder's source, keyed by method name. */
function builderBodies(source: string): Map<string, string> {
  const declaration = /^ {2}(?:(?:private|public|protected)\s+)?(?:static\s+)?(?:async\s+)?([a-zA-Z_]\w*)\s*\(/gm;
  const methods = [...source.matchAll(declaration)].map(match => ({ name: match[1], start: match.index ?? 0 }));
  return new Map(
    methods
      .map((method, index) => [method.name, source.slice(method.start, methods[index + 1]?.start ?? source.length)] as const)
      .filter(([name]) => /^get\w+Html$/.test(name)),
  );
}

function countInlineCode(body: string): Record<string, number> {
  return Object.fromEntries(
    Object.entries(INLINE_CODE).map(([kind, pattern]) => [kind, (body.match(pattern) ?? []).length]),
  );
}

suite('webview builders emit no inline code', () => {
  const builders = builderBodies(fs.readFileSync(PROVIDER, 'utf8'));

  test('finds the builders it is meant to guard', () => {
    // If a rename or refactor moved them, every other test here would pass vacuously.
    assert.ok(builders.size >= 6, `expected at least 6 get…Html builders, found ${[...builders.keys()].join(', ')}`);
  });

  test('extracted builders carry no inline script, style or handlers', () => {
    const offenders = [...builders]
      .filter(([name]) => !(name in NOT_YET_EXTRACTED))
      .flatMap(([name, body]) => Object.entries(countInlineCode(body))
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${name}: ${count} × ${kind}`));
    assert.deepEqual(
      offenders,
      [],
      `move these into src/webview/client or src/webview/styles, where they are linted and type-checked:\n${offenders.join('\n')}`,
    );
  });

  test('builders not yet extracted only shrink', () => {
    for (const [name, ceilings] of Object.entries(NOT_YET_EXTRACTED)) {
      const body = builders.get(name);
      assert.ok(body, `${name} is listed in NOT_YET_EXTRACTED but no longer exists; delete the entry`);

      const counts = countInlineCode(body);
      for (const [kind, ceiling] of Object.entries(ceilings)) {
        assert.ok(
          counts[kind] <= ceiling,
          `${name} grew from ${ceiling} to ${counts[kind]} × ${kind}; put new code in an external asset instead`,
        );
      }

      const remaining = Object.values(counts).reduce((total, count) => total + count, 0);
      assert.notEqual(
        remaining,
        0,
        `${name} is fully extracted; delete its NOT_YET_EXTRACTED entry so the strict test covers it`,
      );
    }
  });
});
