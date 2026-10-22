/**
 * The MCP dispatcher: handles the initialize handshake, ping, and tools over any {@link Transport}. Tools are plain
 * async functions registered with a definition; the server validates their arguments and shapes their results.
 */

import { Logger } from '../utils/logger';
import {
  ErrorCode,
  RpcError,
  errorResponse,
  parseMessage,
  resultResponse,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol/jsonrpc';
import {
  negotiateProtocolVersion,
  supportsStructuredContent,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
  type ProtocolVersion,
  type ServerInfo,
  type ToolDefinition,
} from './protocol/types';
import { validateValue } from './protocol/validate';
import type { Transport } from './transport/stdio';

const logger = Logger.getInstance();

/** Largest tool result sent, in bytes of JSON. Bigger results become a tool error asking for a narrower call. */
export const MAX_RESULT_BYTES = 512 * 1024;

/** A failure the agent should see and can act on, e.g. "file not found under the workspace roots". */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface ToolOutput {
  data: Record<string, unknown>;
  /** A short human summary for the text block. The JSON data is appended to it. */
  summary?: string;
}

export interface Tool {
  definition: ToolDefinition;
  run(args: Record<string, unknown>): Promise<ToolOutput>;
}

export interface McpServerOptions {
  info: ServerInfo;
  instructions?: string;
  tools: Tool[];
}

function toolResult(output: ToolOutput, version: ProtocolVersion): CallToolResult {
  const json = JSON.stringify(output.data, null, 2);
  const text = output.summary ? `${output.summary}\n\n${json}` : json;
  return supportsStructuredContent(version)
    ? { content: [{ type: 'text', text }], structuredContent: output.data }
    : { content: [{ type: 'text', text }] };
}

function toolErrorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export class McpServer {
  private readonly tools = new Map<string, Tool>();
  private protocolVersion: ProtocolVersion = SUPPORTED_PROTOCOL_VERSIONS[0];

  constructor(private readonly options: McpServerOptions) {
    options.tools.forEach((tool) => this.tools.set(tool.definition.name, tool));
  }

  /** Serve requests from `transport` until its input closes and every request in flight has been answered. */
  connect(transport: Transport): Promise<void> {
    const inFlight = new Set<Promise<void>>();
    return new Promise((resolve) => {
      transport.onClose(() => {
        Promise.allSettled([...inFlight]).then(() => resolve());
      });
      transport.onLine((line) => {
        const handled = this.handleLine(line).then((response) => {
          if (response) transport.send(response);
        });
        inFlight.add(handled);
        handled.finally(() => inFlight.delete(handled));
      });
    });
  }

  /** Handle one input line. Resolves to the response to send, or `undefined` for notifications. */
  async handleLine(line: string): Promise<JsonRpcResponse | undefined> {
    const parsed = parseMessage(line);
    switch (parsed.kind) {
      case 'invalid':
        return errorResponse(parsed.id, parsed.error);
      case 'response':
      case 'notification':
        return undefined;
      case 'request':
        return this.handleRequest(parsed.message);
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      return resultResponse(request.id, await this.dispatch(request.method, request.params ?? {}));
    } catch (error) {
      if (error instanceof RpcError) {
        return errorResponse(request.id, { code: error.code, message: error.message, data: error.data });
      }
      logger.error(`[MCP] ${request.method} failed: ${error}`, 'MCP');
      return errorResponse(request.id, { code: ErrorCode.INTERNAL_ERROR, message: 'Internal error' });
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params);
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: [...this.tools.values()].map((tool) => this.describe(tool.definition)) };
      case 'tools/call':
        return this.callTool(params);
      default:
        throw new RpcError(ErrorCode.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  private initialize(params: Record<string, unknown>): Record<string, unknown> {
    this.protocolVersion = negotiateProtocolVersion(params.protocolVersion);
    return {
      protocolVersion: this.protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: this.options.info,
      ...(this.options.instructions ? { instructions: this.options.instructions } : {}),
    };
  }

  private describe(definition: ToolDefinition): ToolDefinition {
    if (supportsStructuredContent(this.protocolVersion)) return definition;
    // `title` and `outputSchema` arrived in 2025-06-18.
    const { name, description, inputSchema, annotations } = definition;
    return { name, description, inputSchema, ...(annotations ? { annotations } : {}) };
  }

  private async callTool(params: Record<string, unknown>): Promise<CallToolResult> {
    const { name, arguments: rawArgs = {} } = params;
    const tool = typeof name === 'string' ? this.tools.get(name) : undefined;
    if (!tool) {
      throw new RpcError(ErrorCode.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
    }
    const problem = validateValue(tool.definition.inputSchema, rawArgs);
    if (problem) {
      throw new RpcError(ErrorCode.INVALID_PARAMS, `Invalid arguments for ${tool.definition.name}: ${problem}`);
    }

    let output: ToolOutput;
    try {
      output = await tool.run(rawArgs as Record<string, unknown>);
    } catch (error) {
      if (error instanceof ToolError) return toolErrorResult(error.message);
      logger.error(`[MCP] Tool ${tool.definition.name} failed: ${error}`, 'MCP');
      return toolErrorResult(`${tool.definition.name} failed unexpectedly. Check the server log for details.`);
    }

    const result = toolResult(output, this.protocolVersion);
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
      return toolErrorResult(`The ${tool.definition.name} result is too large. Narrow the request, e.g. pass a single file path.`);
    }
    return result;
  }
}
