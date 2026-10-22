// @mocha
/**
 * Token hand-off and host trust, through the real bootstrap in a child process: tokens bind only to exact or
 * launcher-named hosts, and hosts named only by workspace files never widen the allowlist.
 */

import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PROBE = resolve(__dirname, 'support', 'bootstrapProbe.ts');
const PROBE_TIMEOUT_MS = 20000;

interface ProbeResult {
  hosts: Record<string, { token: string | null; allowed: boolean }>;
  envLeft: string[];
}

function probe(env: NodeJS.ProcessEnv, root: string, cache: string, hosts: string[]): ProbeResult {
  const output = execFileSync(process.execPath, ['-r', 'tsx/cjs', PROBE, JSON.stringify(env), root, cache, hosts.join(',')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(output.trim().split('\n').pop() ?? '{}') as ProbeResult;
}

const LOOKALIKE_SOURCES = JSON.stringify([{ name: 'evil', path: 'g/p', gitlabInstance: 'gitlab-example.com' }]);

suite('MCP token trust (bootstrap)', function () {
  this.timeout(PROBE_TIMEOUT_MS);
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'gch-trust-')));
  const root = join(base, 'repo');
  const cache = join(base, 'cache');
  mkdirSync(join(root, '.vscode'), { recursive: true });
  writeFileSync(join(root, '.vscode', 'settings.json'), `{ "gitlabComponentHelper.componentSources": ${LOOKALIKE_SOURCES} }`);
  writeFileSync(join(root, '.gitlab-component-helper.json'), `{ "componentSources": ${LOOKALIKE_SOURCES} }`);

  suiteTeardown(() => rmSync(base, { recursive: true, force: true }));

  test('a lookalike host from workspace settings gets no token and is not allowed (reviewer scenario)', () => {
    const result = probe(
      {
        GCH_TOKEN_GITLAB_EXAMPLE_COM: 'real-token',
        GCH_TOKEN_HOSTS: 'gitlab.example.com',
        GCH_CONFIG_JSON: JSON.stringify({ componentSources: JSON.parse(LOOKALIKE_SOURCES) }),
      },
      root,
      cache,
      ['gitlab.example.com', 'gitlab-example.com']
    );

    assert.deepStrictEqual(result.hosts['gitlab-example.com'], { token: null, allowed: false });
    assert.deepStrictEqual(result.hosts['gitlab.example.com'], { token: 'real-token', allowed: true });
    assert.deepStrictEqual(result.envLeft, []);
  });

  test('GCH_TOKENS_JSON binds each token to its exact host and is deleted', () => {
    const result = probe(
      { GCH_TOKENS_JSON: JSON.stringify({ 'gitlab.example.com': 'exact', 'GitLab.Internal:443': 'internal' }) },
      root,
      cache,
      ['gitlab.example.com', 'gitlab-example.com', 'gitlab.internal']
    );

    assert.deepStrictEqual(result.hosts, {
      'gitlab.example.com': { token: 'exact', allowed: true },
      'gitlab-example.com': { token: null, allowed: false },
      'gitlab.internal': { token: 'internal', allowed: true },
    });
    assert.deepStrictEqual(result.envLeft, []);
  });

  test('GCH_TRUSTED_HOSTS widens the allowlist; workspace componentSources do not', () => {
    const result = probe({ GCH_TRUSTED_HOSTS: 'gitlab.corp.example' }, root, cache, ['gitlab.corp.example', 'gitlab-example.com', 'gitlab.com']);

    assert.equal(result.hosts['gitlab.corp.example'].allowed, true);
    assert.equal(result.hosts['gitlab-example.com'].allowed, false);
    assert.equal(result.hosts['gitlab.com'].allowed, true);
  });
});
