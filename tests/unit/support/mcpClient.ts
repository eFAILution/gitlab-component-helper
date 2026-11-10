import { PassThrough } from 'node:stream';
import { McpServer } from '../../../src/mcp/server';
import { createStreamTransport } from '../../../src/mcp/transport/stdio';

export interface FakeClient {
  /** Send a request and resolve with its response. */
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Send a raw line; resolves with the next response that arrives. */
  sendRaw(line: string): Promise<Record<string, unknown>>;
  notify(method: string, params?: Record<string, unknown>): void;
  close(): Promise<void>;
}

/** Connect `server` to in-memory streams and drive it like a client. */
export function connectFakeClient(server: McpServer): FakeClient {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = server.connect(createStreamTransport(input, output));
  const pending = new Map<unknown, (message: Record<string, unknown>) => void>();
  const unmatched: Array<(message: Record<string, unknown>) => void> = [];
  let nextId = 1;
  let buffer = '';

  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const message = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      buffer = buffer.slice(newline + 1);
      const resolve = pending.get(message.id) ?? unmatched.shift();
      pending.delete(message.id);
      resolve?.(message);
      newline = buffer.indexOf('\n');
    }
  });

  return {
    request: (method, params) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
      }),
    sendRaw: (line) =>
      new Promise((resolve) => {
        unmatched.push(resolve);
        input.write(`${line}\n`);
      }),
    notify: (method, params) => {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`);
    },
    close: async () => {
      input.end();
      await done;
    },
  };
}
