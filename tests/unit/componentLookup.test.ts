// @mocha
/**
 * The cache lookups validation uses: exact-version component lookup, and the entry used to fetch a component's
 * versions.
 */

import * as assert from 'node:assert/strict';
import { buildVersionLookup, findComponentInCache, parseComponentRef } from '../../src/core/validation/componentLookup';
import type { CachedComponent } from '../../src/types/cache';

const CACHED: CachedComponent = {
  name: 'deploy',
  description: 'Deploys',
  parameters: [{ name: 'env', description: 'Env', required: true, type: 'string' }],
  source: 'Shared CI',
  sourcePath: 'group/proj',
  gitlabInstance: 'gitlab.com',
  version: '1.0.0',
  url: 'https://gitlab.com/group/proj/deploy@1.0.0',
};

suite('componentLookup', () => {
  test('parseComponentRef treats a reference with no @ref as main', () => {
    assert.deepStrictEqual(parseComponentRef('https://gitlab.com/group/proj/deploy'), {
      gitlabInstance: 'gitlab.com',
      sourcePath: 'group/proj',
      name: 'deploy',
      version: 'main',
    });
    assert.equal(parseComponentRef('not a url'), null);
  });

  test('findComponentInCache returns only the referenced version, as a Component', () => {
    assert.deepStrictEqual(findComponentInCache([CACHED], 'https://gitlab.com/group/proj/deploy@1.0.0'), {
      name: 'deploy',
      description: 'Deploys',
      parameters: CACHED.parameters,
      version: '1.0.0',
      source: 'Shared CI',
      documentationUrl: undefined,
      context: { gitlabInstance: 'gitlab.com', path: 'group/proj' },
    });
    assert.equal(findComponentInCache([CACHED], 'https://gitlab.com/group/proj/deploy@2.0.0'), null);
  });

  test('buildVersionLookup reuses any cached version, else builds a minimal entry', async () => {
    const getCached = async () => [CACHED];

    assert.equal(await buildVersionLookup(getCached, 'https://gitlab.com/group/proj/deploy'), CACHED);
    assert.deepStrictEqual(await buildVersionLookup(getCached, 'https://gitlab.com/group/proj/build'), {
      name: 'build',
      description: '',
      parameters: [],
      source: 'gitlab.com/group/proj',
      sourcePath: 'group/proj',
      gitlabInstance: 'gitlab.com',
      version: 'main',
      url: 'https://gitlab.com/group/proj/build',
    });
  });

  test('buildVersionLookup does not read the cache for a URL it cannot parse', async () => {
    let reads = 0;
    const lookup = await buildVersionLookup(async () => {
      reads++;
      return [CACHED];
    }, 'nope');

    assert.equal(lookup, undefined);
    assert.equal(reads, 0);
  });
});
