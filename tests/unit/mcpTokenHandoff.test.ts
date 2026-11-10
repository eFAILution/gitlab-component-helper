// @mocha
/**
 * The extension hands tokens to the MCP server through a one-time file, not the environment: a process's starting
 * environment stays readable to the same user (`ps eww`), even after the server deletes the variable. The file is
 * private to the user, read once by the server, and deleted.
 */

import * as assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeEnvTokens } from '../../src/mcp/adapters/secrets';
import {
  HANDOFF_DIR_NAME,
  HANDOFF_ENV,
  HANDOFF_TTL_MS,
  purgeTokenHandoffs,
  readTokenHandoff,
  writeTokenHandoff,
} from '../../src/mcp/tokenHandoff';
import { buildTokenEnv } from '../../src/mcp/launchConfig';

const POSIX = process.platform !== 'win32';
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const PERMISSION_BITS = 0o777;

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'gch-handoff-'));
}

suite('MCP token hand-off file', () => {
  test('writes the tokens to a private, randomly named file in a private directory', async () => {
    const dir = join(scratchDir(), HANDOFF_DIR_NAME);
    const file = await writeTokenHandoff(dir, new Map([['gitlab.example.com', 'glpat-one']]));

    assert.ok(file && file.startsWith(dir));
    if (POSIX) {
      assert.equal(statSync(file).mode & PERMISSION_BITS, PRIVATE_FILE_MODE);
      assert.equal(statSync(dir).mode & PERMISSION_BITS, PRIVATE_DIR_MODE);
    }
    const second = await writeTokenHandoff(dir, new Map([['gitlab.com', 'glpat-two']]));
    assert.notEqual(second, file);
  });

  test('writes nothing when there are no tokens', async () => {
    const dir = join(scratchDir(), HANDOFF_DIR_NAME);
    assert.equal(await writeTokenHandoff(dir, new Map()), undefined);
    assert.equal(existsSync(dir) && readdirSync(dir).length > 0, false);
  });

  test('the launch env carries only the file path, never a token', async () => {
    const dir = join(scratchDir(), HANDOFF_DIR_NAME);
    const env = await buildTokenEnv(new Map([['gitlab.example.com', 'glpat-secret']]), dir);

    assert.deepStrictEqual(Object.keys(env), [HANDOFF_ENV]);
    assert.ok(!JSON.stringify(env).includes('glpat-secret'));
    assert.deepStrictEqual(await buildTokenEnv(new Map(), dir), {});
  });

  test('the server reads the file once, binds each token to its exact host, and deletes the file and the variable', async () => {
    const dir = join(scratchDir(), HANDOFF_DIR_NAME);
    const file = await writeTokenHandoff(dir, new Map([['gitlab.example.com', 'glpat-one\n']]));
    const env: NodeJS.ProcessEnv = { [HANDOFF_ENV]: file };

    const tokens = takeEnvTokens(env);

    assert.equal(tokens.exact.get('gitlab.example.com'), 'glpat-one');
    assert.equal(existsSync(file as string), false);
    assert.equal(env[HANDOFF_ENV], undefined);
  });

  test('refuses a hand-off file another user could read, without reading it', function () {
    if (!POSIX) this.skip();
    const dir = join(scratchDir(), HANDOFF_DIR_NAME);
    mkdirSync(dir, { mode: 0o700 });
    const file = join(dir, `gch-tokens-${'a'.repeat(32)}.json`);
    writeFileSync(file, JSON.stringify({ 'gitlab.com': 'glpat-x' }));
    chmodSync(file, 0o644);
    const warnings: string[] = [];

    assert.equal(readTokenHandoff(file, (message) => warnings.push(message)), undefined);
    assert.ok(warnings.some((message) => message.includes('readable by other users')));
    assert.ok(warnings.every((message) => !message.includes('glpat-x')));
  });

  test('refuses a symlinked hand-off file and leaves its target alone', function () {
    if (!POSIX) this.skip();
    const dir = join(scratchDir(), HANDOFF_DIR_NAME);
    mkdirSync(dir, { mode: 0o700 });
    const target = join(dir, 'real.json');
    writeFileSync(target, JSON.stringify({ 'gitlab.com': 'glpat-x' }), { mode: PRIVATE_FILE_MODE });
    const link = join(dir, `gch-tokens-${'b'.repeat(32)}.json`);
    symlinkSync(target, link);
    const warnings: string[] = [];

    assert.equal(readTokenHandoff(link, (message) => warnings.push(message)), undefined);
    assert.ok(existsSync(target));
    assert.ok(warnings.some((message) => message.includes('not a regular file')));
  });

  test('refuses to read or delete a file that is not a hand-off file, even a private one', () => {
    const dir = scratchDir();
    const key = join(dir, 'id_ed25519');
    writeFileSync(key, 'not tokens', { mode: PRIVATE_FILE_MODE });
    const warnings: string[] = [];

    assert.equal(readTokenHandoff(key, (message) => warnings.push(message)), undefined);
    assert.ok(existsSync(key));
    assert.ok(warnings.some((message) => message.includes('not a hand-off file')));
  });

  test('refuses a hand-off file whose folder other users can open', function () {
    if (!POSIX) this.skip();
    const dir = join(scratchDir(), HANDOFF_DIR_NAME);
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    const file = join(dir, `gch-tokens-${'c'.repeat(32)}.json`);
    writeFileSync(file, JSON.stringify({ 'gitlab.com': 'glpat-x' }), { mode: PRIVATE_FILE_MODE });
    const warnings: string[] = [];

    assert.equal(readTokenHandoff(file, (message) => warnings.push(message)), undefined);
    assert.ok(existsSync(file));
    assert.ok(warnings.some((message) => message.includes('folder is not private')));
  });

  test('keeps the tokens when the file was read but could not be deleted', async function () {
    if (!POSIX) this.skip();
    const dir = join(scratchDir(), HANDOFF_DIR_NAME);
    const file = await writeTokenHandoff(dir, new Map([['gitlab.com', 'glpat-keep']]));
    chmodSync(dir, 0o500);
    const warnings: string[] = [];
    try {
      const text = readTokenHandoff(file as string, (message) => warnings.push(message));
      assert.ok(text?.includes('glpat-keep'));
      assert.ok(warnings.some((message) => message.includes('could not be deleted')));
    } finally {
      chmodSync(dir, PRIVATE_DIR_MODE);
    }
  });

  test('purge removes stale hand-off files, keeps fresh ones another window may be using, and nothing else', async () => {
    const dir = join(scratchDir(), HANDOFF_DIR_NAME);
    const file = await writeTokenHandoff(dir, new Map([['gitlab.com', 'glpat-x']]));
    const other = join(dir, 'keep.txt');
    writeFileSync(other, 'not a hand-off');

    await purgeTokenHandoffs(dir);
    assert.ok(existsSync(file as string), 'a fresh hand-off file was purged');

    await purgeTokenHandoffs(dir, HANDOFF_TTL_MS, Date.now() + 2 * HANDOFF_TTL_MS);
    assert.equal(existsSync(file as string), false);
    assert.ok(existsSync(other));
    await purgeTokenHandoffs(join(dir, 'missing'));
  });
});
