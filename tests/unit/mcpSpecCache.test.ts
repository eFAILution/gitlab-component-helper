/**
 * The MCP server's spec cache (ADR-372): tag-pinned specs are reused, others only for cacheTime, failures never.
 */

import * as assert from 'node:assert/strict';
import type { StoragePort } from '../../src/core/ports';
import { createSpecCache, MAX_SPEC_ENTRIES, SPEC_CACHE_KEY, type SpecCacheEntry, type SpecIdentity } from '../../src/mcp/specCache';
import { createComponentServices } from '../../src/mcp/services';
import { parseComponentArgument } from '../../src/mcp/tools/componentRef';
import { getComponentService } from '../../src/services/component/componentService';
import type { SpecComponent } from '../../src/mcp/tools/getComponentSpec';

const HOUR_MS = 3_600_000;

function memoryStorage(): StoragePort & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    persistent: true,
    get: async <T>(key: string) => data.get(key) as T | undefined,
    update: async (key, value) => {
      data.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}

const ref = (version: string): SpecIdentity => ({ gitlabInstance: 'gitlab.example', sourcePath: 'g/p', name: 'deploy', version });
const spec = (name = 'deploy'): SpecComponent => ({
  name,
  description: 'Deploys.',
  parameters: [{ name: 'stage', description: '', required: true, type: 'string' }],
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

suite('MCP spec cache', () => {
  test('reuses a tag-pinned spec past cacheTime, and a branch spec only within it', async () => {
    let clock = 1_000;
    const cache = createSpecCache({ storage: memoryStorage(), cacheTimeMs: () => HOUR_MS, now: () => clock });
    cache.set(ref('1.2.0'), spec());
    cache.set(ref('main'), spec());
    await settle();

    clock += HOUR_MS - 1;
    assert.ok(await cache.get(ref('main')));
    clock += 2;
    assert.equal(await cache.get(ref('main')), undefined);
    assert.ok(await cache.get(ref('1.2.0')));
  });

  test('keeps only the spec fields of a fetched component', async () => {
    const storage = memoryStorage();
    const cache = createSpecCache({ storage, cacheTimeMs: () => HOUR_MS });
    cache.set(ref('1.0.0'), { ...spec(), rawYaml: 'spec: {}', context: { gitlabInstance: 'x', path: 'y' } } as SpecComponent);
    await settle();

    assert.deepStrictEqual(await cache.get(ref('1.0.0')), spec());
    assert.doesNotMatch(JSON.stringify(storage.data.get(SPEC_CACHE_KEY)), /rawYaml/);
  });

  test('survives a restart through storage, and drops malformed stored entries', async () => {
    const storage = memoryStorage();
    createSpecCache({ storage, cacheTimeMs: () => HOUR_MS }).set(ref('1.0.0'), spec());
    await settle();
    await settle();
    const stored = storage.data.get(SPEC_CACHE_KEY) as { entries: unknown[] };
    stored.entries.push(['gitlab.example/g/p/bad@1.0.0', { component: { name: 1 }, fetchedAt: 1, pinned: true }]);

    const restarted = createSpecCache({ storage, cacheTimeMs: () => HOUR_MS });

    assert.deepStrictEqual(await restarted.get(ref('1.0.0')), spec());
    assert.equal(await restarted.get({ ...ref('1.0.0'), name: 'bad' }), undefined);
  });

  test(`keeps the newest ${MAX_SPEC_ENTRIES} entries`, async () => {
    let clock = 0;
    const storage = memoryStorage();
    const cache = createSpecCache({ storage, cacheTimeMs: () => HOUR_MS, now: () => ++clock });
    for (let index = 0; index <= MAX_SPEC_ENTRIES; index++) cache.set({ ...ref('1.0.0'), name: `c${index}` }, spec(`c${index}`));
    await settle();
    await settle();

    assert.equal(await cache.get({ ...ref('1.0.0'), name: 'c0' }), undefined);
    assert.ok(await cache.get({ ...ref('1.0.0'), name: `c${MAX_SPEC_ENTRIES}` }));
    assert.equal((storage.data.get(SPEC_CACHE_KEY) as { entries: unknown[] }).entries.length, MAX_SPEC_ENTRIES);
  });

  test('falls back on a fresh seed entry, and its own entry wins over the seed', async () => {
    const seeded = new Map<string, SpecCacheEntry>([
      ['gitlab.example/g/p/deploy@1.0.0', { component: spec('from-seed'), fetchedAt: 0, pinned: true }],
      ['gitlab.example/g/p/deploy@main', { component: spec('stale-seed'), fetchedAt: 0, pinned: false }],
    ]);
    const cache = createSpecCache({ storage: memoryStorage(), cacheTimeMs: () => HOUR_MS, seed: async () => seeded });

    assert.equal((await cache.get(ref('1.0.0')))?.name, 'from-seed');
    assert.equal(await cache.get(ref('main')), undefined);
    cache.set(ref('1.0.0'), spec('own'));
    await settle();
    assert.equal((await cache.get(ref('1.0.0')))?.name, 'own');
  });
});

suite('MCP component services with the spec cache', () => {
  const service = getComponentService();
  const original = service.getComponentFromUrl;
  teardown(() => {
    service.getComponentFromUrl = original;
  });

  test('a cached spec skips GitLab, and a failed fetch is never cached', async () => {
    const urls: string[] = [];
    let fail = true;
    service.getComponentFromUrl = async (url) => {
      urls.push(url);
      return fail
        ? { name: 'deploy', description: 'Component from x\n\nCould not fetch detailed information: boom', parameters: [] }
        : { ...spec(), context: { gitlabInstance: 'gitlab.example', path: 'g/p' } };
    };
    const services = createComponentServices(() => true, createSpecCache({ storage: memoryStorage(), cacheTimeMs: () => HOUR_MS }));
    const component = parseComponentArgument('gitlab.example/g/p/deploy@1.0.0');

    await assert.rejects(services.fetchComponent(component));
    fail = false;
    assert.equal((await services.fetchComponent(component))?.name, 'deploy');
    await settle();
    assert.equal((await services.fetchComponent(component))?.name, 'deploy');

    assert.equal(urls.length, 2);
  });

  test('a host the server may not contact is refused before the cache is read', async () => {
    const cache = createSpecCache({ storage: memoryStorage(), cacheTimeMs: () => HOUR_MS });
    cache.set(ref('1.0.0'), spec());
    await settle();
    const services = createComponentServices(() => false, cache);

    await assert.rejects(services.fetchComponent(parseComponentArgument('gitlab.example/g/p/deploy@1.0.0')), /not/);
  });
});
