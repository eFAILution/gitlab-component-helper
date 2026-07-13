// @mocha
/**
 * Tests src/services/cache/sourceReconciliation.ts — the pure helper that maps a dynamically fetched component (whose
 * `source` is synthesized as `instance/path`) back onto the configured source it belongs to, so hover-fetched entries
 * merge into their source group instead of spawning a phantom top-level instance node in the component browser.
 */

import * as assert from 'node:assert/strict';
import { reconcileComponentSource } from '../../src/services/cache/sourceReconciliation';
import { CachedComponent } from '../../src/types/cache';
import { ComponentSource } from '../../src/types/api';

const dynamicComponent = (overrides: Partial<CachedComponent> = {}): CachedComponent => ({
  name: 'markdown-lint',
  description: 'Component/Project does not have a description',
  parameters: [],
  source: 'gitlab.com/yu-life/infrastructure/yulife-devops-shared-config',
  sourcePath: 'yu-life/infrastructure/yulife-devops-shared-config',
  gitlabInstance: 'gitlab.com',
  version: 'markdown-lint-1',
  url: '',
  ...overrides,
});

const configuredSource: ComponentSource = {
  name: 'yulife-devops-shared-config',
  path: 'yu-life/infrastructure/yulife-devops-shared-config',
  gitlabInstance: 'gitlab.com',
  type: 'project',
  tagPattern: '{name}-{version}',
};

suite('reconcileComponentSource', () => {
  test('adopts the configured source name when instance + path match', () => {
    const result = reconcileComponentSource(dynamicComponent(), [configuredSource]);
    assert.equal(result.source, 'yulife-devops-shared-config');
  });

  test('fills in the configured tagPattern when the component has none', () => {
    const result = reconcileComponentSource(dynamicComponent(), [configuredSource]);
    assert.equal(result.tagPattern, '{name}-{version}');
  });

  test('keeps a tagPattern already on the component over the configured one', () => {
    const result = reconcileComponentSource(
      dynamicComponent({ tagPattern: '{name}/{version}' }),
      [configuredSource],
    );
    assert.equal(result.tagPattern, '{name}/{version}');
  });

  test('leaves the component untouched when no source matches', () => {
    const component = dynamicComponent({ sourcePath: 'some/other/project' });
    const result = reconcileComponentSource(component, [configuredSource]);
    assert.equal(result.source, component.source);
    assert.equal(result.tagPattern, undefined);
  });

  test('does not match across different gitlab instances', () => {
    const component = dynamicComponent({ gitlabInstance: 'gitlab.example.com' });
    const result = reconcileComponentSource(component, [configuredSource]);
    assert.equal(result.source, component.source);
  });

  test('normalizes an https:// prefix on the configured instance before matching', () => {
    const result = reconcileComponentSource(dynamicComponent(), [
      { ...configuredSource, gitlabInstance: 'https://gitlab.com' },
    ]);
    assert.equal(result.source, 'yulife-devops-shared-config');
  });

  test('defaults a source with no gitlabInstance to gitlab.com', () => {
    const result = reconcileComponentSource(dynamicComponent(), [
      { name: configuredSource.name, path: configuredSource.path },
    ]);
    assert.equal(result.source, 'yulife-devops-shared-config');
  });
});
