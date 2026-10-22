// @mocha
/**
 * On a 401 the fetcher asks the runtime's auth prompt for a token and retries with it. `ComponentFetcher` loads under
 * plain Node; the HTTP client here is a fake, so nothing leaves the process.
 */

import * as assert from 'node:assert/strict';
import { NetworkError } from '../../src/errors';
import { ComponentFetcher } from '../../src/services/component/componentFetcher';
import { TokenManager } from '../../src/services/component/tokenManager';
import { UrlParser } from '../../src/services/component/urlParser';
import type { HttpClient } from '../../src/utils/httpClient';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

const UNAUTHORIZED = 401;
const PROJECT = { id: 7, name: 'ci', default_branch: 'main' };

/** Answers project lookups only when `validToken` is sent; every tree listing is empty. */
function createFakeHttp(validToken: string, seenTokens: Array<string | undefined>): HttpClient {
  const fake = {
    fetchJson: async (url: string, options?: { headers?: Record<string, string> }) => {
      const token = options?.headers?.['PRIVATE-TOKEN'];
      if (url.includes('/repository/tree')) return [];
      seenTokens.push(token);
      if (token !== validToken) throw new NetworkError('HTTP 401', { statusCode: UNAUTHORIZED });
      return PROJECT;
    },
  };
  return fake as unknown as HttpClient;
}

function promptAnswering(token: string | undefined, calls: Array<[string, boolean]>) {
  return {
    promptForToken: async (instance: string, hadToken: boolean) => {
      calls.push([instance, hadToken]);
      return token;
    },
  };
}

suite('ComponentFetcher auth prompt', () => {
  teardown(restoreRuntime);

  test('retries with the token the prompt returns', async () => {
    const calls: Array<[string, boolean]> = [];
    const seenTokens: Array<string | undefined> = [];
    installFakeRuntime({}, { authPrompt: promptAnswering('glpat-new', calls) });
    const fetcher = new ComponentFetcher(createFakeHttp('glpat-new', seenTokens), new TokenManager(), new UrlParser());

    const catalog = await fetcher.fetchCatalogData('gitlab.example.com', 'group/ci', true);

    assert.deepStrictEqual(catalog, { components: [] });
    assert.deepStrictEqual(calls, [['gitlab.example.com', false]]);
    assert.deepStrictEqual(seenTokens, [undefined, 'glpat-new']);
  });

  test('rethrows the auth error when the prompt gives no token (the default runtime)', async () => {
    installFakeRuntime();
    const fetcher = new ComponentFetcher(createFakeHttp('never', []), new TokenManager(), new UrlParser());

    await assert.rejects(fetcher.fetchCatalogData('gitlab.example.com', 'group/ci', true), NetworkError);
  });
});
