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
  userSourceHosts,
} from '../../src/mcp/launchConfig';
import { bindTokens, takeEnvTokens } from '../../src/mcp/adapters/secrets';

suite('MCP launch config', () => {
  test('passes one --root per workspace folder after the script', () => {
    assert.deepStrictEqual(buildServerArgs('/ext/out/mcp/server.js', ['/a', '/b c']), ['/ext/out/mcp/server.js', '--root', '/a', '--root', '/b c']);
  });

  test('passes every setting except gitlabToken as GCH_CONFIG_JSON, plus the cache dir and Electron-as-Node', () => {
    const read = (key: ConfigKey) => (key === 'gitlabToken' ? 'glpat-secret' : CONFIG_DEFAULTS[key]);
    const settings = effectiveSettings(read, read);
    const env = buildServerEnv(settings, '/storage/mcp-cache', []);

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

  test('tokens go over as one exact GCH_TOKENS_JSON map that the server binds host by host', () => {
    const env = buildTokenEnv(new Map([['gitlab.example.com', 'one'], ['gitlab.com', 'two']]));
    assert.deepStrictEqual(Object.keys(env), ['GCH_TOKENS_JSON']);

    const bound = bindTokens(takeEnvTokens({ ...env }), [], () => undefined);
    assert.deepStrictEqual([...bound], [['gitlab.example.com', 'one'], ['gitlab.com', 'two']]);
    assert.deepStrictEqual(buildTokenEnv(new Map()), {});
  });

  test('user-level source hosts become GCH_TRUSTED_HOSTS', () => {
    const env = buildServerEnv({}, '/cache', userSourceHosts([{ name: 'A', path: 'g/p', gitlabInstance: 'gitlab.corp' }, { name: 'B', path: 'g/q' }]));

    assert.equal(env.GCH_TRUSTED_HOSTS, 'gitlab.corp,gitlab.com');
    assert.equal(buildServerEnv({}, '/cache', []).GCH_TRUSTED_HOSTS, undefined);
  });

  test('package.json contributes the MCP server definition provider', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    assert.deepStrictEqual(manifest.contributes.mcpServerDefinitionProviders, [{ id: 'gitlabComponentHelper.mcp', label: 'GitLab Component Helper' }]);
  });

  test('gitlabComponentHelper.mcp.enabled is an application-scoped boolean defaulting to false (opt-in)', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    const setting = manifest.contributes.configuration.properties['gitlabComponentHelper.mcp.enabled'];
    assert.deepStrictEqual([setting.type, setting.default, setting.scope], ['boolean', false, 'application']);
  });
});
