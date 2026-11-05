// @mocha
/**
 * Tests src/utils/cachedComponentLookup.ts — turning an expanded component URL into its cache identity, and finding
 * the cache entry for the exact version a reference pins.
 *
 * Regression coverage for completion offering an input the referenced version had removed: when the cache held an
 * older version first, the version-blind lookup served that version's inputs.
 */

import * as assert from 'node:assert/strict';
import {
  parseComponentIdentity,
  findCachedComponentVersion,
  findAnyCachedComponentVersion,
} from '../../src/utils/cachedComponentLookup';
import type { CachedComponent } from '../../src/types/cache';

const entry = (version: string, inputs: string[], overrides: Partial<CachedComponent> = {}): CachedComponent => ({
  name: 'setup-tools',
  description: '',
  parameters: inputs.map(name => ({ name, description: '', required: false, type: 'string' })),
  source: 'gitlab.example.com/group/project',
  sourcePath: 'group/project',
  gitlabInstance: 'gitlab.example.com',
  version,
  url: `https://gitlab.example.com/group/project/setup-tools@${version}`,
  ...overrides,
});

// Prefixed tags, as used by projects that version each component separately.
const V2 = entry('setup-tools-2', ['removed_input', 'kept_input']);
const V3 = entry('setup-tools-3', ['kept_input']);

suite('parseComponentIdentity', () => {
  test('splits instance, project path, name and ref', () => {
    assert.deepStrictEqual(parseComponentIdentity('https://gitlab.example.com/group/project/setup-tools@setup-tools-3'), {
      gitlabInstance: 'gitlab.example.com',
      sourcePath: 'group/project',
      name: 'setup-tools',
      version: 'setup-tools-3',
    });
  });

  test('leaves version undefined when there is no @ref', () => {
    assert.strictEqual(parseComponentIdentity('https://gitlab.com/g/p/lint')?.version, undefined);
  });

  test('treats a trailing @ as no ref', () => {
    assert.strictEqual(parseComponentIdentity('https://gitlab.com/g/p/lint@')?.version, undefined);
  });

  test('keeps a ref containing a slash intact', () => {
    assert.strictEqual(parseComponentIdentity('https://gitlab.com/g/p/lint@release/1.0')?.version, 'release/1.0');
  });

  test('uses the hostname, matching how fetched components are stored', () => {
    assert.strictEqual(parseComponentIdentity('https://gitlab.internal:8443/g/p/lint@1.0.0')?.gitlabInstance, 'gitlab.internal');
  });

  test('returns null for a URL with no project segment', () => {
    assert.strictEqual(parseComponentIdentity('https://gitlab.com/lint@1.0.0'), null);
  });

  test('returns null for an unparseable URL', () => {
    assert.strictEqual(parseComponentIdentity('gitlab.com/g/p/lint@1.0.0'), null);
  });
});

suite('findCachedComponentVersion', () => {
  const v3Ref = parseComponentIdentity('https://gitlab.example.com/group/project/setup-tools@setup-tools-3');

  test('returns the referenced version even when another version is cached first', () => {
    assert.ok(v3Ref);
    const found = findCachedComponentVersion([V2, V3], v3Ref);
    assert.strictEqual(found, V3);
    assert.deepStrictEqual(found.parameters.map(p => p.name), ['kept_input']);
  });

  test('returns undefined rather than another version when the referenced one is not cached', () => {
    assert.ok(v3Ref);
    assert.strictEqual(findCachedComponentVersion([V2], v3Ref), undefined);
  });

  test('matches nothing for a reference with no version', () => {
    const unpinned = parseComponentIdentity('https://gitlab.example.com/group/project/setup-tools');
    assert.ok(unpinned);
    assert.strictEqual(findCachedComponentVersion([V2, V3], unpinned), undefined);
  });

  test('does not match the same version of a different component, project or instance', () => {
    assert.ok(v3Ref);
    const others = [
      entry('setup-tools-3', [], { name: 'other' }),
      entry('setup-tools-3', [], { sourcePath: 'group/other' }),
      entry('setup-tools-3', [], { gitlabInstance: 'gitlab.com' }),
    ];
    assert.strictEqual(findCachedComponentVersion(others, v3Ref), undefined);
  });
});

suite('findAnyCachedComponentVersion', () => {
  test('returns a cached version of the component whatever version is referenced', () => {
    const ref = parseComponentIdentity('https://gitlab.example.com/group/project/setup-tools@missing');
    assert.ok(ref);
    assert.strictEqual(findAnyCachedComponentVersion([V2, V3], ref), V2);
  });

  test('returns undefined when no version of the component is cached', () => {
    const ref = parseComponentIdentity('https://gitlab.example.com/group/project/other@1.0.0');
    assert.ok(ref);
    assert.strictEqual(findAnyCachedComponentVersion([V2, V3], ref), undefined);
  });
});
