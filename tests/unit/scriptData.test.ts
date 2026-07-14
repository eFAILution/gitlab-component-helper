// @mocha
/**
 * Tests src/webview/scriptData.ts — safe JSON serialization for data embedded in webview `<script>` blocks.
 * Component descriptions now come from third-party READMEs and version lists from third-party git tags, so
 * the `</script>` breakout regression below is load-bearing: a raw `JSON.stringify` would terminate the
 * script element and inject markup.
 */

import * as assert from 'node:assert/strict';
import { serializeForScript } from '../../src/webview/scriptData';

suite('serializeForScript', () => {
  test('neutralizes a </script> breakout in a string value', () => {
    const payload = '</script><img src=x onerror=alert(1)>';
    const out = serializeForScript({ description: payload });
    assert.ok(!out.includes('</script>'), 'must not contain a literal </script>');
    assert.ok(!out.includes('<'), 'every < must be escaped');
    assert.deepEqual(JSON.parse(out), { description: payload }, 'still round-trips to the original value');
  });

  test('escapes <, > and & as \\uXXXX', () => {
    assert.equal(serializeForScript('<>&'), '"\\u003c\\u003e\\u0026"');
  });

  test('leaves ordinary data unchanged and round-trippable', () => {
    const value = { versions: ['1.0.0', '1.2.3'], count: 3, ok: true };
    assert.deepEqual(JSON.parse(serializeForScript(value)), value);
  });

  test('a crafted git tag in a version array cannot break out', () => {
    const out = serializeForScript(['</script>', '1.0.0']);
    assert.ok(!out.includes('</script>'));
    assert.deepEqual(JSON.parse(out), ['</script>', '1.0.0']);
  });

  test('returns null for a non-serializable value', () => {
    assert.equal(serializeForScript(undefined), 'null');
  });
});
