// @mocha
/**
 * Hardening from the security review of the validation core: YAML alias bombs, local include paths that escape the
 * repository, unbounded reads, git child-process hygiene, a quadratic regex, and spoofed remote hosts.
 */

import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { validateIncludes } from '../../src/core/validation/validateIncludes';
import {
  MAX_LOCAL_INCLUDE_BYTES,
  isInsideRoot,
  resolveLocalIncludeOutcome,
  type WorkspacePort,
} from '../../src/core/localInclude';
import { extractLocalIncludePath, isUnsupportedLocalPath } from '../../src/providers/localIncludeParser';
import { parseGitLabRemoteUrl } from '../../src/core/gitRemote';
import { runCommand } from '../../src/adapters/node/repoContext';
import { readBoundedTextFile } from '../../src/adapters/node/readTextFile';
import { countYamlAliases, MAX_YAML_ALIASES } from '../../src/utils/yamlParser';

const FAST_MS = 200;
const CHILD_TIMEOUT_MS = 300;

/** Nine levels of nine-way aliases: about 500 bytes that expand to 9^9 nodes if anything walks them. */
function aliasBomb(): string {
  const levels = 'abcdefghi'.split('');
  const lines = [`${levels[0]}: &${levels[0]} [x, x, x, x, x, x, x, x, x]`];
  for (let i = 1; i < levels.length; i++) {
    const previous = `*${levels[i - 1]}`;
    lines.push(`${levels[i]}: &${levels[i]} [${Array(9).fill(previous).join(', ')}]`);
  }
  lines.push('include:', '  - component: gitlab.com/group/proj/deploy@1.0.0', '    inputs:', `      bomb: *${levels[levels.length - 1]}`);
  return lines.join('\n');
}

const deployLookup = {
  findCached: async () => ({ name: 'deploy', parameters: [{ name: 'bomb', description: '', required: false, type: 'array' }] }),
  fetch: async () => null,
};

function validateText(text: string) {
  return validateIncludes({
    text,
    file: '/repo/.gitlab-ci.yml',
    resolveReference: async (reference) => ({ resolved: true, url: `https://${reference}` }),
    components: deployLookup,
    resolveLocalInclude: async () => ({ kind: 'skipped' }),
  });
}

suite('security: YAML alias bombs', () => {
  test('an alias bomb validates fast without throwing', async () => {
    const started = Date.now();
    const findings = await validateText(aliasBomb());

    assert.ok(Date.now() - started < FAST_MS, `took ${Date.now() - started}ms`);
    assert.deepStrictEqual(findings, []);
  });

  test('a document with more aliases than the limit is skipped', async () => {
    const aliases = Array(MAX_YAML_ALIASES + 1).fill('*a').join(', ');
    const text = `a: &a x\nlist: [${aliases}]\ninclude:\n  - component: gitlab.com/group/proj/deploy@1.0.0\n    inputs:\n      nope: 1\n`;

    assert.equal(countYamlAliases(text), MAX_YAML_ALIASES + 1);
    assert.deepStrictEqual(await validateText(text), []);
  });

  test('countYamlAliases ignores quoted globs and counts alias tokens', () => {
    assert.equal(countYamlAliases('script:\n  - "ls *.yml"\nx: *anchor\ny: [*a, *b]\n'), 3);
  });
});

suite('security: local include paths', () => {
  test('isUnsupportedLocalPath rejects backslash traversal, drive letters, UNC paths, and NUL bytes', () => {
    for (const unsafe of ['..\\..\\x.yml', 'ci\\..\\..\\x.yml', 'C:/x.yml', 'c:\\x.yml', '\\\\server\\share\\x.yml', '//server/share/x.yml', 'ci/x\u0000.yml']) {
      assert.equal(isUnsupportedLocalPath(unsafe), true, JSON.stringify(unsafe));
    }
  });

  test('isUnsupportedLocalPath still accepts ordinary repository paths', () => {
    for (const safe of ['ci/main.yml', '/ci/main.yml', 'templates/deploy/template.yml', 'a..b/c.yml']) {
      assert.equal(isUnsupportedLocalPath(safe), false, safe);
    }
  });

  test('isInsideRoot checks containment with posix and win32 paths', () => {
    assert.equal(isInsideRoot('/repo', '/repo/ci/x.yml', path.posix), true);
    assert.equal(isInsideRoot('/repo', '/repo', path.posix), false);
    assert.equal(isInsideRoot('/repo', '/other/x.yml', path.posix), false);
    assert.equal(isInsideRoot('C:\\repo', 'C:\\repo\\ci\\x.yml', path.win32), true);
    assert.equal(isInsideRoot('C:\\repo', 'C:\\repo-other\\x.yml', path.win32), false);
    assert.equal(isInsideRoot('C:\\repo', 'D:\\repo\\x.yml', path.win32), false);
  });

  test('resolveLocalIncludeOutcome skips unsafe paths without reading anything', async () => {
    const reads: string[] = [];
    const workspace: WorkspacePort<string> = {
      roots: () => ['/repo'],
      resolutionRoot: async () => '/repo',
      readText: async (absolutePath) => {
        reads.push(absolutePath);
        return 'spec:\n  inputs: {}\n';
      },
    };

    for (const unsafe of ['..\\..\\etc\\passwd', 'C:\\Windows\\win.ini', 'ci/x\u0000.yml']) {
      assert.deepStrictEqual(await resolveLocalIncludeOutcome(unsafe, '/repo/.gitlab-ci.yml', workspace), { kind: 'skipped' });
    }
    assert.deepStrictEqual(reads, []);
  });
});

