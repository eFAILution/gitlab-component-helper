// @mocha
/**
 * Unit tests for the clean-semver helpers in src/utils/semver.ts — the comparison core of the component
 * version-check feature. Covers what counts as clean semver (and the many things that deliberately don't),
 * numeric ordering, latest-stable selection, and the outdated predicate.
 */

import * as assert from 'node:assert/strict';
import {
  parseSemver,
  isCleanSemver,
  compareSemver,
  getLatestStableSemver,
  isOutdated,
} from '../../src/utils/semver';

suite('isCleanSemver', () => {
  test('accepts X.Y.Z with and without a v prefix', () => {
    assert.equal(isCleanSemver('1.2.3'), true);
    assert.equal(isCleanSemver('v1.2.3'), true);
    assert.equal(isCleanSemver('0.0.0'), true);
    assert.equal(isCleanSemver('  1.2.3  '), true); // surrounding whitespace tolerated
  });

  test('rejects floating refs, partials, pre-releases, and SHAs', () => {
    for (const ref of ['main', 'latest', '~latest', '1', '1.2', 'v1', '1.2.3-rc.1', '1.2.3+build', 'a1b2c3d', '']) {
      assert.equal(isCleanSemver(ref), false, `${ref} should not be clean semver`);
    }
  });
});

suite('parseSemver', () => {
  test('splits into numeric parts', () => {
    assert.deepEqual(parseSemver('v2.10.4'), { major: 2, minor: 10, patch: 4 });
  });

  test('returns null for non-semver', () => {
    assert.equal(parseSemver('1.2'), null);
  });
});

suite('compareSemver', () => {
  test('orders by major, then minor, then patch', () => {
    assert.ok((compareSemver('2.0.0', '1.9.9') ?? 0) > 0);
    assert.ok((compareSemver('1.2.0', '1.10.0') ?? 0) < 0); // numeric, not lexical
    assert.ok((compareSemver('1.2.3', '1.2.4') ?? 0) < 0);
  });

  test('treats equal versions as equal regardless of v prefix', () => {
    assert.equal(compareSemver('1.2.3', 'v1.2.3'), 0);
  });

  test('returns null when either side is not clean semver', () => {
    assert.equal(compareSemver('1.2.3', 'main'), null);
    assert.equal(compareSemver('latest', '1.2.3'), null);
  });
});

suite('getLatestStableSemver', () => {
  test('picks the highest clean semver, ignoring branches and pre-releases', () => {
    const refs = ['main', '1.0.0', 'v1.4.2', '1.2.0', '2.0.0-rc.1', 'develop'];
    assert.equal(getLatestStableSemver(refs), 'v1.4.2');
  });

  test('returns null when no clean semver is present', () => {
    assert.equal(getLatestStableSemver(['main', 'latest', '1.2']), null);
  });

  test('returns the ref verbatim (preserving prefix style)', () => {
    assert.equal(getLatestStableSemver(['1.0.0', 'v2.0.0']), 'v2.0.0');
  });
});

suite('isOutdated', () => {
  test('true only when current is strictly behind latest', () => {
    assert.equal(isOutdated('1.2.3', '1.5.0'), true);
    assert.equal(isOutdated('1.2.3', '1.2.3'), false);
    assert.equal(isOutdated('2.0.0', '1.9.9'), false);
  });

  test('false when either ref is not clean semver', () => {
    assert.equal(isOutdated('main', '1.5.0'), false);
    assert.equal(isOutdated('1.2.3', 'latest'), false);
  });
});
