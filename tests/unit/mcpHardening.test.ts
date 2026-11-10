// @mocha
/**
 * Second-round hardening from the security review: lexical path containment before any filesystem call, FIFO-safe
 * reads, repo config read through the workspace guard, invisible-character stripping, embedded-IPv4 address checks,
 * and a frozen runtime that fails closed.
 */

import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpWorkspace } from '../../src/mcp/adapters/workspace';
import { readBoundedTextFile } from '../../src/adapters/node/readTextFile';
import { createLayeredConfig, loadConfigLayers, REPO_CONFIG_FILE } from '../../src/mcp/adapters/config';
import { cleanPath, cleanText } from '../../src/mcp/tools/sanitize';
import { describeComponentLink } from '../../src/mcp/tools/getComponentSpec';
import { isBlockedAddress } from '../../src/mcp/adapters/network';

const IS_WINDOWS = process.platform === 'win32';
const FAST_MS = 1000;

suite('hardening: workspace and file reads', function () {
  this.timeout(10000);
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'gch-hard-')));
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(root, 'ok.yml'), 'ok\n');
  writeFileSync(join(outside, 'config.json'), JSON.stringify({ additionalFileGlobs: ['smuggled/*.yml'] }));
  if (!IS_WINDOWS) {
    symlinkSync(join(root, 'ok.yml'), join(outside, 'into-root.yml'));
    symlinkSync(join(outside, 'config.json'), join(root, REPO_CONFIG_FILE));
    execFileSync('mkfifo', [join(root, 'pipe.yml')]);
  }
  const workspace = createMcpWorkspace([root]);
  suiteTeardown(() => rmSync(base, { recursive: true, force: true }));

  test('a path lexically outside the roots is refused even if it links back inside', async function () {
    if (IS_WINDOWS) this.skip();
    assert.equal(await workspace.resolve(join(outside, 'into-root.yml')), null);
    assert.equal(await workspace.readText(join(outside, 'into-root.yml')), null);
  });

  test('UNC and \\\\?\\ paths are refused up front', async () => {
    for (const unsafe of ['\\\\server\\share\\x.yml', '\\\\?\\C:\\x.yml', '//server/share/x.yml']) {
      assert.equal(await workspace.resolve(unsafe), null, unsafe);
      assert.equal(await workspace.readText(unsafe), null, unsafe);
    }
  });

  test('a FIFO is unreadable and does not block', async function () {
    if (IS_WINDOWS) this.skip();
    const started = Date.now();
    assert.equal(await readBoundedTextFile(join(root, 'pipe.yml')), null);
    assert.ok(Date.now() - started < FAST_MS);
  });

  test('the repo config file is read through the workspace guard, so a symlink out is ignored', async function () {
    if (IS_WINDOWS) this.skip();
    const config = createLayeredConfig(await loadConfigLayers({ env: {}, root, workspace, warn: () => undefined }));
    assert.deepStrictEqual(config.get('additionalFileGlobs', ['x']), []);
  });
});

suite('hardening: output text', () => {
  test('cleanText strips tag, zero-width, direction, and line/paragraph separator characters', () => {
    const hidden = 'a\u{E0041}\u{E007F}b\u200Bc\u200Cd\u200De\u2060f\uFEFFg\u200Eh\u200Fi\u061Cj\u2028k\u2029l';
    assert.equal(cleanText(hidden), 'abcdefghijkl');
  });

  test('cleanPath strips controls and caps length', () => {
    assert.equal(cleanPath('/repo/\u0007ci\u202e.yml'), '/repo/ci.yml');
    assert.ok(cleanPath(`/${'a'.repeat(5000)}`).length <= 1024);
  });

  test('documentationUrl is kept only when it is https', () => {
    assert.equal(describeComponentLink('https://gitlab.com/g/p'), 'https://gitlab.com/g/p');
    assert.equal(describeComponentLink('javascript:alert(1)'), undefined);
    assert.equal(describeComponentLink('http://gitlab.com/g/p'), undefined);
    assert.equal(describeComponentLink(undefined), undefined);
  });
});

suite('hardening: addresses', () => {
  test('blocks IPv4 metadata addresses embedded in IPv6 and cloud metadata endpoints', () => {
    for (const address of [
      '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::a9fe:a9fe', '64:ff9b::a9fe:a9fe', '64:ff9b::169.254.169.254',
      '2002:a9fe:a9fe::', '100.100.100.200', 'fd00:ec2::254', 'fe80::1%en0', '0:0:0:0:0:0:0:0', '::ffff:224.0.0.1',
    ]) {
      assert.equal(isBlockedAddress(address), true, address);
    }
  });

  test('still allows private, loopback, and public addresses (self-managed GitLab)', () => {
    for (const address of ['10.0.0.5', '192.168.1.10', '127.0.0.1', '::1', 'fd12:3456::1', '8.8.8.8', '2606:4700::1111', '2002:0808:0808::']) {
      assert.equal(isBlockedAddress(address), false, address);
    }
  });
});

suite('hardening: locked runtime', function () {
  this.timeout(15000);

  test('lockRuntime freezes the ports and HttpClient fails closed without a network policy', () => {
    const script = [
      "const r = require('./src/core/runtime.ts');",
      "const { HttpClient } = require('./src/utils/httpClient.ts');",
      'r.lockRuntime();',
      'const out = {};',
      "try { r.getRuntime().config = null; } catch { /* strict mode throws */ }",
      'out.frozen = r.getRuntime().config !== null && Object.isFrozen(r.getRuntime());',
      "new HttpClient().fetchJson('https://gitlab.com/api/v4/x', { retryAttempts: 0 })",
      "  .then(() => { out.request = 'sent'; }, (e) => { out.request = String(e.message); })",
      '  .then(() => process.stdout.write(JSON.stringify(out)));',
    ].join('\n');
    const result = JSON.parse(execFileSync(process.execPath, ['-r', 'tsx/cjs', '-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));

    assert.equal(result.frozen, true);
    assert.match(result.request, /no network policy/);
  });
});
