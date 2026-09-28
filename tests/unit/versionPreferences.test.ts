// @mocha
/**
 * Tests src/providers/versionPreferences.ts — the single per-component preference behind the Component Browser's
 * "Set as Default Version" and "Always Use Latest" context-menu items, and how completion resolves it.
 */

import * as assert from 'node:assert/strict';
import {
  LATEST_VERSION_PREFERENCE,
  resolvePreferredVersion,
  withVersionPreference,
} from '../../src/providers/versionPreferences';

/**
 * Wrap an object so any write to it throws, standing in for VS Code's configuration values.
 *
 * @param target The object to wrap.
 * @returns A proxy that reads through to `target` and throws on set, delete, or define.
 */
function readonlyProxy<T extends object>(target: T): T {
  const refuse = (): never => {
    throw new TypeError('mutation of a configuration value');
  };
  return new Proxy(target, { set: refuse, deleteProperty: refuse, defineProperty: refuse });
}

suite('withVersionPreference', () => {
  test('records the preference and keeps other components', () => {
    assert.deepEqual(withVersionPreference({ build: '2.0.0' }, 'deploy', '1.2.0'), { build: '2.0.0', deploy: '1.2.0' });
  });

  test('a pinned version and latest replace each other', () => {
    const latest = withVersionPreference({ deploy: '1.2.0' }, 'deploy', LATEST_VERSION_PREFERENCE);
    assert.deepEqual(latest, { deploy: LATEST_VERSION_PREFERENCE });
    assert.deepEqual(withVersionPreference(latest, 'deploy', '1.2.0'), { deploy: '1.2.0' });
  });

  test('does not mutate the configuration value', () => {
    const current = readonlyProxy({ deploy: '1.2.0' });
    assert.deepEqual(withVersionPreference(current, 'deploy', LATEST_VERSION_PREFERENCE), {
      deploy: LATEST_VERSION_PREFERENCE,
    });
  });
});

suite('resolvePreferredVersion', () => {
  const available = ['main', '1.2.0', '1.10.0', '2.0.0-rc.1'];

  test('returns a pinned version that is available', () => {
    assert.equal(resolvePreferredVersion('1.2.0', available), '1.2.0');
  });

  test('ignores a pinned version that is no longer available', () => {
    assert.equal(resolvePreferredVersion('0.9.0', available), undefined);
  });

  test('resolves latest to the highest stable version, ahead of main', () => {
    assert.equal(resolvePreferredVersion(LATEST_VERSION_PREFERENCE, available), '1.10.0');
  });

  test('resolves latest to nothing when there is no stable version', () => {
    assert.equal(resolvePreferredVersion(LATEST_VERSION_PREFERENCE, ['main', 'deploy-1.2.0']), undefined);
  });

  test('returns nothing without a preference', () => {
    assert.equal(resolvePreferredVersion(undefined, available), undefined);
  });
});
