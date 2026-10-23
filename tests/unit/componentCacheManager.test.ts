// @mocha
/**
 * `ComponentCacheManager` persists through the runtime storage port and loads under plain Node. With
 * `eagerRefresh: false` it reads the stored cache but never goes to the network on its own.
 */

import * as assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDefaultRuntime, getRuntime } from '../../src/core/runtime';
import { CACHE_KEY_COMPONENTS } from '../../src/constants/cache';
import {
  ComponentCacheManager,
  CURRENT_CACHE_VERSION,
  getComponentCacheManager,
} from '../../src/services/cache/componentCacheManager';
import { getComponentService } from '../../src/services/component';
import { Logger } from '../../src/utils/logger';
import type { CachedComponent, PersistentCacheData } from '../../src/types/cache';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

const COMPONENT: CachedComponent = {
  name: 'deploy',
  description: 'Deploys things',
  parameters: [{ name: 'stage', description: 'Stage', required: false, type: 'string', default: 'deploy' }],
  source: 'Shared CI',
  sourcePath: 'group/shared-ci',
  gitlabInstance: 'gitlab.com',
  version: '1.2.3',
  url: 'https://gitlab.com/group/shared-ci/deploy@1.2.3',
};

function storedCache(version: string): PersistentCacheData {
  return {
    components: [COMPONENT],
    lastRefreshTime: Date.now(),
    projectVersionsCache: { tags: [['gitlab.com/group/shared-ci', ['1.2.3']]], defaultBranches: [] },
    version,
  };
}

// The real module objects (an `import * as` namespace is read-only), so stubbing `request` reaches HttpClient.
const requireNode = createRequire(__filename);
const http: typeof import('node:http') = requireNode('node:http');
const https: typeof import('node:https') = requireNode('node:https');

/** Let the constructor's fire-and-forget load (storage reads, microtasks) finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

suite('ComponentCacheManager storage', () => {
  teardown(() => {
    installFakeRuntime();
    Logger.getInstance().reloadLogLevel();
    restoreRuntime();
  });

  test('loads a current cache from storage and writes the same shape back', async () => {
    installFakeRuntime({}, { storage: createDefaultRuntime().storage });
    const stored = storedCache(CURRENT_CACHE_VERSION);
    await getRuntime().storage.update(CACHE_KEY_COMPONENTS, stored);

    const manager = new ComponentCacheManager({ eagerRefresh: false });
    await settle();
    assert.equal(manager.getCacheInfo().size, 1);

    await getRuntime().storage.update(CACHE_KEY_COMPONENTS, undefined);
    manager.persistComponentState();
    await settle();

    assert.deepStrictEqual(await getRuntime().storage.get(CACHE_KEY_COMPONENTS), stored);
    manager.dispose();
  });

  test('discards a cache stored under an older schema version', async () => {
    const fake = installFakeRuntime({ logLevel: 'INFO' }, { storage: createDefaultRuntime().storage });
    Logger.getInstance().reloadLogLevel();
    await getRuntime().storage.update(CACHE_KEY_COMPONENTS, storedCache('1.3.0'));

    const manager = new ComponentCacheManager({ eagerRefresh: false });
    await settle();

    assert.equal(manager.getCacheInfo().size, 0);
    assert.ok(fake.lines.some((line) => line.includes(`Cache schema upgrade (1.3.0 -> ${CURRENT_CACHE_VERSION})`)));
    manager.dispose();
  });

  test('reports memory-only storage unless the port is persistent', () => {
    installFakeRuntime();
    const manager = new ComponentCacheManager({ eagerRefresh: false });

    assert.equal(manager.getCacheInfo().isPersistent, false);
    installFakeRuntime({}, { storage: { ...createDefaultRuntime().storage, persistent: true } });
    assert.equal(manager.getCacheInfo().isPersistent, true);
    manager.dispose();
  });
});

suite('services under plain Node', () => {
  const originalRequests = { http: http.request, https: https.request };
  const requests: string[] = [];

  setup(() => {
    const record = (protocol: string) => (() => {
      requests.push(protocol);
      throw new Error('unexpected network call');
    }) as unknown as typeof http.request;
    Object.assign(http, { request: record('http') });
    Object.assign(https, { request: record('https') });
  });

  teardown(() => {
    Object.assign(http, { request: originalRequests.http });
    Object.assign(https, { request: originalRequests.https });
  });

  test('the singletons start with eagerRefresh off and make no network calls', async () => {
    const service = getComponentService();
    const manager = getComponentCacheManager({ eagerRefresh: false });
    await settle();

    assert.equal(manager, getComponentCacheManager());
    assert.equal(manager.getCacheInfo().size, 0);
    assert.deepStrictEqual(await service.getTokenInstances(), []);
    assert.deepStrictEqual(requests, []);
  });
});
