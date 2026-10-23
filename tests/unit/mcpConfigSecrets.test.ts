// @mocha
/**
 * MCP server settings and tokens: layer precedence, refused keys, JSONC VS Code settings, token variable names,
 * deleting tokens from the environment, and binding tokens only to trusted, unambiguous hosts.
 */

import * as assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLayeredConfig, loadConfigLayers, parseJsonSettings, REPO_CONFIG_FILE } from '../../src/mcp/adapters/config';
import { parseArgs, ArgsError } from '../../src/mcp/adapters/args';
import { bindTokens, createEnvSecrets, takeEnvTokens, tokenEnvName } from '../../src/mcp/adapters/secrets';

function workspaceWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'gch-cfg-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

suite('MCP config layers', () => {
  const roots: string[] = [];
  suiteTeardown(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

  test('precedence: --config > GCH_CONFIG_JSON > GCH_LOG_LEVEL > repo file > .vscode/settings.json > defaults', async () => {
    const root = workspaceWith({
      [REPO_CONFIG_FILE]: JSON.stringify({ additionalFileGlobs: ['repo/*.yml'], 'discovery.maxDepth': 2 }),
      '.vscode/settings.json': '{\n  // comments are fine\n  "gitlabComponentHelper.additionalFileGlobs": ["vscode/*.yml"],\n  "gitlabComponentHelper.discovery.maxDepth": 3,\n  "gitlabComponentHelper.versionCheck.severity": "information",\n  "editor.tabSize": 2,\n}',
    });
    roots.push(root);
    const warnings: string[] = [];
    const layers = await loadConfigLayers({
      cliJson: JSON.stringify({ cacheTime: 1 }),
      env: { GCH_CONFIG_JSON: JSON.stringify({ cacheTime: 2, batchSize: 3, 'discovery.maxDepth': 0 }), GCH_LOG_LEVEL: 'DEBUG' },
      root,
      warn: (message) => warnings.push(message),
    });
    const config = createLayeredConfig(layers);

    assert.deepStrictEqual(layers.map((layer) => layer.name), ['--config', 'GCH_CONFIG_JSON', 'GCH_LOG_LEVEL', REPO_CONFIG_FILE, '.vscode/settings.json']);
    assert.equal(config.get('cacheTime', 0), 1);
    assert.equal(config.get('batchSize', 0), 3);
    assert.equal(config.get('logLevel', ''), 'DEBUG');
    assert.equal(config.get('discovery.maxDepth', 9), 0);
    assert.deepStrictEqual(config.get('additionalFileGlobs', []), ['repo/*.yml']);
    assert.equal(config.get('versionCheck.severity', ''), 'information');
    assert.equal(config.get('httpTimeout', 0), 10000);
    assert.deepStrictEqual(warnings, []);
  });

  test('refuses gitlabToken and drops unknown or wrongly-typed settings, with a warning for each', async () => {
    const root = workspaceWith({ [REPO_CONFIG_FILE]: JSON.stringify({ gitlabToken: 'glpat-x', nope: 1, additionalFileGlobs: 'soon' }) });
    roots.push(root);
    const warnings: string[] = [];
    const config = createLayeredConfig(await loadConfigLayers({ env: {}, root, warn: (message) => warnings.push(message) }));

    assert.equal(config.get('gitlabToken', ''), '');
    assert.deepStrictEqual(config.get('additionalFileGlobs', ['x']), []);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /gitlabToken/);
  });

  test('ignores a settings file that is not valid JSON', async () => {
    const root = workspaceWith({ [REPO_CONFIG_FILE]: '{ broken' });
    roots.push(root);
    const warnings: string[] = [];
    const config = createLayeredConfig(await loadConfigLayers({ env: {}, root, warn: (message) => warnings.push(message) }));

    assert.equal(config.get('cacheTime', 0), 3600);
    assert.match(warnings[0], /not valid JSON/);
  });
});

