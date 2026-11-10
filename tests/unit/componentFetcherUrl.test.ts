// @mocha
/**
 * `fetchComponentMetadata` must address the right project and ref for a component URL whose version contains `/`
 * (a branch such as `feature/my-branch`). The HTTP client is a fake that records every URL it is asked for, so
 * nothing leaves the process.
 */

import * as assert from 'node:assert/strict';
import { NetworkError } from '../../src/errors';
import { ComponentFetcher } from '../../src/services/component/componentFetcher';
import { TokenManager } from '../../src/services/component/tokenManager';
import { UrlParser } from '../../src/services/component/urlParser';
import type { HttpClient } from '../../src/utils/httpClient';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

const NOT_FOUND = 404;
const PROJECT_PATH = 'my-group/my-subgroup/my-project';
const BRANCH = 'feature/my-branch';
const COMPONENT_URL = `https://gitlab.com/${PROJECT_PATH}/my-component@${BRANCH}`;
const PROJECT_API_URL = `https://gitlab.com/api/v4/projects/${encodeURIComponent(PROJECT_PATH)}`;
const TEMPLATE = ['spec:', '  inputs:', '    stage:', '      default: test', '---', 'job:', '  script: echo'].join('\n');

/**
 * Serves the project and its `templates/my-component.yml` at the expected project path; the catalog and every other
 * request 404, so the fetcher takes the repository route.
 */
function createFakeHttp(requested: string[], projectFound: boolean): HttpClient {
  const notFound = () => new NetworkError('HTTP 404', { statusCode: NOT_FOUND });
  const fake = {
    fetchJson: async (url: string) => {
      requested.push(url);
      if (url === PROJECT_API_URL && projectFound) return { id: 7, name: 'my-project', default_branch: 'main' };
      throw notFound();
    },
    fetchText: async (url: string) => {
      requested.push(url);
      if (url.startsWith(`${PROJECT_API_URL}/repository/files/templates%2Fmy-component.yml/raw`)) return TEMPLATE;
      throw notFound();
    },
  };
  return fake as unknown as HttpClient;
}

suite('ComponentFetcher.fetchComponentMetadata with a slashed version', () => {
  setup(() => installFakeRuntime());
  teardown(restoreRuntime);

  test('fetches the project before the @ and the template at the full branch ref', async () => {
    const requested: string[] = [];
    const fetcher = new ComponentFetcher(createFakeHttp(requested, true), new TokenManager(), new UrlParser());

    const component = await fetcher.fetchComponentMetadata(COMPONENT_URL);

    assert.ok(requested.includes(PROJECT_API_URL), `project lookup missing from ${requested.join('\n')}`);
    assert.ok(
      requested.some((url) => url.endsWith(`?ref=${BRANCH}`)),
      `template lookup should pin the full branch ref, got ${requested.join('\n')}`
    );
    assert.equal(component.name, 'my-component');
    assert.equal(component.version, BRANCH);
    assert.equal(component.source, `gitlab.com/${PROJECT_PATH}`);
    assert.equal(component.templatePath, 'templates/my-component.yml');
    assert.deepEqual(component.parameters.map((p) => p.name), ['stage']);
  });

  test('names the fallback component after the component, not the branch', async () => {
    const fetcher = new ComponentFetcher(createFakeHttp([], false), new TokenManager(), new UrlParser());

    const component = await fetcher.fetchComponentMetadata(COMPONENT_URL);

    assert.equal(component.name, 'my-component');
    assert.match(component.description, /HTTP 404/);
  });
});
