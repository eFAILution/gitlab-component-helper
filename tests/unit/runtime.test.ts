// @mocha
/**
 * The default runtime is what every module sees under plain Node until a host calls `setRuntime`. It must answer
 * settings from the package.json defaults, hold no secrets, and keep storage in memory.
 */

import * as assert from 'node:assert/strict';
import { CONFIG_DEFAULTS } from '../../src/core/config/defaults';
import { Emitter } from '../../src/core/emitter';
import { createDefaultRuntime, getRuntime, setRuntime } from '../../src/core/runtime';

suite('default runtime', () => {
  test('is installed before any setRuntime call', () => {
    assert.equal(getRuntime().config.get('httpTimeout', 0), CONFIG_DEFAULTS.httpTimeout);
  });

  test('config answers from the package.json defaults, ignoring the caller fallback', () => {
    const { config } = createDefaultRuntime();

    assert.equal(config.get('logLevel', 'DEBUG'), 'ERROR');
    assert.deepStrictEqual(config.get('discovery.templateRoots', []), ['templates']);
  });

  test('config hands out copies, so callers cannot change the defaults', () => {
    const { config } = createDefaultRuntime();

    config.get<string[]>('discovery.filePatterns', []).push('*.txt');

    assert.deepStrictEqual(config.get('discovery.filePatterns', []), ['*.yml', '*.yaml']);
  });

  test('has no secrets', async () => {
    assert.equal(await createDefaultRuntime().secrets.get('gitlab-token-gitlab.com'), undefined);
  });

  test('storage keeps values in memory and drops a key updated to undefined', async () => {
    const { storage } = createDefaultRuntime();

    await storage.update('cache', { version: '1' });
    assert.deepStrictEqual(await storage.get('cache'), { version: '1' });

    await storage.update('cache', undefined);
    assert.equal(await storage.get('cache'), undefined);
  });

  test('setRuntime replaces the ports getRuntime returns', () => {
    const custom = createDefaultRuntime();
    setRuntime(custom);
    try {
      assert.equal(getRuntime(), custom);
    } finally {
      setRuntime(createDefaultRuntime());
    }
  });
});

suite('Emitter', () => {
  test('delivers fired values to listeners until they dispose', () => {
    const emitter = new Emitter<number>();
    const seen: number[] = [];
    const subscription = emitter.event((value) => seen.push(value));

    emitter.fire(1);
    subscription.dispose();
    emitter.fire(2);

    assert.deepStrictEqual(seen, [1]);
  });

  test('dispose drops every listener', () => {
    const emitter = new Emitter<void>();
    let calls = 0;
    emitter.event(() => calls++);
    emitter.event(() => calls++);

    emitter.dispose();
    emitter.fire();

    assert.equal(calls, 0);
  });
});
