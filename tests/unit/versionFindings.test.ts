// @mocha
/**
 * Pins the "newer component version available" findings: message, code, range, metadata, and the suggested edit the
 * extension's quick fix applies.
 */

import * as assert from 'node:assert/strict';
import { checkComponentVersions } from '../../src/core/validation/versionFindings';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';
import { resolverFor } from './support/fakeResolver';

const FILE = '/repo/.gitlab-ci.yml';

suite('checkComponentVersions', () => {
  const text = ['include:', '  - component: gitlab.com/group/proj/deploy@1.0.0', ''].join('\n');
  const input = {
    text,
    file: FILE,
    resolveReference: resolverFor({ kind: 'no-context' }),
    fetchVersions: async () => ['1.0.0', '1.2.0', '2.0.0-rc.1', 'main'],
  };

  teardown(restoreRuntime);

  test('reports the latest stable version with a suggested edit over the pinned ref', async () => {
    const range = { line: 1, startCol: 44, endCol: 49 };

    assert.deepStrictEqual(await checkComponentVersions(input), [{
      code: 'outdated-component-version',
      severity: 'warning',
      message: "A newer version of 'deploy' is available: 1.2.0 (current: 1.0.0).",
      file: FILE,
      range,
      metadata: {
        code: 'outdated-component-version',
        componentUrl: 'gitlab.com/group/proj/deploy@1.0.0',
        currentVersion: '1.0.0',
        latestVersion: '1.2.0',
      },
      suggestedEdits: [{ file: FILE, range, newText: '1.2.0', title: 'Update to 1.2.0' }],
    }]);
  });

  test('uses the versionCheck.severity setting', async () => {
    installFakeRuntime({ 'versionCheck.severity': 'information' });

    const [finding] = (await checkComponentVersions(input)) ?? [];
    assert.equal(finding.severity, 'information');
  });

  test('returns undefined when versionCheck.enabled is off', async () => {
    installFakeRuntime({ 'versionCheck.enabled': false });

    assert.equal(await checkComponentVersions(input), undefined);
  });
});
