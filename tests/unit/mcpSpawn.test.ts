// @mocha
/**
 * Builds the MCP server bundle and talks to it over real stdio, the way an MCP client launches it.
 */

import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import { buildBundle, REPO_ROOT, startServer } from './support/mcpProcess';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { noVscodePlugin } = require('../../esbuild.mcp.js');
const BUILD_TIMEOUT_MS = 30000;

suite('MCP server bundle', function () {
  this.timeout(BUILD_TIMEOUT_MS);
  const dir = mkdtempSync(join(tmpdir(), 'gch-mcp-'));
  let bundle: string;

  suiteSetup(async () => {
    bundle = await buildBundle(dir);
  });
  suiteTeardown(() => rmSync(dir, { recursive: true, force: true }));

  test('answers initialize, tools/list, and ping over stdio, then exits cleanly when stdin closes', async () => {
    const server = startServer(bundle);
    let stdoutNoise = '';
    server.child.stderr.on('data', () => undefined);

    const init = await server.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    server.child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    const list = await server.request('tools/list');
    const ping = await server.request('ping');
    server.child.stdout.on('data', (chunk: string) => {
      stdoutNoise += chunk;
    });

    assert.equal((init.result as Record<string, unknown>).protocolVersion, '2025-06-18');
    const names = ((list.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    assert.ok(names.includes('get_component_spec'));
    assert.deepStrictEqual(ping.result, {});
    assert.equal(await server.stop(), 0);
    assert.equal(stdoutNoise, '');
  });

  test('the build fails on a vscode import', async () => {
    await assert.rejects(
      esbuild.build({
        stdin: { contents: "import * as vscode from 'vscode'; console.error(vscode);", resolveDir: REPO_ROOT, loader: 'ts' },
        bundle: true,
        write: false,
        platform: 'node',
        logLevel: 'silent',
        plugins: [noVscodePlugin],
      }),
      /must not import vscode/
    );
  });
});
