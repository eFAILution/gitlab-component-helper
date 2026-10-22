// @mocha
/**
 * How the extension launches the bundled MCP server: arguments, environment, and token hand-off.
 */

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DEFAULTS, type ConfigKey } from '../../src/core/config/defaults';
import {
  buildServerArgs,
  buildServerEnv,
  buildTokenEnv,
  effectiveSettings,
  tokenCandidateHosts,
} from '../../src/mcp/launchConfig';
import { bindTokens, takeEnvTokens } from '../../src/mcp/adapters/secrets';

suite('MCP launch config', () => {
  test('passes one --root per workspace folder after the script', () => {
    assert.deepStrictEqual(buildServerArgs('/ext/out/mcp/server.js', ['/a', '/b c']), ['/ext/out/mcp/server.js', '--root', '/a', '--root', '/b c']);
  });

  test('passes every setting except gitlabToken as GCH_CONFIG_JSON, plus the cache dir and Electron-as-Node', () => {
    const settings = effectiveSettings((key: ConfigKey) => (key === 'gitlabToken' ? 'glpat-secret' : CONFIG_DEFAULTS[key]));
    const env = buildServerEnv(settings, '/storage/mcp-cache');

    assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(env.GCH_CACHE_DIR, '/storage/mcp-cache');
    assert.doesNotMatch(env.GCH_CONFIG_JSON, /glpat-secret|gitlabToken/);
    assert.deepStrictEqual(JSON.parse(env.GCH_CONFIG_JSON).componentSources, CONFIG_DEFAULTS.componentSources);
  });

  test('token candidates are indexed instances plus configured source instances, normalized', () => {
    assert.deepStrictEqual(
      tokenCandidateHosts(['gitlab.example.com'], [{ name: 'A', path: 'g/p' }, { name: 'B', path: 'g/q', gitlabInstance: 'https://GitLab.Internal/' }]),
      ['gitlab.example.com', 'gitlab.com', 'gitlab.internal']
    );
  });

  test('the token env round-trips through the server side binding', () => {
    const env = buildTokenEnv(new Map([['gitlab.example.com', 'one'], ['gitlab.com', 'two']]));
    assert.equal(env.GCH_TOKEN_HOSTS, 'gitlab.example.com,gitlab.com');

    const bound = bindTokens(takeEnvTokens({ ...env }), env.GCH_TOKEN_HOSTS.split(','), () => undefined);
    assert.deepStrictEqual([...bound], [['gitlab.example.com', 'one'], ['gitlab.com', 'two']]);
    assert.deepStrictEqual(buildTokenEnv(new Map()), {});
  });

  test('package.json contributes the MCP server definition provider', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    assert.deepStrictEqual(manifest.contributes.mcpServerDefinitionProviders, [{ id: 'gitlabComponentHelper.mcp', label: 'GitLab Component Helper' }]);
  });
});
