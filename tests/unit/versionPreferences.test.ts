// @mocha
/**
 * Tests src/providers/versionPreferences.ts — the per-component preference behind the Component Browser's
 * "Set as Default Version" and "Always Use Latest" context-menu items. How a preference combines with the default
 * ranking is covered by the `chooseComponentVersion` suite in componentBrowserTransform.test.ts.
 */

import * as assert from 'node:assert/strict';
import {
  LATEST_VERSION_PREFERENCE,
  isVersionPreferences,
  latestStableVersion,
  preferenceFor,
  resolvePreferredVersion,
  versionPreferenceKey,
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

const deploy = { name: 'deploy', sourcePath: 'group/project', gitlabInstance: 'gitlab.com' };
const deployKey = 'gitlab.com/group/project/deploy';

suite('versionPreferenceKey', () => {
  test('combines instance, project path and name', () => {
    assert.equal(versionPreferenceKey(deploy), deployKey);
  });

  test('separates same-named components in different projects and instances', () => {
    const keys = new Set([
      versionPreferenceKey(deploy),
      versionPreferenceKey({ ...deploy, sourcePath: 'group/other' }),
      versionPreferenceKey({ ...deploy, gitlabInstance: 'gitlab.example.com' }),
    ]);
    assert.equal(keys.size, 3);
  });
});

suite('isVersionPreferences', () => {
  test('accepts a map of strings', () => {
    assert.ok(isVersionPreferences({ [deployKey]: '1.2.0' }));
    assert.ok(isVersionPreferences({}));
  });

  test('rejects anything else a hand-edited setting could hold', () => {
    for (const value of [undefined, null, 'x', ['1.2.0'], { [deployKey]: 1 }]) {
      assert.equal(isVersionPreferences(value), false, JSON.stringify(value));
    }
  });
});

suite('preferenceFor', () => {
  test('returns the stored preference', () => {
    assert.equal(preferenceFor({ [deployKey]: '1.2.0' }, deploy), '1.2.0');
  });

  test('never matches an inherited key', () => {
    const inherited: Record<string, string> = Object.create({ [deployKey]: '1.2.0' });
    assert.equal(preferenceFor(inherited, deploy), undefined);
  });
});

suite('withVersionPreference', () => {
  test('records the preference and keeps other components', () => {
    assert.deepEqual(withVersionPreference({ other: '2.0.0' }, deployKey, '1.2.0'), { other: '2.0.0', [deployKey]: '1.2.0' });
  });

  test('a pinned version and latest replace each other', () => {
    const latest = withVersionPreference({ [deployKey]: '1.2.0' }, deployKey, LATEST_VERSION_PREFERENCE);
    assert.deepEqual(latest, { [deployKey]: LATEST_VERSION_PREFERENCE });
    assert.deepEqual(withVersionPreference(latest, deployKey, '1.2.0'), { [deployKey]: '1.2.0' });
  });

  test('does not mutate the configuration value', () => {
    const current = readonlyProxy({ [deployKey]: '1.2.0' });
    assert.deepEqual(withVersionPreference(current, deployKey, LATEST_VERSION_PREFERENCE), {
      [deployKey]: LATEST_VERSION_PREFERENCE,
    });
  });
});

suite('latestStableVersion', () => {
  test('compares numerically and accepts a v prefix', () => {
    assert.equal(latestStableVersion(['main', 'v1.9.0', 'v1.10.0'], deploy), 'v1.10.0');
  });

  test('skips pre-releases and branches', () => {
    assert.equal(latestStableVersion(['main', '1.2.0', '2.0.0-rc.1'], deploy), '1.2.0');
  });

  test('compares monorepo tags by their version and returns the full tag', () => {
    const monorepo = { ...deploy, tagPattern: '{name}-{version}' };
    assert.equal(latestStableVersion(['deploy-1.9.0', 'deploy-1.10.0', 'main'], monorepo), 'deploy-1.10.0');
  });

  test('returns undefined when nothing is stable semver', () => {
    assert.equal(latestStableVersion(['main', 'deploy-1.2.0'], deploy), undefined);
  });
});

suite('resolvePreferredVersion', () => {
  const available = ['main', '1.2.0', '1.10.0', '2.0.0-rc.1'];

  test('returns a pinned version that is available', () => {
    assert.equal(resolvePreferredVersion('1.2.0', available, deploy), '1.2.0');
  });

  test('ignores a pinned version that is no longer available', () => {
    assert.equal(resolvePreferredVersion('0.9.0', available, deploy), undefined);
  });

  test('resolves latest to the highest stable version', () => {
    assert.equal(resolvePreferredVersion(LATEST_VERSION_PREFERENCE, available, deploy), '1.10.0');
  });

  test('returns nothing without a preference', () => {
    assert.equal(resolvePreferredVersion(undefined, available, deploy), undefined);
  });
});
