/**
 * Newline-delimited JSON-RPC over a pair of streams (stdin/stdout for the real server, fakes in tests). This is the
 * only module that writes protocol output.
 */

import type { Readable, Writable } from 'node:stream';
import { Logger } from '../../utils/logger';

/** Longest line accepted. A client that sends more is dropped rather than buffered without bound. */
export const MAX_LINE_BYTES = 4 * 1024 * 1024;

export interface Transport {
  /** Register the handler for each received line. */
  onLine(handler: (line: string) => void): void;
  /** Called once when the input ends or a line is too long. */
  onClose(handler: () => void): void;
  send(message: unknown): void;
}

export function createStreamTransport(input: Readable, output: Writable): Transport {
  let lineHandler: (line: string) => void = () => undefined;
  let closeHandler: () => void = () => undefined;
  let buffer = '';
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    closeHandler();
  };

  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line.trim() !== '') lineHandler(line);
      newline = buffer.indexOf('\n');
    }
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
      Logger.getInstance().error(`[MCP] Closing the connection: the client sent a line longer than ${MAX_LINE_BYTES} bytes`, 'MCP');
      buffer = '';
      input.destroy();
      close();
    }
  });
  input.on('end', close);
  input.on('close', close);

  return {
    onLine: (handler) => {
      lineHandler = handler;
    },
    onClose: (handler) => {
      closeHandler = handler;
    },
    send: (message) => {
      output.write(`${JSON.stringify(message)}\n`);
    },
  };
}
