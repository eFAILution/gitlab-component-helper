// @mocha
/**
 * Tests src/services/component/versionLookupShape.ts — the guard deciding whether a component can be used for a
 * version lookup. It previously required `url`, which the details panel's webview-rebuilt component never carries,
 * so Refresh Versions failed there for every component.
 */

import * as assert from 'node:assert/strict';
import { isVersionLookupShape } from '../../src/services/component/versionLookupShape';
import type { Component } from '../../src/providers/componentDetector';

/** The shape the details panel receives: a `ComponentVersion` plus name/version, with no `url`. */
const detailsPanelComponent: Component = {
  name: 'deploy',
  description: 'Deploy the thing',
  parameters: [],
  source: 'Test Source',
  sourcePath: 'group/monorepo',
  gitlabInstance: 'gitlab.com',
  version: 'deploy-1.0.0',
};

suite('isVersionLookupShape', () => {
  test('accepts the details panel component, which has no url', () => {
    assert.strictEqual('url' in detailsPanelComponent, false, 'fixture should model the missing url');
    assert.strictEqual(isVersionLookupShape(detailsPanelComponent), true);
  });

  test('accepts a component with no source, which the lookup never reads', () => {
    const { source: _source, ...withoutSource } = detailsPanelComponent;
    assert.strictEqual(isVersionLookupShape(withoutSource), true);
  });

  test('still accepts a fully populated cache entry', () => {
    const cached = { ...detailsPanelComponent, url: 'https://gitlab.com/group/monorepo/deploy@deploy-1.0.0' };
    assert.strictEqual(isVersionLookupShape(cached), true);
  });

  test('rejects a component with no sourcePath', () => {
    const { sourcePath: _sourcePath, ...withoutSourcePath } = detailsPanelComponent;
    assert.strictEqual(isVersionLookupShape(withoutSourcePath), false);
  });

  test('rejects a component with no gitlabInstance', () => {
    const { gitlabInstance: _gitlabInstance, ...withoutInstance } = detailsPanelComponent;
    assert.strictEqual(isVersionLookupShape(withoutInstance), false);
  });

  test('rejects a component with no version', () => {
    const { version: _version, ...withoutVersion } = detailsPanelComponent;
    assert.strictEqual(isVersionLookupShape(withoutVersion), false);
  });
});
