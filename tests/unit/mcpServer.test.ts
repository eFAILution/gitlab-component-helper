// @mocha
/**
 * The MCP dispatcher over in-memory streams: handshake and version negotiation, JSON-RPC errors, tool argument
 * validation, result shaping per protocol version, and stdout hygiene.
 */

import * as assert from 'node:assert/strict';
import { McpServer, ToolError, MAX_RESULT_BYTES, type Tool } from '../../src/mcp/server';
import { SUPPORTED_PROTOCOL_VERSIONS } from '../../src/mcp/protocol/types';
import { connectFakeClient, type FakeClient } from './support/mcpClient';

const echoTool: Tool = {
  definition: {
    name: 'echo',
    description: 'Echo',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  run: async (args) => {
    if (args.text === 'fail') throw new ToolError('You asked it to fail.');
    if (args.text === 'crash') throw new Error('secret internal detail');
    if (args.text === 'huge') return { data: { text: 'x'.repeat(MAX_RESULT_BYTES) } };
    return { summary: 'Echoed.', data: { text: args.text } };
  },
};

function createServer(): McpServer {
  return new McpServer({ info: { name: 'test', version: '1.0.0' }, instructions: 'Use echo.', tools: [echoTool] });
}

async function initialized(protocolVersion: string): Promise<{ client: FakeClient; result: Record<string, unknown> }> {
  const client = connectFakeClient(createServer());
  const response = await client.request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'c', version: '1' } });
  client.notify('notifications/initialized');
  return { client, result: response.result as Record<string, unknown> };
}

suite('McpServer handshake', () => {
  test('echoes a supported protocol version and returns server info, capabilities, and instructions', async () => {
    const { client, result } = await initialized('2025-06-18');

    assert.deepStrictEqual(result, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'test', version: '1.0.0' },
      instructions: 'Use echo.',
    });
    await client.close();
  });

  test('answers an unsupported version with the newest supported one', async () => {
    const { client, result } = await initialized('1999-01-01');

    assert.equal(result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
    await client.close();
  });

  test('supports 2025-06-18 and 2025-03-26', () => {
    assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes('2025-06-18'));
    assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes('2025-03-26'));
  });

  test('ping returns an empty result', async () => {
    const { client } = await initialized('2025-06-18');

    assert.deepStrictEqual((await client.request('ping')).result, {});
    await client.close();
  });
});

suite('McpServer JSON-RPC errors', () => {
  test('unknown methods get -32601, including the stateless-revision server/discover probe', async () => {
    const { client } = await initialized('2025-06-18');

    for (const method of ['resources/list', 'server/discover']) {
      const response = await client.request(method);
      assert.equal((response.error as { code: number }).code, -32601, method);
    }
    await client.close();
  });

  test('malformed lines get -32700 and non-JSON-RPC objects get -32600', async () => {
    const client = connectFakeClient(createServer());

    assert.equal(((await client.sendRaw('{nope')).error as { code: number }).code, -32700);
    assert.equal(((await client.sendRaw('{"id":1,"method":"ping"}')).error as { code: number }).code, -32600);
    await client.close();
  });

  test('bad tool arguments and unknown tools get -32602', async () => {
    const { client } = await initialized('2025-06-18');

    const calls = [
      { name: 'echo', arguments: {} },
      { name: 'echo', arguments: { text: 1 } },
      { name: 'echo', arguments: { text: 'a', extra: true } },
      { name: 'missing', arguments: {} },
    ];
    for (const params of calls) {
      const response = await client.request('tools/call', params);
      assert.equal((response.error as { code: number }).code, -32602, JSON.stringify(params));
    }
    await client.close();
  });
});

suite('McpServer tools', () => {
  test('tools/list includes outputSchema and annotations on 2025-06-18', async () => {
    const { client } = await initialized('2025-06-18');
    const { tools } = (await client.request('tools/list')).result as { tools: Array<Record<string, unknown>> };

    assert.deepStrictEqual(tools[0].annotations, { readOnlyHint: true, openWorldHint: false });
    assert.ok(tools[0].outputSchema);
    await client.close();
  });

  test('tools/list leaves outputSchema out on 2025-03-26', async () => {
    const { client } = await initialized('2025-03-26');
    const { tools } = (await client.request('tools/list')).result as { tools: Array<Record<string, unknown>> };

    assert.equal(tools[0].outputSchema, undefined);
    assert.ok(tools[0].annotations);
    await client.close();
  });

  test('tools/call returns a text block plus structuredContent on 2025-06-18', async () => {
    const { client } = await initialized('2025-06-18');
    const result = (await client.request('tools/call', { name: 'echo', arguments: { text: 'hi' } })).result;

    assert.deepStrictEqual(result, {
      content: [{ type: 'text', text: 'Echoed.\n\n{\n  "text": "hi"\n}' }],
      structuredContent: { text: 'hi' },
    });
    await client.close();
  });

  test('tools/call returns only the text block on 2025-03-26', async () => {
    const { client } = await initialized('2025-03-26');
    const result = (await client.request('tools/call', { name: 'echo', arguments: { text: 'hi' } })).result as Record<string, unknown>;

    assert.equal(result.structuredContent, undefined);
    assert.equal((result.content as unknown[]).length, 1);
    await client.close();
  });

  test('a ToolError becomes an isError result with its message; other errors stay generic', async () => {
    const { client } = await initialized('2025-06-18');

    const failed = (await client.request('tools/call', { name: 'echo', arguments: { text: 'fail' } })).result;
    assert.deepStrictEqual(failed, { content: [{ type: 'text', text: 'You asked it to fail.' }], isError: true });

    const crashed = (await client.request('tools/call', { name: 'echo', arguments: { text: 'crash' } })).result as Record<string, unknown>;
    assert.equal(crashed.isError, true);
    assert.doesNotMatch(JSON.stringify(crashed), /secret internal detail/);
    await client.close();
  });

  test('a result over the size cap becomes an isError result', async () => {
    const { client } = await initialized('2025-06-18');
    const result = (await client.request('tools/call', { name: 'echo', arguments: { text: 'huge' } })).result as Record<string, unknown>;

    assert.equal(result.isError, true);
    await client.close();
  });

  test('nothing but the transport writes to process.stdout during a tool call', async () => {
    const { client } = await initialized('2025-06-18');
    const original = process.stdout.write;
    const stray: unknown[] = [];
    process.stdout.write = ((chunk: unknown) => {
      stray.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await client.request('tools/call', { name: 'echo', arguments: { text: 'hi' } });
      await client.request('tools/call', { name: 'echo', arguments: { text: 'crash' } });
    } finally {
      process.stdout.write = original;
    }
    assert.deepStrictEqual(stray, []);
    await client.close();
  });
});