suite('security: bounded local include reads', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gch-read-'));
  suiteTeardown(() => rmSync(dir, { recursive: true, force: true }));

  test('readBoundedTextFile reads small files and refuses directories, oversized, and missing files', async () => {
    const small = path.join(dir, 'small.yml');
    const big = path.join(dir, 'big.yml');
    const folder = path.join(dir, 'folder.yml');
    writeFileSync(small, 'spec: {}\n');
    writeFileSync(big, Buffer.alloc(MAX_LOCAL_INCLUDE_BYTES + 1, 'a'));
    mkdirSync(folder);

    assert.equal(await readBoundedTextFile(small), 'spec: {}\n');
    assert.equal(await readBoundedTextFile(big), null);
    assert.equal(await readBoundedTextFile(folder), null);
    assert.equal(await readBoundedTextFile(path.join(dir, 'missing.yml')), null);
  });
});

suite('security: child process hygiene', function () {
  this.timeout(10000);
  const node = process.execPath;

  test('runCommand kills a child that outlives the timeout', async () => {
    const started = Date.now();
    const output = await runCommand(node, process.cwd(), ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: CHILD_TIMEOUT_MS });

    assert.equal(output, null);
    assert.ok(Date.now() - started < 5000);
  });

  test('runCommand drops output over the cap', async () => {
    const output = await runCommand(node, process.cwd(), ['-e', "process.stdout.write('x'.repeat(100000))"], { maxOutputBytes: 64 * 1024 });

    assert.equal(output, null);
  });

  test('runCommand collects all stdout before resolving', async () => {
    const size = 60000;
    const output = await runCommand(node, process.cwd(), ['-e', `process.stdout.write('y'.repeat(${size}))`]);

    assert.equal(output?.length, size);
  });

  test('runCommand strips git redirection variables and disables prompts', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { GIT_DIR: '/evil', GIT_WORK_TREE: '/evil', GIT_CONFIG_COUNT: '1', GIT_CONFIG_GLOBAL: '/evil' });
    try {
      const script = "const e = process.env; process.stdout.write(JSON.stringify([e.GIT_DIR, e.GIT_WORK_TREE, e.GIT_CONFIG_COUNT, e.GIT_CONFIG_GLOBAL, e.GIT_TERMINAL_PROMPT]))";
      const output = await runCommand(node, process.cwd(), ['-e', script]);

      assert.equal(output, '[null,null,null,null,"0"]');
    } finally {
      for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL']) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});

suite('security: regex and remote parsing', () => {
  test('extractLocalIncludePath is linear on a long whitespace line', () => {
    const started = Date.now();

    assert.equal(extractLocalIncludePath(`${' '.repeat(40000)}x`), null);
    assert.ok(Date.now() - started < FAST_MS, `took ${Date.now() - started}ms`);
  });

  test('parseGitLabRemoteUrl rejects a remote whose host is not a plain hostname', () => {
    assert.equal(parseGitLabRemoteUrl('git@gitlab.com@evil.example:g/p.git'), null);
    assert.deepStrictEqual(parseGitLabRemoteUrl('git@gitlab.example.com:g/p.git'), { gitlabInstance: 'gitlab.example.com', projectPath: 'g/p' });
    assert.deepStrictEqual(parseGitLabRemoteUrl('https://gitlab.com/g/p.git'), { gitlabInstance: 'gitlab.com', projectPath: 'g/p' });
  });
});
