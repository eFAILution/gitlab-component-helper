// @mocha
/**
 * `TokenManager` keeps tokens in the runtime's secrets port and keeps a list of instances with tokens in storage, so
 * a host that can't enumerate secrets (the MCP launcher) can still find them. It loads under plain Node.
 */

import * as assert from 'node:assert/strict';
import { getRuntime } from '../../src/core/runtime';
import { TOKEN_INSTANCES_KEY, TokenManager } from '../../src/services/component/tokenManager';
import { createMemorySecrets, installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

suite('TokenManager', () => {
  teardown(restoreRuntime);

  test('reads tokens from the secrets port by instance', async () => {
    const { secrets, values } = createMemorySecrets();
    values.set('gitlab-token-gitlab.com', 'glpat-abc');
    installFakeRuntime({}, { secrets });
    const manager = new TokenManager();

    assert.equal(await manager.getTokenForProject('gitlab.com'), 'glpat-abc');
    assert.equal(await manager.getTokenForInstance('gitlab.com'), 'glpat-abc');
    assert.equal(await manager.getTokenForProject('gitlab.example.com'), undefined);
  });

  test('stores the token, records the instance once, and fires onDidChangeToken', async () => {
    const { secrets, values } = createMemorySecrets();
    installFakeRuntime({}, { secrets });
    const manager = new TokenManager();
    const changed: string[] = [];
    manager.onDidChangeToken((instance) => changed.push(instance));

    await manager.setTokenForProject('gitlab.com', 'one');
    await manager.setTokenForProject('gitlab.example.com', 'two');
    await manager.setTokenForProject('gitlab.com', 'three');

    assert.equal(values.get('gitlab-token-gitlab.com'), 'three');
    assert.deepStrictEqual(await getRuntime().storage.get(TOKEN_INSTANCES_KEY), ['gitlab.com', 'gitlab.example.com']);
    assert.deepStrictEqual(await manager.getTokenInstances(), ['gitlab.com', 'gitlab.example.com']);
    assert.deepStrictEqual(changed, ['gitlab.com', 'gitlab.example.com', 'gitlab.com']);
  });

  test('throws when the secrets port cannot store', async () => {
    installFakeRuntime();
    const manager = new TokenManager();

    await assert.rejects(manager.setTokenForProject('gitlab.com', 'x'), /^Error: SecretStorage not available$/);
    assert.deepStrictEqual(await manager.getTokenInstances(), []);
  });

  test('ignores a malformed instance list in storage', async () => {
    installFakeRuntime();
    await getRuntime().storage.update(TOKEN_INSTANCES_KEY, ['gitlab.com', 42, null]);

    assert.deepStrictEqual(await new TokenManager().getTokenInstances(), ['gitlab.com']);
  });
});
