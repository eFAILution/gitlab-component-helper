// @mocha
/**
 * Tests src/webview/safeUrl.ts — the check a component-metadata URL passes before the details panel shows or opens it.
 */

import * as assert from 'node:assert/strict';
import { safeHttpUrl } from '../../src/webview/safeUrl';

suite('safeHttpUrl', () => {
  test('accepts http and https, returning the normalised URL', () => {
    assert.equal(safeHttpUrl('https://gitlab.com/group/project'), 'https://gitlab.com/group/project');
    assert.equal(safeHttpUrl('http://gitlab.example.com'), 'http://gitlab.example.com/');
    assert.equal(safeHttpUrl('  https://gitlab.com/x  '), 'https://gitlab.com/x');
  });

  test('rejects every script-bearing or non-web scheme', () => {
    for (const value of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\nscript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'vscode:extension/foo',
      'command:workbench.action.terminal.new',
    ]) {
      assert.equal(safeHttpUrl(value), undefined, `should reject ${JSON.stringify(value)}`);
    }
  });

  test('rejects relative and protocol-relative URLs, which would resolve against the webview origin', () => {
    assert.equal(safeHttpUrl('//evil.example.com/x'), undefined);
    assert.equal(safeHttpUrl('/-/blob/main/x.yml'), undefined);
  });

  test('rejects embedded credentials, which disguise the real host', () => {
    // Reads as a gitlab.com link; resolves to evil.example.
    assert.equal(safeHttpUrl('https://gitlab.com@evil.example/'), undefined);
    assert.equal(safeHttpUrl('https://user:pass@gitlab.com/'), undefined);
  });

  test('returns the parsed form, so the displayed and opened URL is the validated one', () => {
    const result = safeHttpUrl('https://gitlab.com/a b');
    assert.equal(result, 'https://gitlab.com/a%20b');
  });

  test('rejects empty and non-string input', () => {
    for (const value of [undefined, null, '', '   ', 42, {}]) {
      assert.equal(safeHttpUrl(value), undefined);
    }
  });
});
