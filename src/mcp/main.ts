/**
 * Entry point of the standalone MCP server (`out/mcp/server.js`). Speaks MCP over stdio; logs go to stderr.
 */

import { Writable } from 'node:stream';
import { Logger } from '../utils/logger';
import { McpServer } from './server';
import { createStreamTransport } from './transport/stdio';
import { createGetComponentSpecTool } from './tools/getComponentSpec';
import { createComponentServices } from './services';

declare const GCH_VERSION: string | undefined;

const SERVER_NAME = 'gitlab-component-helper';
const SERVER_TITLE = 'GitLab Component Helper';

/**
 * Give the transport the real stdout and point `process.stdout.write` at stderr, so a stray `console.log` anywhere in
 * the bundle can't corrupt the JSON-RPC stream.
 */
function claimStdout(): Writable {
  const writeToStdout = process.stdout.write.bind(process.stdout);
  const protocolOut = new Writable({
    write(chunk, _encoding, callback) {
      writeToStdout(chunk, callback);
    },
  });
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  return protocolOut;
}

async function main(): Promise<void> {
  const protocolOut = claimStdout();
  const server = new McpServer({
    info: { name: SERVER_NAME, title: SERVER_TITLE, version: typeof GCH_VERSION === 'string' ? GCH_VERSION : '0.0.0-dev' },
    tools: [createGetComponentSpecTool(createComponentServices())],
  });
  await server.connect(createStreamTransport(process.stdin, protocolOut));
  // Let the last responses flush before exiting; pending timers would otherwise keep the process alive.
  await new Promise<void>((resolve) => protocolOut.end(resolve));
}

main().then(
  () => process.exit(0),
  (error) => {
    Logger.getInstance().error(`[MCP] Server stopped: ${error}`, 'MCP');
    process.exit(1);
  }
);
