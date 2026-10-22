// @mocha
/**
 * `getConfiguredFileGlobs` reads `additionalFileGlobs` through the runtime config port, so it loads and runs under
 * plain Node.
 */

import * as assert from 'node:assert/strict';
import {
  DEFAULT_GITLAB_CI_FILE_GLOBS,
  getConfiguredFileGlobs,
  invalidateFileGlobsCache,
} from '../../src/utils/gitlabCiFileMatcher';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

suite('getConfiguredFileGlobs', () => {
  teardown(() => {
    restoreRuntime();
    invalidateFileGlobsCache();
  });

  test('adds additionalFileGlobs from the runtime config to the defaults', () => {
    installFakeRuntime({ additionalFileGlobs: ['ci/*.yml'] });
    invalidateFileGlobsCache();

    const globs = getConfiguredFileGlobs();

    assert.ok(DEFAULT_GITLAB_CI_FILE_GLOBS.every((glob) => globs.includes(glob)));
    assert.ok(globs.includes('**/ci/*.yml'));
  });
});
