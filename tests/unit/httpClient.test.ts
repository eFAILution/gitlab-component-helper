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
});
