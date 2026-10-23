import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mcpConfig } = require('../../../esbuild.mcp.js');

export const REPO_ROOT = resolve(__dirname, '../../..');

export interface SpawnedServer {
  child: ChildProcessWithoutNullStreams;
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  stop(): Promise<number | null>;
  stderr(): string;
}

export function startServer(bundle: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): SpawnedServer {
  const child = spawn(process.execPath, [bundle, ...args], { cwd: REPO_ROOT, env: { ...process.env, ...env } });
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  // A crashed server answers every pending request with its stderr, so tests fail fast with the reason.
  child.on('exit', (code) => {
    pending.forEach((resolveResponse) => resolveResponse({ error: { code: 'exited', message: `exit ${code}: ${stderr}` } }));
    pending.clear();
  });
  let nextId = 1;
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const message = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      buffer = buffer.slice(newline + 1);
      pending.get(message.id as number)?.(message);
      pending.delete(message.id as number);
      newline = buffer.indexOf('\n');
    }
  });
  return {
    child,
    request: (method, params) =>
      new Promise((resolveResponse) => {
        const id = nextId++;
        pending.set(id, resolveResponse);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
      }),
    stop: () =>
      new Promise((resolveExit) => {
        if (child.exitCode !== null) return resolveExit(child.exitCode);
        child.on('exit', (code) => resolveExit(code));
        child.stdin.end();
      }),
    stderr: () => stderr,
  };
}

export async function buildBundle(dir: string): Promise<string> {
  const outfile = join(dir, 'server.js');
  await esbuild.build({ ...mcpConfig({ outfile }), absWorkingDir: REPO_ROOT, sourcemap: false });
  return outfile;
}
