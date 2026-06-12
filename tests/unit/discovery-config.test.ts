// @mocha
/**
 * Discovery Config Behavior Contract
 *
 * Imports the real pure helpers from src/services/component/discoveryConfig.ts and asserts the merge / clamp /
 * candidate-building / pattern-matching rules the extension relies on when discovering components in user repos.
 *
 * `readGlobalDiscoveryConfig` is the only function in that module that touches `vscode` and is exercised via the
 * extension-host suite — not here.
 */

import * as assert from 'node:assert/strict';
import {
  mergeDiscoveryConfig,
  clampDiscoveryConfig,
  buildTemplatePathCandidates,
  matchesFilePattern,
  DISCOVERY_LIMITS,
} from '../../src/services/component/discoveryConfig';

suite('mergeDiscoveryConfig', () => {
  test('falls back to hard defaults when nothing provided', () => {
    assert.deepStrictEqual(mergeDiscoveryConfig(undefined, undefined), {
      templateRoots: ['templates'],
      maxDepth: 1,
      filePatterns: ['*.yml', '*.yaml'],
      templateFileNames: ['template.yml', 'template.yaml'],
    });
  });

  test('uses global override when no source override', () => {
    const result = mergeDiscoveryConfig(
      { templateRoots: ['ci/components'], maxDepth: 2 },
      undefined,
    );
    assert.deepStrictEqual(result.templateRoots, ['ci/components']);
    assert.strictEqual(result.maxDepth, 2);
    assert.deepStrictEqual(result.filePatterns, ['*.yml', '*.yaml']);
  });

  test('source override wins over global; unspecified source fields still pull from global', () => {
    const result = mergeDiscoveryConfig(
      { templateRoots: ['global'], maxDepth: 1 },
      { templateRoots: ['source-specific'] },
    );
    assert.deepStrictEqual(result.templateRoots, ['source-specific']);
    assert.strictEqual(result.maxDepth, 1);
  });

  test('partial override does not bleed into other fields', () => {
    const result = mergeDiscoveryConfig({}, { maxDepth: 3 });
    assert.deepStrictEqual(result.templateRoots, ['templates']);
    assert.strictEqual(result.maxDepth, 3);
  });
});

suite('clampDiscoveryConfig', () => {
  test('caps maxDepth at the limit', () => {
    const result = clampDiscoveryConfig({
      templateRoots: ['templates'],
      maxDepth: 99,
      filePatterns: ['*.yml'],
      templateFileNames: ['template.yml'],
    });
    assert.strictEqual(result.maxDepth, DISCOVERY_LIMITS.maxDepth);
  });

  test('floors maxDepth at zero', () => {
    const result = clampDiscoveryConfig({
      templateRoots: ['templates'],
      maxDepth: -5,
      filePatterns: ['*.yml'],
      templateFileNames: ['template.yml'],
    });
    assert.strictEqual(result.maxDepth, 0);
  });

  test('coerces non-finite maxDepth to zero', () => {
    const result = clampDiscoveryConfig({
      templateRoots: ['templates'],
      maxDepth: Number.NaN,
      filePatterns: [],
      templateFileNames: [],
    });
    assert.strictEqual(result.maxDepth, 0);
  });

  test('limits templateRoots count and strips slashes', () => {
    const tooMany = Array.from({ length: 20 }, (_, i) => `/root${i}/`);
    const result = clampDiscoveryConfig({
      templateRoots: tooMany,
      maxDepth: 1,
      filePatterns: ['*.yml'],
      templateFileNames: ['template.yml'],
    });
    assert.strictEqual(result.templateRoots.length, DISCOVERY_LIMITS.templateRootsCount);
    result.templateRoots.forEach((root) => {
      assert.ok(!root.startsWith('/'), `expected no leading slash in "${root}"`);
      assert.ok(!root.endsWith('/'), `expected no trailing slash in "${root}"`);
    });
  });

  test('rejects path-traversal in templateRoots', () => {
    const result = clampDiscoveryConfig({
      templateRoots: ['../escape', 'templates'],
      maxDepth: 1,
      filePatterns: ['*.yml'],
      templateFileNames: [],
    });
    assert.deepStrictEqual(result.templateRoots, ['templates']);
  });

  test('rejects path globs in filePatterns', () => {
    const result = clampDiscoveryConfig({
      templateRoots: ['templates'],
      maxDepth: 1,
      filePatterns: ['*.yml', 'foo/*.yml', '../bad', '*.yaml'],
      templateFileNames: [],
    });
    assert.deepStrictEqual(result.filePatterns, ['*.yml', '*.yaml']);
  });

  test('dedupes templateRoots after normalization', () => {
    const result = clampDiscoveryConfig({
      templateRoots: ['templates', '/templates/', 'templates'],
      maxDepth: 1,
      filePatterns: ['*.yml'],
      templateFileNames: [],
    });
    assert.deepStrictEqual(result.templateRoots, ['templates']);
  });

  test('rejects templateFileNames containing slashes', () => {
    const result = clampDiscoveryConfig({
      templateRoots: ['templates'],
      maxDepth: 1,
      filePatterns: [],
      templateFileNames: ['template.yml', 'sub/template.yml'],
    });
    assert.deepStrictEqual(result.templateFileNames, ['template.yml']);
  });
});

suite('buildTemplatePathCandidates', () => {
  test('produces 4 default candidates matching legacy hardcoded set', () => {
    const config = clampDiscoveryConfig(mergeDiscoveryConfig(undefined, undefined));
    const candidates = buildTemplatePathCandidates('foo', config);
    assert.deepStrictEqual(candidates, [
      'templates/foo.yml',
      'templates/foo.yaml',
      'templates/foo/template.yml',
      'templates/foo/template.yaml',
    ]);
  });

  test('expands across multiple roots', () => {
    const candidates = buildTemplatePathCandidates('foo', {
      templateRoots: ['templates', 'ci/components'],
      maxDepth: 1,
      filePatterns: ['*.yml'],
      templateFileNames: ['template.yml'],
    });
    assert.deepStrictEqual(candidates, [
      'templates/foo.yml',
      'templates/foo/template.yml',
      'ci/components/foo.yml',
      'ci/components/foo/template.yml',
    ]);
  });

  test('skips non-extension patterns when building flat candidates', () => {
    const candidates = buildTemplatePathCandidates('foo', {
      templateRoots: ['templates'],
      maxDepth: 1,
      filePatterns: ['component.yml'],
      templateFileNames: ['template.yml'],
    });
    assert.deepStrictEqual(candidates, ['templates/foo/template.yml']);
  });
});

suite('matchesFilePattern', () => {
  test('matches glob extension', () => {
    assert.strictEqual(matchesFilePattern('foo.yml', ['*.yml']), true);
    assert.strictEqual(matchesFilePattern('foo.yaml', ['*.yml']), false);
  });

  test('matches exact filename', () => {
    assert.strictEqual(matchesFilePattern('component.yml', ['component.yml']), true);
    assert.strictEqual(matchesFilePattern('other.yml', ['component.yml']), false);
  });

  test('returns false for empty pattern list', () => {
    assert.strictEqual(matchesFilePattern('foo.yml', []), false);
  });
});
