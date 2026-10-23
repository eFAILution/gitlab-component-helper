/**
 * The extension's cache copy for the MCP server (ADR-372): spec fields only, private on disk, read defensively.
 */

import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCacheSeed, MAX_SEED_BYTES, readCacheSeed, writeCacheSeed } from '../../src/mcp/cacheSeed';
import type { CachedComponent } from '../../src/types/cache';

const cached = (overrides: Partial<CachedComponent> = {}): CachedComponent => ({
  name: 'deploy',
  description: 'Deploys.',
  parameters: [{ name: 'stage', description: '', required: true, type: 'string' }],
  source: 'Example',
  sourcePath: 'g/p',
  gitlabInstance: 'gitlab.example',
  version: '1.0.0',
  url: 'https://gitlab.example/g/p/deploy@1.0.0',
  rawYaml: 'spec:\n  inputs: {}\n',
  ...overrides,
});

suite('MCP cache seed', () => {
  let dir: string;
  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'gch-seed-'));
  });
  teardown(() => rmSync(dir, { recursive: true, force: true }));

  test('round-trips the spec fields only, in a private file', async () => {
    const file = await writeCacheSeed(join(dir, 'mcp-seed'), buildCacheSeed([cached()]));
    const warnings: string[] = [];

    const entries = await readCacheSeed(file, (message) => warnings.push(message));

    assert.deepStrictEqual([...entries.keys()], ['gitlab.example/g/p/deploy@1.0.0']);
    assert.deepStrictEqual(entries.get('gitlab.example/g/p/deploy@1.0.0'), {
      component: { name: 'deploy', description: 'Deploys.', parameters: cached().parameters, version: '1.0.0', source: 'Example' },
      fetchedAt: 0,
      pinned: true,
    });
    assert.deepStrictEqual(warnings, []);
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(join(dir, 'mcp-seed')).mode & 0o777, 0o700);
    }
  });

  test('a branch entry keeps its fetch time, and a non-semver tag still counts as pinned', async () => {
    const file = await writeCacheSeed(dir, buildCacheSeed([
      cached({ version: 'main', refType: 'branch', cachedAt: 42 }),
      cached({ version: 'release-2026', refType: 'tag' }),
    ]));

    const entries = await readCacheSeed(file, () => undefined);

    assert.deepStrictEqual(entries.get('gitlab.example/g/p/deploy@main')?.fetchedAt, 42);
    assert.equal(entries.get('gitlab.example/g/p/deploy@main')?.pinned, false);
    assert.equal(entries.get('gitlab.example/g/p/deploy@release-2026')?.pinned, true);
  });

  test('a missing, oversized, malformed, or foreign file is no seed, with a warning only when it exists', async () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    const bad = join(dir, 'bad.json');
    const foreign = join(dir, 'foreign.json');
    const huge = join(dir, 'huge.json');
    writeFileSync(bad, '{nope');
    writeFileSync(foreign, JSON.stringify({ schema: 99, components: [] }));
    writeFileSync(huge, Buffer.alloc(MAX_SEED_BYTES + 1, 0x20));

    for (const file of [join(dir, 'missing.json'), bad, foreign, huge]) {
      assert.equal((await readCacheSeed(file, warn)).size, 0);
    }

    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((message) => !message.includes('{nope')));
  });

  test('skips entries that are not shaped like a component', async () => {
    const file = join(dir, 'mixed.json');
    writeFileSync(file, JSON.stringify({
      schema: 1,
      components: [{ gitlabInstance: 'gitlab.example', sourcePath: 'g/p', name: 'x', version: '1.0.0', parameters: 'no' }, buildCacheSeed([cached()]).components[0], null],
    }));

    assert.deepStrictEqual([...(await readCacheSeed(file, () => undefined)).keys()], ['gitlab.example/g/p/deploy@1.0.0']);
  });
});
