// @mocha
/**
 * Tests the pure helpers in src/providers/localIncludeParser.ts: line-level extraction of `include: - local:` paths,
 * recognition of the synthetic `local://` URL prefix, and the unsupported-path predicate (globs and `..` segments).
 */

import * as assert from 'node:assert/strict';
import {
  LOCAL_COMPONENT_URL_PREFIX,
  extractLocalIncludePath,
  isLocalComponentUrl,
  buildLocalComponentUrl,
  isUnsupportedLocalPath,
} from '../../src/providers/localIncludeParser';

suite('extractLocalIncludePath', () => {
  const positiveCases: Array<{ name: string; line: string; expected: string }> = [
    {
      name: 'double-quoted path with list dash',
      line: '    - local: "gitlab/templates/nx-test/template.yml"',
      expected: 'gitlab/templates/nx-test/template.yml',
    },
    {
      name: 'single-quoted path',
      line: "    - local: 'configs/build.yml'",
      expected: 'configs/build.yml',
    },
    {
      name: 'unquoted path',
      line: '    - local: gitlab/templates/nx-test/template.yml',
      expected: 'gitlab/templates/nx-test/template.yml',
    },
    {
      name: 'leading-slash path is preserved',
      line: '    - local: "/gitlab/templates/nx-test/template.yml"',
      expected: '/gitlab/templates/nx-test/template.yml',
    },
    {
      name: 'no list dash (single-include shorthand)',
      line: 'local: "ci/main.yml"',
      expected: 'ci/main.yml',
    },
    {
      name: 'trailing whitespace tolerated',
      line: '    - local: "ci/main.yml"   ',
      expected: 'ci/main.yml',
    },
  ];
  for (const c of positiveCases) {
    test(c.name, () => {
      assert.strictEqual(extractLocalIncludePath(c.line), c.expected);
    });
  }

  const negativeCases: Array<{ name: string; line: string }> = [
    { name: '`component:` line is not a local include', line: '    - component: $CI_SERVER_FQDN/group/comp@1.0.0' },
    { name: '`project:` line is not a local include', line: '    - project: "my-group/my-project"' },
    { name: '`remote:` line is not a local include', line: '    - remote: "https://example.com/ci.yml"' },
    { name: 'empty line', line: '' },
    { name: 'comment containing `local:` is not a match', line: '    # local: not a real include' },
  ];
  for (const c of negativeCases) {
    test(c.name, () => {
      assert.strictEqual(extractLocalIncludePath(c.line), null);
    });
  }
});

suite('isLocalComponentUrl', () => {
  test('matches the `local://` prefix', () => {
    assert.strictEqual(isLocalComponentUrl('local://ci/main.yml'), true);
  });

  test('rejects remote https URLs', () => {
    assert.strictEqual(isLocalComponentUrl('https://gitlab.com/components/foo@1.0.0'), false);
  });

  test('treats undefined as not-local', () => {
    assert.strictEqual(isLocalComponentUrl(undefined), false);
  });

  test('treats empty string as not-local', () => {
    assert.strictEqual(isLocalComponentUrl(''), false);
  });
});

suite('buildLocalComponentUrl', () => {
  test('prefixes a clean relative path with the canonical scheme', () => {
    assert.strictEqual(buildLocalComponentUrl('ci/main.yml'), `${LOCAL_COMPONENT_URL_PREFIX}ci/main.yml`);
  });

  test('strips a single leading slash so `local:///x` never appears', () => {
    assert.strictEqual(buildLocalComponentUrl('/ci/main.yml'), `${LOCAL_COMPONENT_URL_PREFIX}ci/main.yml`);
  });

  test('strips multiple leading slashes', () => {
    assert.strictEqual(buildLocalComponentUrl('////ci/main.yml'), `${LOCAL_COMPONENT_URL_PREFIX}ci/main.yml`);
  });
});

suite('isUnsupportedLocalPath', () => {
  test('accepts a plain relative path', () => {
    assert.strictEqual(isUnsupportedLocalPath('ci/main.yml'), false);
  });

  test('rejects glob metacharacters (`*`, `?`, character classes, braces)', () => {
    assert.strictEqual(isUnsupportedLocalPath('ci/*.yml'), true);
    assert.strictEqual(isUnsupportedLocalPath('ci/main?.yml'), true);
    assert.strictEqual(isUnsupportedLocalPath('ci/main[0-9].yml'), true);
    assert.strictEqual(isUnsupportedLocalPath('ci/{a,b}.yml'), true);
  });

  test('rejects `..` path-traversal segments', () => {
    assert.strictEqual(isUnsupportedLocalPath('../escape.yml'), true);
    assert.strictEqual(isUnsupportedLocalPath('ci/../escape.yml'), true);
  });

  test('accepts paths that merely contain `..` inside a segment', () => {
    // The check is on `segment === '..'`, not substring, so `..foo` is not traversal.
    assert.strictEqual(isUnsupportedLocalPath('ci/..foo.yml'), false);
  });
});
