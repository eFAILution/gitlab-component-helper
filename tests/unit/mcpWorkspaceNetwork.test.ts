// @mocha
/**
 * MCP server boundaries: workspace path guards, storage permissions, the network allowlist, git child processes,
 * and the locked runtime.
 */

import * as assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpWorkspace, isPlainPath } from '../../src/mcp/adapters/workspace';
import { createFileStorage, resolveCacheDir } from '../../src/mcp/adapters/storage';
import { createNetworkPolicy, isBlockedAddress, HostNotAllowedError } from '../../src/mcp/adapters/network';
import { resolveGitPath } from '../../src/mcp/adapters/gitPath';
import { runCommand } from '../../src/adapters/node/repoContext';
import { MAX_LOCAL_INCLUDE_BYTES } from '../../src/core/localInclude';
import { execFileSync } from 'node:child_process';

const POSIX_ONLY = process.platform === 'win32';
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIR = 0o700;
const PERMISSION_BITS = 0o777;

suite('MCP workspace guard', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'gch-ws-')));
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  mkdirSync(join(root, 'ci'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'ci', 'ok.yml'), 'spec: {}\n');
  writeFileSync(join(root, 'big.yml'), Buffer.alloc(MAX_LOCAL_INCLUDE_BYTES + 1, 'a'));
  writeFileSync(join(outside, 'secret.yml'), 'secret\n');
  if (!POSIX_ONLY) symlinkSync(join(outside, 'secret.yml'), join(root, 'link.yml'));
  const workspace = createMcpWorkspace([root]);

  suiteTeardown(() => rmSync(base, { recursive: true, force: true }));

  test('reads regular files inside the root, by relative or absolute path', async () => {
    assert.equal(await workspace.readText(join(root, 'ci', 'ok.yml')), 'spec: {}\n');
    assert.equal(await workspace.resolve('ci/ok.yml'), join(root, 'ci', 'ok.yml'));
    assert.equal(await workspace.resolutionRoot(join(root, 'ci', 'ok.yml')), root);
  });

  test('treats traversal, absolute paths outside, missing files, and NUL the same: null', async () => {
    for (const userPath of ['../outside/secret.yml', 'ci/../../outside/secret.yml', '..\\outside\\secret.yml', join(outside, 'secret.yml'), 'ci/missing.yml', 'ci/ok.yml\0']) {
      assert.equal(await workspace.resolve(userPath), null, userPath);
    }
    assert.equal(await workspace.readText(join(outside, 'secret.yml')), null);
    assert.equal(isPlainPath('a/../b'), false);
  });

  test('a symlink that leads outside the root is refused', async function () {
    if (POSIX_ONLY) this.skip();
    assert.equal(await workspace.resolve('link.yml'), null);
    assert.equal(await workspace.readText(join(root, 'link.yml')), null);
  });

  test('files over 1 MB and directories are unreadable', async () => {
    assert.equal(await workspace.readText(join(root, 'big.yml')), null);
    assert.equal(await workspace.readText(join(root, 'ci')), null);
  });
});

suite('MCP file storage', () => {
  const base = mkdtempSync(join(tmpdir(), 'gch-store-'));
  suiteTeardown(() => rmSync(base, { recursive: true, force: true }));

  test('round-trips values atomically into a 0700 directory of 0600 files and is persistent', async function () {
    const dir = join(base, 'cache');
    const storage = createFileStorage(dir);
    await storage.update('componentCache', { version: '1.4.0' });
    await storage.update('gitlab-token-instances', ['gitlab.com']);

    assert.equal(storage.persistent, true);
    assert.deepStrictEqual(await storage.get('componentCache'), { version: '1.4.0' });
    assert.deepStrictEqual(readdirSync(dir).sort(), ['componentCache.json', 'gitlab-token-instances.json']);
    if (POSIX_ONLY) this.skip();
    assert.equal(statSync(dir).mode & PERMISSION_BITS, OWNER_ONLY_DIR);
    assert.equal(statSync(join(dir, 'componentCache.json')).mode & PERMISSION_BITS, OWNER_ONLY_FILE);

    await storage.update('componentCache', undefined);
    assert.equal(await storage.get('componentCache'), undefined);
  });

  test('cache dir precedence: --cache-dir, GCH_CACHE_DIR, XDG_CACHE_HOME', () => {
    assert.equal(resolveCacheDir('/cli', { GCH_CACHE_DIR: '/env' }), '/cli');
    assert.equal(resolveCacheDir(undefined, { GCH_CACHE_DIR: '/env' }), '/env');
    assert.equal(resolveCacheDir(undefined, { XDG_CACHE_HOME: '/xdg' }), join('/xdg', 'gitlab-component-helper', 'mcp'));
  });
});

