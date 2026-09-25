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

  test('keys publisher-controlled names only into Maps', () => {
    // `__proto__` is a legal file name and git tag. On a plain object, `data[name][version] = …` with either set to it
    // writes through to Object.prototype; a Map has no such keys, so the class of bug is gone rather than filtered.
    assert.match(client, /const versionStore = readVersionData\(\)/);
    assert.match(client, /function readVersionData\(\): Map<string, Map<string, VersionEntry>>/);
    assert.doesNotMatch(client, /componentVersionData/, 'the old object-keyed store must not come back');
    const code = client.split('\n').filter(line => !/^\s*(\*|\/\/)/.test(line)).join('\n');
    assert.doesNotMatch(code, /\w+\[[^\]\n]+\]\[[^\]\n]+\]\s*=(?!=)/, 'no two-level bracket writes');
  });
});
