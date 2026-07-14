/**
 * Tests src/utils/cachedComponentEquality.ts — the no-op guard the cache manager uses to decide whether re-adding an
 * (already identity-matched) dynamic component should fire its change notification.
 *
 * Regression coverage for the event-storm bug: validation re-adds identical entries on every open/change/save, and an
 * unconditional fire would re-request document links O(N) times per pass. `sameCachedComponent` returning true for an
 * identical re-add is what suppresses that.
 */

import * as assert from 'node:assert/strict';
import { sameCachedComponent } from '../../src/utils/cachedComponentEquality';
import type { CachedComponent } from '../../src/types/cache';

const base: CachedComponent = {
  name: 'deploy',
  description: 'deploy component',
  parameters: [],
  source: 'my-source',
  sourcePath: 'group/project',
  gitlabInstance: 'gitlab.com',
  version: '1.0.0',
  url: 'https://gitlab.com/group/project',
  templatePath: 'templates/deploy.yml',
  availableVersions: ['1.0.0', '1.1.0'],
  tagPattern: '{name}-{version}',
  resolvedSha: 'abc123',
};

const clone = (overrides: Partial<CachedComponent> = {}): CachedComponent => ({ ...base, ...overrides });

suite('sameCachedComponent', () => {
  test('an identical re-add is equal (suppresses the fire)', () => {
    assert.equal(sameCachedComponent(base, clone()), true);
  });

  test('ignores fields it does not compare (description, parameters)', () => {
    // These are not link-relevant; a change to them alone must not force a re-request.
    assert.equal(
      sameCachedComponent(base, clone({ description: 'changed', parameters: [{ name: 'x', description: '', required: false, type: 'string' }] })),
      true
    );
  });

  test('a changed templatePath is a real change (must fire)', () => {
    assert.equal(sameCachedComponent(base, clone({ templatePath: 'templates/other.yml' })), false);
  });

  test('templatePath appearing where there was none is a real change', () => {
    assert.equal(sameCachedComponent(clone({ templatePath: undefined }), base), false);
  });

  test('a changed url is a real change', () => {
    assert.equal(sameCachedComponent(base, clone({ url: 'https://gitlab.com/other' })), false);
  });

  test('a changed source (reconciled group name) is a real change', () => {
    assert.equal(sameCachedComponent(base, clone({ source: 'other-source' })), false);
  });

  test('a changed tagPattern is a real change', () => {
    assert.equal(sameCachedComponent(base, clone({ tagPattern: 'v{version}' })), false);
  });

  test('a moved branch HEAD (resolvedSha) is a real change', () => {
    assert.equal(sameCachedComponent(base, clone({ resolvedSha: 'def456' })), false);
  });

  test('a changed availableVersions list is a real change', () => {
    assert.equal(sameCachedComponent(base, clone({ availableVersions: ['1.0.0'] })), false);
  });

  test('availableVersions order matters (list identity, not set)', () => {
    assert.equal(sameCachedComponent(base, clone({ availableVersions: ['1.1.0', '1.0.0'] })), false);
  });
});
