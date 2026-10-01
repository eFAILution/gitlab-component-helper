// @mocha
/**
 * Tests src/utils/componentReference.ts — building the scheme-less `include: component:` value GitLab accepts, and
 * turning it back into a parseable URL.
 */

import * as assert from 'node:assert/strict';
import {
  buildComponentReference,
  matchComponentValue,
  parseVersionCompletionPrefix,
  referenceToUrl,
} from '../../src/utils/componentReference';

suite('buildComponentReference', () => {
  test('joins instance, source path, name and version without a scheme', () => {
    assert.strictEqual(buildComponentReference('gitlab.com', 'group/project', 'lint', '1.0.0'), 'gitlab.com/group/project/lint@1.0.0');
  });

  test('omits the @ when no version is given', () => {
    assert.strictEqual(buildComponentReference('gitlab.example.com', 'g/p', 'lint'), 'gitlab.example.com/g/p/lint');
  });

  test('uses $CI_SERVER_FQDN when the component is on the repository\'s own instance', () => {
    assert.strictEqual(
      buildComponentReference('gitlab.com', 'g/p', 'lint', '1.0.0', 'gitlab.com'),
      '$CI_SERVER_FQDN/g/p/lint@1.0.0',
    );
  });

  test('compares hosts case-insensitively', () => {
    assert.strictEqual(buildComponentReference('GitLab.com', 'g/p', 'lint', '1.0.0', 'gitlab.com'), '$CI_SERVER_FQDN/g/p/lint@1.0.0');
  });

  test('keeps the literal host for a component on another instance', () => {
    assert.strictEqual(
      buildComponentReference('gitlab.com', 'g/p', 'lint', '1.0.0', 'gitlab.example.com'),
      'gitlab.com/g/p/lint@1.0.0',
    );
  });
});

suite('referenceToUrl', () => {
  test('prefixes https:// so the reference parses as a URL', () => {
    const url = new URL(referenceToUrl('gitlab.com/g/p/c@1.0.0'));
    assert.strictEqual(url.hostname, 'gitlab.com');
    assert.strictEqual(url.pathname, '/g/p/c@1.0.0');
  });
});

suite('matchComponentValue', () => {
  test('extracts a list-item value and its start column', () => {
    assert.deepStrictEqual(matchComponentValue('  - component: gitlab.com/g/p/c@1.0'), {
      value: 'gitlab.com/g/p/c@1.0',
      start: 15,
    });
  });

  test('strips double and single quotes, starting after the opening quote', () => {
    assert.deepStrictEqual(matchComponentValue('  - component: "gitlab.com/g/p/c@1.0"'), {
      value: 'gitlab.com/g/p/c@1.0',
      start: 16,
    });
    assert.deepStrictEqual(matchComponentValue("    component: '$CI_SERVER_FQDN/g/p/c@1'"), {
      value: '$CI_SERVER_FQDN/g/p/c@1',
      start: 16,
    });
  });

  test('stops before a trailing comment', () => {
    assert.strictEqual(matchComponentValue('  - component: gitlab.com/g/p/c@1.0 # pinned')?.value, 'gitlab.com/g/p/c@1.0');
  });

  test('ignores lines that are not a component entry', () => {
    assert.strictEqual(matchComponentValue('  - local: templates/a.yml'), null);
    assert.strictEqual(matchComponentValue('# component: gitlab.com/g/p/c@1.0'), null);
  });
});

suite('parseVersionCompletionPrefix', () => {
  test('matches a scheme-less reference', () => {
    assert.deepStrictEqual(parseVersionCompletionPrefix('  - component: gitlab.com/g/p/c@1.'), {
      base: 'gitlab.com/g/p/c',
      partialVersion: '1.',
    });
  });

  test('matches an empty partial version', () => {
    assert.deepStrictEqual(parseVersionCompletionPrefix('  - component: gitlab.com/g/p/c@'), {
      base: 'gitlab.com/g/p/c',
      partialVersion: '',
    });
  });

  test('tolerates an opening quote', () => {
    assert.deepStrictEqual(parseVersionCompletionPrefix(`  - component: "gitlab.com/g/p/c@v2`), {
      base: 'gitlab.com/g/p/c',
      partialVersion: 'v2',
    });
  });

  test('ignores an @ outside a component value', () => {
    assert.strictEqual(parseVersionCompletionPrefix('    script: git config user.email me@'), null);
  });

  test('returns references with GitLab variables as written, for the caller to expand', () => {
    assert.deepStrictEqual(parseVersionCompletionPrefix('  - component: $CI_SERVER_FQDN/g/p/c@1'), {
      base: '$CI_SERVER_FQDN/g/p/c',
      partialVersion: '1',
    });
    assert.deepStrictEqual(parseVersionCompletionPrefix('  - component: ${CI_SERVER_FQDN}/g/p/c@'), {
      base: '${CI_SERVER_FQDN}/g/p/c',
      partialVersion: '',
    });
  });
});
