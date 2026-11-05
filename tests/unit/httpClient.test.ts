// @mocha
/**
 * `HttpClient` must load under plain Node (no `vscode`) and take its timeout and retry count from the runtime
 * config, so the MCP server can reuse it.
 */

import * as assert from 'node:assert/strict';
import { HttpClient } from '../../src/utils/httpClient';
import { NetworkError } from '../../src/errors';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

// Nothing listens on port 1, so the request fails fast without leaving the machine.
const UNREACHABLE_URL = 'http://127.0.0.1:1/api/v4/projects';

suite('HttpClient under plain Node', () => {
  teardown(restoreRuntime);

  test('reads httpTimeout and retryAttempts from the runtime config', async () => {
    const fake = installFakeRuntime({ httpTimeout: 500, retryAttempts: 0 });

    await assert.rejects(new HttpClient().fetchJson(UNREACHABLE_URL), NetworkError);

    assert.ok(fake.configReads.includes('httpTimeout'));
    assert.ok(fake.configReads.includes('retryAttempts'));
  });

  test('with retryAttempts 0 it gives up after one attempt and logs the failure', async () => {
    const fake = installFakeRuntime({ logLevel: 'ERROR', httpTimeout: 500, retryAttempts: 0 });

    await assert.rejects(new HttpClient().fetchText(UNREACHABLE_URL), NetworkError);

    assert.ok(fake.lines.some((line) => line.includes(`HTTP Text Request failed after 1 attempts: ${UNREACHABLE_URL}`)));
  });

  test('deduplication keys never hold the raw auth token', async () => {
    installFakeRuntime({ httpTimeout: 500, retryAttempts: 0 });
    const client = new HttpClient();

    const pending = client.fetchJson(UNREACHABLE_URL, { headers: { 'PRIVATE-TOKEN': 'glpat-secret' } });
    const { pendingKeys } = client.getDeduplicationStats();
    await assert.rejects(pending, NetworkError);

    assert.equal(pendingKeys.length, 1);
    assert.ok(pendingKeys.every((key) => !key.includes('glpat-secret')));
  });

  test('a request that throws while being built rejects and leaves no deadline timer behind', async () => {
    installFakeRuntime({ retryAttempts: 0 });
    const started = new Set<ReturnType<typeof setTimeout>>();
    const realSetTimeout = global.setTimeout;
    const realClearTimeout = global.clearTimeout;
    global.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const handle = realSetTimeout(...args);
      started.add(handle);
      return handle;
    }) as typeof setTimeout;
    global.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
      if (handle) started.delete(handle);
      realClearTimeout(handle);
    }) as typeof clearTimeout;

    try {
      // A header value with a newline makes http.request throw synchronously (ERR_INVALID_CHAR).
      await assert.rejects(
        new HttpClient().fetchText(UNREACHABLE_URL, { headers: { 'PRIVATE-TOKEN': 'glpat-abc\n' } }),
        NetworkError,
      );
    } finally {
      global.setTimeout = realSetTimeout;
      global.clearTimeout = realClearTimeout;
    }

    assert.equal(started.size, 0, 'a deadline timer was left running');
  });

  test('retryAttempts 0 means a single attempt', async () => {
    const fake = installFakeRuntime({ logLevel: 'ERROR', retryAttempts: 3 });

    await assert.rejects(new HttpClient().fetchText(UNREACHABLE_URL, { retryAttempts: 0 }), NetworkError);

    assert.ok(fake.lines.some((line) => line.includes('failed after 1 attempts')));
  });
});
