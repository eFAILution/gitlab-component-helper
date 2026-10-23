// @mocha
/**
 * Third-round review fixes: token hygiene, user-only network settings from the extension, a deep-frozen runtime,
 * and symlink checks before realpath.
 */

import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeToken, InvalidTokenError } from '../../src/core/tokens';
import { TokenManager } from '../../src/services/component/tokenManager';
import { takeEnvTokens } from '../../src/mcp/adapters/secrets';
import { effectiveSettings } from '../../src/mcp/launchConfig';
import { createMcpWorkspace } from '../../src/mcp/adapters/workspace';
import { CONFIG_DEFAULTS, type ConfigKey } from '../../src/core/config/defaults';
import { createMemorySecrets, installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

const IS_WINDOWS = process.platform === 'win32';

suite('tokens are trimmed and checked', () => {
  teardown(restoreRuntime);

  test('normalizeToken trims whitespace and newlines', () => {
    assert.equal(normalizeToken('  glpat-abc\r\n'), 'glpat-abc');
  });

  test('normalizeToken rejects embedded control characters without echoing the token', () => {
    assert.throws(() => normalizeToken('glpat-se\u0007cret'), (error: unknown) => {
      assert.ok(error instanceof InvalidTokenError);
      assert.doesNotMatch(error.message, /glpat|secret/);
      return true;
    });
    assert.throws(() => normalizeToken('   '), InvalidTokenError);
  });

  test('setTokenForProject stores the trimmed token and refuses a bad one', async () => {
    const { secrets, values } = createMemorySecrets();
    installFakeRuntime({}, { secrets });
    const manager = new TokenManager();

    await manager.setTokenForProject('gitlab.com', 'glpat-ok\n');
    assert.equal(values.get('gitlab-token-gitlab.com'), 'glpat-ok');

    await assert.rejects(manager.setTokenForProject('gitlab.example.com', 'bad\u0000token'), InvalidTokenError);
    assert.equal(values.has('gitlab-token-gitlab.example.com'), false);
  });

  test('the MCP server trims env tokens and drops bad ones with a warning that has no token in it', () => {
    const warnings: string[] = [];
    const tokens = takeEnvTokens(
      {
        GCH_TOKENS_JSON: JSON.stringify({ 'gitlab.example.com': 'exact\n', 'gitlab.bad': 'evil\u001btoken' }),
        GCH_TOKEN_GITLAB_COM: 'env\r\n',
        GITLAB_TOKEN: 'fall\u0000back',
      },
      (message) => warnings.push(message)
    );

    assert.deepStrictEqual([...tokens.exact], [['gitlab.example.com', 'exact']]);
    assert.deepStrictEqual([...tokens.byEnvName], [['GCH_TOKEN_GITLAB_COM', 'env']]);
    assert.equal(tokens.fallbackToken, undefined);
    assert.equal(warnings.length, 2);
    assert.doesNotMatch(warnings.join('\n'), /evil|fall|back/);
  });
});

suite('the extension passes network settings from user scope only', () => {
  test('keys a workspace may not set come from user scope; behavior keys keep the effective value', () => {
    const effective = (key: ConfigKey) => (({ httpTimeout: 1, logLevel: 'DEBUG', additionalFileGlobs: ['repo/*.yml'] } as Record<string, unknown>)[key] ?? CONFIG_DEFAULTS[key]);
    const user = (key: ConfigKey) => (({ httpTimeout: 20000 } as Record<string, unknown>)[key] ?? CONFIG_DEFAULTS[key]);
    const settings = effectiveSettings(effective, user);

    assert.equal(settings.httpTimeout, 20000);
    assert.equal(settings.logLevel, 'ERROR');
    assert.deepStrictEqual(settings.additionalFileGlobs, ['repo/*.yml']);
    assert.equal('gitlabToken' in settings, false);
  });
});

suite('the locked runtime is deep-frozen', function () {
  this.timeout(15000);

  test('every port is frozen after lockRuntime', () => {
    const script = [
      "const r = require('./src/core/runtime.ts');",
      "r.setRuntime({ ...r.createDefaultRuntime(), network: { checkRequest() {}, nested: { a: 1 } } });",
      'r.lockRuntime();',
      'const ports = r.getRuntime();',
      "const names = ['config', 'secrets', 'storage', 'log', 'authPrompt', 'network'];",
      'process.stdout.write(JSON.stringify(names.map((name) => Object.isFrozen(ports[name])).concat(Object.isFrozen(ports.network.nested))));',
    ].join('\n');
    const frozen = JSON.parse(execFileSync(process.execPath, ['-r', 'tsx/cjs', '-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));

    assert.deepStrictEqual(frozen, [true, true, true, true, true, true, true]);
  });
});

suite('symlinks are checked before realpath', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'gch-links-')));
  const root = join(base, 'root');
  mkdirSync(join(root, 'ci', 'deep'), { recursive: true });
  mkdirSync(join(base, 'outside'));
  writeFileSync(join(root, 'ci', 'real.yml'), 'real\n');
  writeFileSync(join(base, 'outside', 'secret.yml'), 'secret\n');
  if (!IS_WINDOWS) {
    symlinkSync('real.yml', join(root, 'ci', 'relative.yml'));
    symlinkSync('ci', join(root, 'linkdir'));
    symlinkSync(join(root, 'ci', 'real.yml'), join(root, 'ci', 'absolute-inside.yml'));
    symlinkSync('../../outside/secret.yml', join(root, 'ci', 'escape.yml'));
    symlinkSync('../relative.yml', join(root, 'ci', 'deep', 'chain.yml'));
  }
  const workspace = createMcpWorkspace([root]);
  suiteTeardown(() => rmSync(base, { recursive: true, force: true }));

  test('relative links that stay inside the root are followed, including through a linked directory and a chain', async function () {
    if (IS_WINDOWS) this.skip();
    assert.equal(await workspace.readText(join(root, 'ci', 'relative.yml')), 'real\n');
    assert.equal(await workspace.readText(join(root, 'linkdir', 'real.yml')), 'real\n');
    assert.equal(await workspace.readText(join(root, 'ci', 'deep', 'chain.yml')), 'real\n');
  });

  test('a link with an absolute target is refused, even one pointing inside the root', async function () {
    if (IS_WINDOWS) this.skip();
    assert.equal(await workspace.resolve('ci/absolute-inside.yml'), null);
  });

  test('a relative link that leaves the root is refused', async function () {
    if (IS_WINDOWS) this.skip();
    assert.equal(await workspace.resolve('ci/escape.yml'), null);
  });
});