suite('MCP network policy', () => {
  const policy = createNetworkPolicy(['gitlab.com', 'GitLab.Internal:8443']);

  test('allows HTTPS to listed hosts only', () => {
    assert.doesNotThrow(() => policy.checkRequest(new URL('https://gitlab.com/api/v4/projects')));
    assert.doesNotThrow(() => policy.checkRequest(new URL('https://gitlab.internal:8443/api/v4')));
    assert.throws(() => policy.checkRequest(new URL('https://evil.example/api')), /add a componentSources entry with "gitlabInstance": "evil.example"/);
    assert.throws(() => policy.checkRequest(new URL('http://gitlab.com/api')), HostNotAllowedError);
  });

  test('blocks link-local, unspecified, and multicast addresses (cloud metadata lives on link-local)', () => {
    for (const address of ['169.254.169.254', 'fe80::1', '0.0.0.0', '::', '224.0.0.1', 'ff02::1', '::ffff:169.254.169.254']) {
      assert.equal(isBlockedAddress(address), true, address);
    }
    const metadata = createNetworkPolicy(['169.254.169.254']);
    assert.throws(() => metadata.checkRequest(new URL('https://169.254.169.254/api')), /link-local or reserved address/);
  });

  test('allows private and loopback addresses for allowlisted hosts, since self-managed GitLab often lives there', () => {
    for (const address of ['8.8.8.8', '10.1.2.3', '172.16.0.1', '192.168.1.1', '100.64.0.1', '127.0.0.1', '::1', 'fd00::1', '2606:4700::1111']) {
      assert.equal(isBlockedAddress(address), false, address);
    }
    const internal = createNetworkPolicy(['10.1.2.3']);
    assert.doesNotThrow(() => internal.checkRequest(new URL('https://10.1.2.3/api/v4/projects')));
    assert.throws(() => internal.checkRequest(new URL('https://10.9.9.9/api')), HostNotAllowedError);
  });
});

suite('MCP child processes and runtime', () => {
  test('runCommand strips GCH_ and GITLAB_TOKEN variables', async () => {
    const saved = { GCH_TOKEN_GITLAB_COM: process.env.GCH_TOKEN_GITLAB_COM, GITLAB_TOKEN: process.env.GITLAB_TOKEN };
    Object.assign(process.env, { GCH_TOKEN_GITLAB_COM: 'secret', GITLAB_TOKEN: 'secret' });
    try {
      const script = 'process.stdout.write(JSON.stringify([process.env.GCH_TOKEN_GITLAB_COM, process.env.GITLAB_TOKEN, process.env.EXTRA]))';
      assert.equal(await runCommand(process.execPath, process.cwd(), ['-e', script], { env: { EXTRA: 'x' } }), '[null,null,"x"]');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('resolveGitPath ignores relative PATH entries', function () {
    const dir = mkdtempSync(join(tmpdir(), 'gch-git-'));
    try {
      if (POSIX_ONLY) this.skip();
      writeFileSync(join(dir, 'git'), '#!/bin/sh\n', { mode: 0o755 });
      assert.equal(resolveGitPath({ PATH: `.:${dir}` }, 'linux'), join(dir, 'git'));
      assert.equal(resolveGitPath({ PATH: '.:relative/bin' }, 'linux'), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lockRuntime makes a later setRuntime throw', function () {
    this.timeout(10000);
    // In a child process: locking this test process would leak into every other suite.
    const script = "const r = require('./src/core/runtime.ts'); r.lockRuntime(); try { r.setRuntime(r.createDefaultRuntime()); process.stdout.write('replaced'); } catch { process.stdout.write('locked'); }";
    assert.equal(execFileSync(process.execPath, ['-r', 'tsx/cjs', '-e', script], { encoding: 'utf8' }), 'locked');
  });
});