suite('MCP config trust and parsing', () => {
  const roots: string[] = [];
  suiteTeardown(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

  test('repository files may not set network or logging settings', async () => {
    const root = workspaceWith({
      [REPO_CONFIG_FILE]: JSON.stringify({ httpTimeout: 1, retryAttempts: 9, batchSize: 99, cacheTime: 1, logLevel: 'DEBUG', additionalFileGlobs: ['ci/*.yml'] }),
      '.vscode/settings.json': JSON.stringify({ 'gitlabComponentHelper.httpTimeout': 2, 'gitlabComponentHelper.versionCheck.enabled': false }),
    });
    roots.push(root);
    const warnings: string[] = [];
    const config = createLayeredConfig(await loadConfigLayers({ env: {}, root, warn: (message) => warnings.push(message) }));

    assert.equal(config.get('httpTimeout', 0), 10000);
    assert.equal(config.get('retryAttempts', 0), 3);
    assert.equal(config.get('batchSize', 0), 5);
    assert.equal(config.get('cacheTime', 0), 3600);
    assert.equal(config.get('logLevel', ''), 'ERROR');
    assert.deepStrictEqual(config.get('additionalFileGlobs', []), ['ci/*.yml']);
    assert.equal(config.get('versionCheck.enabled', true), false);
    assert.equal(warnings.filter((message) => /not allowed in/.test(message)).length, 6);
  });

  test('__proto__ keys can neither pollute prototypes nor smuggle settings', () => {
    const warnings: string[] = [];
    const settings = parseJsonSettings('{"__proto__":{"gitlabToken":"x","httpTimeout":1}}', '--config', (message) => warnings.push(message));
    const config = createLayeredConfig([{ name: '--config', settings }]);

    assert.equal(config.get('gitlabToken', ''), '');
    assert.equal(config.get('httpTimeout', 0), 10000);
    assert.equal(({} as Record<string, unknown>).gitlabToken, undefined);
    assert.match(warnings[0], /__proto__/);
  });
});

suite('MCP command line', () => {
  test('parses repeatable roots and options, defaulting the root to the working directory', () => {
    assert.deepStrictEqual(parseArgs(['--root', '/a', '--root=/b', '--cache-dir', '/c', '--log-level', 'DEBUG'], '/cwd'), {
      roots: ['/a', '/b'],
      cacheDir: '/c',
      logLevel: 'DEBUG',
    });
    assert.deepStrictEqual(parseArgs([], '/cwd'), { roots: ['/cwd'] });
  });

  test('rejects unknown options and missing values', () => {
    assert.throws(() => parseArgs(['--token', 'x'], '/cwd'), ArgsError);
    assert.throws(() => parseArgs(['--root'], '/cwd'), ArgsError);
  });
});

suite('MCP tokens', () => {
  test('maps hosts to GCH_TOKEN_ variable names', () => {
    assert.equal(tokenEnvName('gitlab.com'), 'GCH_TOKEN_GITLAB_COM');
    assert.equal(tokenEnvName('GitLab.Example-Corp.com:8443'), 'GCH_TOKEN_GITLAB_EXAMPLE_CORP_COM_8443');
  });

  test('takeEnvTokens reads the token variables and deletes them from the environment', () => {
    const env: NodeJS.ProcessEnv = { GCH_TOKEN_GITLAB_COM: 'a', GITLAB_TOKEN: 'b', GITLAB_HOST: 'https://gitlab.internal', PATH: '/bin' };
    const tokens = takeEnvTokens(env);

    assert.deepStrictEqual(env, { GITLAB_HOST: 'https://gitlab.internal', PATH: '/bin' });
    assert.deepStrictEqual([...tokens.byEnvName], [['GCH_TOKEN_GITLAB_COM', 'a']]);
    assert.equal(tokens.fallbackHost, 'gitlab.internal');
    assert.equal(tokens.fallbackToken, 'b');
  });

  test('binds tokens to trusted hosts, GITLAB_TOKEN to its host, and serves them by instance', async () => {
    const tokens = takeEnvTokens({ GCH_TOKEN_GITLAB_EXAMPLE_COM: 'example', GITLAB_TOKEN: 'fallback' });
    const bound = bindTokens(tokens, ['gitlab.example.com'], () => undefined);
    const secrets = createEnvSecrets(bound);

    assert.equal(await secrets.get('gitlab-token-gitlab.example.com'), 'example');
    assert.equal(await secrets.get('gitlab-token-gitlab.com'), 'fallback');
    assert.equal(await secrets.get('gitlab-token-gitlab-example.com'), undefined, 'a look-alike host never gets the token');
    assert.equal(secrets.store, undefined);
  });

  test('refuses a token whose variable name two trusted hosts share', () => {
    const warnings: string[] = [];
    const bound = bindTokens(takeEnvTokens({ GCH_TOKEN_GITLAB_EXAMPLE_COM: 't' }), ['gitlab.example.com', 'gitlab-example.com'], (m) => warnings.push(m));

    assert.equal(bound.size, 0);
    assert.match(warnings[0], /could belong to/);
  });
});
