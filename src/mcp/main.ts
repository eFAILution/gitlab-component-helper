/**
 * Entry point of the standalone MCP server (`out/mcp/server.js`). Speaks MCP over stdio; logs go to stderr.
 */

import { Writable } from 'node:stream';
import { Logger } from '../utils/logger';
import { McpServer } from './server';
import { createStreamTransport } from './transport/stdio';
import { createTools, SERVER_INSTRUCTIONS } from './tools';
import { createComponentServices } from './services';
import { bootstrap } from './bootstrap';
import { ArgsError, USAGE } from './adapters/args';

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
  // The client closing its end (EPIPE) means it's gone: there is nobody left to answer, so stop cleanly.
  const onStdoutError = (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') process.exit(0);
    Logger.getInstance().error(`[MCP] stdout failed: ${error}`, 'MCP');
    process.exit(1);
  };
  process.stdout.on('error', onStdoutError);
  protocolOut.on('error', onStdoutError);
  return protocolOut;
}

/** Log what would otherwise crash the server. A single failed request shouldn't take down the session. */
function installCrashHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    Logger.getInstance().error(`[MCP] Unhandled rejection: ${reason}`, 'MCP');
  });
  process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    Logger.getInstance().error(`[MCP] Uncaught exception: ${error.stack ?? error}`, 'MCP');
  });
}

async function main(): Promise<void> {
  installCrashHandlers();
  const protocolOut = claimStdout();
  const context = await bootstrap(process.argv.slice(2), process.env, process.cwd());
  const server = new McpServer({
    info: { name: SERVER_NAME, title: SERVER_TITLE, version: typeof GCH_VERSION === 'string' ? GCH_VERSION : '0.0.0-dev' },
    instructions: SERVER_INSTRUCTIONS,
    tools: createTools({ ...context, services: createComponentServices(context.isHostAllowed, context.specCache) }),
  });
  await server.connect(createStreamTransport(process.stdin, protocolOut));
  // Let the last responses flush before exiting; pending timers would otherwise keep the process alive.
  await new Promise<void>((resolve) => protocolOut.end(resolve));
}

main().then(
  () => process.exit(0),
  (error) => {
    if (error instanceof ArgsError) {
      process.stderr.write(`${error.message}\n\n${USAGE}\n`);
      process.exit(2);
    }
    Logger.getInstance().error(`[MCP] Server stopped: ${error}`, 'MCP');
    process.exit(1);
  }
);
