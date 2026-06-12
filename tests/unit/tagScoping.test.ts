// @mocha
/**
 * Tests src/services/component/tagScoping.ts — the pure helpers that turn a monorepo project's full tag list into a
 * per-component view via a configurable tag-version template (`{name}`/`{version}` tokens): scoping a project's tags
 * to one component and stripping each tag down to its `{version}` for display.
 *
 * Also covers the monorepo branch of componentBrowserTransform.selectDefaultVersion, which scores tags by the
 * template's `{version}` capture.
 */

import * as assert from 'node:assert/strict';
import {
  compileTagTemplate,
  scopeTagsToComponent,
  stripTagPrefix,
  DEFAULT_TAG_PATTERN,
} from '../../src/services/component/tagScoping';
import { selectDefaultVersion } from '../../src/providers/componentBrowserTransform';

// A realistic mixed tag list for a tag-per-component monorepo using the default `{name}-{version}` convention.
const ALL_TAGS = [
  'deploy-app-1',
  'deploy-app-1.0.0',
  'deploy-app-1.1.0',
  'deploy-app-2',
  'deploy-app-2.0.0',
  'deploy-app-2.1.0',
  'run-job-1',
  'run-job-1.0.0',
  'push-artifact-1.0.0',
  'push-artifact-4.0.0',
  'build-image-4',
  'build-image-4.0.0',
];

suite('scopeTagsToComponent — default template', () => {
  test('keeps only the tags belonging to the component', () => {
    assert.deepStrictEqual(scopeTagsToComponent(ALL_TAGS, 'deploy-app'), [
      'deploy-app-1',
      'deploy-app-1.0.0',
      'deploy-app-1.1.0',
      'deploy-app-2',
      'deploy-app-2.0.0',
      'deploy-app-2.1.0',
    ]);
  });

  test('digit-anchored {version} stops a shorter name capturing a longer sibling component', () => {
    // `build-image` must NOT pick up `build-image-extra-1.0.0`: the char after the prefix is `e`, not a digit.
    const tags = ['build-image-4.0.0', 'build-image-extra-1.0.0', 'build-image-4'];
    assert.deepStrictEqual(scopeTagsToComponent(tags, 'build-image'), [
      'build-image-4.0.0',
      'build-image-4',
    ]);
  });

  test('returns empty when no tags match', () => {
    assert.deepStrictEqual(scopeTagsToComponent(ALL_TAGS, 'no-such-component'), []);
  });
});

suite('scopeTagsToComponent — custom templates', () => {
  test('apps/{name}/v{version} layout', () => {
    const tags = ['apps/web/v1.0.0', 'apps/web/v2.0.0', 'apps/api/v1.0.0', 'apps/web/vbeta'];
    // `vbeta` fails the digit anchor (char after `v` is `b`), so it is excluded.
    assert.deepStrictEqual(scopeTagsToComponent(tags, 'web', 'apps/{name}/v{version}'), [
      'apps/web/v1.0.0',
      'apps/web/v2.0.0',
    ]);
  });

  test('{name}_{version} separator', () => {
    const tags = ['web_1.0.0', 'web_2.0.0', 'web-extra_1.0.0', 'api_1.0.0'];
    assert.deepStrictEqual(scopeTagsToComponent(tags, 'web', '{name}_{version}'), ['web_1.0.0', 'web_2.0.0']);
  });

  test('regex metacharacters in literals and names are escaped', () => {
    // A `.` in the template literal must match a literal dot, not any char; a name with regex chars is escaped too.
    const tags = ['c++.1.0.0', 'cXX.1.0.0'];
    assert.deepStrictEqual(scopeTagsToComponent(tags, 'c++', '{name}.{version}'), ['c++.1.0.0']);
  });
});

suite('compileTagTemplate', () => {
  test('returns null for a template missing {version}', () => {
    assert.strictEqual(compileTagTemplate('{name}-only', 'web'), null);
  });

  test('falls back to the default template when none is given', () => {
    const matcher = compileTagTemplate(undefined, 'web');
    assert.ok(matcher);
    assert.strictEqual(matcher.matches('web-1.0.0'), true);
    assert.strictEqual(DEFAULT_TAG_PATTERN, '{name}-{version}');
  });

  test('extractVersion returns the {version} capture or null', () => {
    const matcher = compileTagTemplate('apps/{name}/v{version}', 'web');
    assert.ok(matcher);
    assert.strictEqual(matcher.extractVersion('apps/web/v1.2.3'), '1.2.3');
    assert.strictEqual(matcher.extractVersion('apps/api/v1.2.3'), null);
  });
});

suite('stripTagPrefix', () => {
  test('returns the {version} portion under the default template', () => {
    assert.strictEqual(stripTagPrefix('deploy-app-1.1.0', 'deploy-app'), '1.1.0');
    assert.strictEqual(stripTagPrefix('build-image-4', 'build-image'), '4');
  });

  test('returns the {version} portion under a custom template', () => {
    assert.strictEqual(stripTagPrefix('apps/web/v2.0.0', 'web', 'apps/{name}/v{version}'), '2.0.0');
  });

  test('passes non-matching strings through unchanged', () => {
    assert.strictEqual(stripTagPrefix('main', 'build-image'), 'main');
  });
});

suite('selectDefaultVersion — monorepo', () => {
  const scoped = scopeTagsToComponent(ALL_TAGS, 'deploy-app');

  test('picks the highest full semver (scored by {version}), returning the full tag', () => {
    const chosen = selectDefaultVersion(scoped, 'main', { name: 'deploy-app' });
    assert.strictEqual(chosen, 'deploy-app-2.1.0');
  });

  test('works with a custom template', () => {
    const tags = ['apps/web/v1.0.0', 'apps/web/v2.3.0', 'apps/web/v2.1.0'];
    const chosen = selectDefaultVersion(tags, 'main', { name: 'web', tagPattern: 'apps/{name}/v{version}' });
    assert.strictEqual(chosen, 'apps/web/v2.3.0');
  });

  test('without a monorepo component the tags score 0 (regression guard for the flag plumbing)', () => {
    // Full prefixed tags fail the bare-semver regex, so the reduce keeps the first element.
    const chosen = selectDefaultVersion(scoped, 'main');
    assert.strictEqual(chosen, scoped[0]);
  });
});
