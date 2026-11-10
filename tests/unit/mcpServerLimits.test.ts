// @mocha
/**
 * Server-side limits on tool calls: a per-call deadline and a cap on calls in flight.
 */

import * as assert from 'node:assert/strict';
import { McpServer, type Tool } from '../../src/mcp/server';
import { connectFakeClient } from './support/mcpClient';

const SHORT_DEADLINE_MS = 200;

function blockingTool(release: Promise<void>): Tool {
  return {
    definition: { name: 'wait', description: 'Waits', inputSchema: { type: 'object' } },
    run: async () => {
      await release;
      return { data: { done: true } };
    },
  };
}

suite('McpServer limits', () => {
  test('a tool call past its deadline becomes an isError result', async () => {
    const server = new McpServer({ info: { name: 't', version: '1' }, tools: [blockingTool(new Promise(() => undefined))], toolTimeoutMs: SHORT_DEADLINE_MS });
    const client = connectFakeClient(server);
    const result = (await client.request('tools/call', { name: 'wait', arguments: {} })).result as { isError?: boolean; content: Array<{ text: string }> };

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /took longer than/);
  });

  test('calls beyond the concurrency cap are turned away', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = new McpServer({ info: { name: 't', version: '1' }, tools: [blockingTool(gate)], maxConcurrentToolCalls: 2 });
    const client = connectFakeClient(server);

    const first = client.request('tools/call', { name: 'wait', arguments: {} });
    const second = client.request('tools/call', { name: 'wait', arguments: {} });
    const third = (await client.request('tools/call', { name: 'wait', arguments: {} })).result as { isError?: boolean; content: Array<{ text: string }> };
    release();

    assert.equal(third.isError, true);
    assert.match(third.content[0].text, /Too many tool calls/);
    assert.equal(((await first).result as { isError?: boolean }).isError, undefined);
    assert.equal(((await second).result as { isError?: boolean }).isError, undefined);
    await client.close();
  });
});
