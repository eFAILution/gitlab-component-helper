// @mocha
/**
 * Guards against publisher-controlled text being executed in the Component Browser.
 *
 * Component names, version tags and spec fields are set by whoever publishes the component, and git accepts quotes and
 * angle brackets in a tag name. The Component Browser's controls still bind with `onclick` attributes, so every value
 * that reaches one must be encoded for both of the contexts it passes through.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { handlerArg } from '../../src/webview/inlineMarkdown';

/** What the browser does to an attribute value before the handler's JavaScript sees it. */
function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Each of these is a legal git tag name (`git check-ref-format`), so a publisher can ship any of them. */
const HOSTILE = [
  `x'-alert(1)-'`,
  `x"-alert(1)-"`,
  `<img/src/onerror=alert(1)>`,
  `x\\'-alert(1)-\\'`,
  `x");alert(1);("`,
  `&quot;);alert(1);(&quot;`,
  `</script><script>alert(1)</script>`,
];

suite('handlerArg', () => {
  test('never leaves a raw quote or bracket in the attribute text', () => {
    for (const value of HOSTILE) {
      assert.doesNotMatch(handlerArg(value), /["'<>]/, `raw metacharacter for ${JSON.stringify(value)}`);
    }
  });

  test('decodes to exactly one string literal equal to the input', () => {
    // JSON string syntax is a subset of JavaScript string-literal syntax, so if the decoded text parses as a JSON
    // string equal to the input, the handler receives that value and nothing else runs.
    for (const value of [...HOSTILE, 'my-component', 'v1.2.3', '']) {
      assert.equal(JSON.parse(decodeAttribute(handlerArg(value))), value);
    }
  });

  test('treats undefined as an empty string', () => {
    assert.equal(JSON.parse(decodeAttribute(handlerArg(undefined))), '');
  });
});

suite('Component Browser client script', () => {
  const client = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'webview', 'client', 'componentBrowser.ts'),
    'utf8',
  );

  test('builds markup only through the escaping renderer', () => {
    // Every other assignment of HTML here interpolated a version or name. The markdown renderer escapes first.
    const assignments = client.match(/\.(innerHTML|outerHTML)\s*=.*$/gm) ?? [];
    const unsafe = assignments.filter(line => !/=\s*renderInlineMarkdown\(/.test(line));
    assert.deepEqual(unsafe, []);
    assert.doesNotMatch(client, /insertAdjacentHTML/);
  });

  test('never writes handler source text', () => {
    // `setAttribute('onclick', `…${version}…`)` puts the version inside JavaScript, which a quote breaks out of.
    assert.doesNotMatch(client, /setAttribute\(\s*['"`]on[a-z]+/);
  });

  test('refuses prototype keys when storing versions', () => {
    // `__proto__` is a legal file name and git tag; on a plain object it writes through to Object.prototype.
    assert.match(client, /UNSAFE_KEYS = new Set\(\['__proto__', 'constructor', 'prototype'\]\)/);
    // Exactly one write of a version entry, the one inside `storeVersion`, which checks the keys first.
    const writes = client.match(/window\.componentVersionData\[[^\]]+\]\[[^\]]+\]\s*=(?!=)/g) ?? [];
    assert.equal(writes.length, 1, 'version entries must be written through storeVersion');
  });
});
