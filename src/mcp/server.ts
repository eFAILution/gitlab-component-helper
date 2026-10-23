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
  type RequestId,
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
/** How long one tool call may run. */
export const DEFAULT_TOOL_TIMEOUT_MS = 60000;
/** How many tool calls may run at once; more are turned away rather than queued without bound. */
export const DEFAULT_MAX_CONCURRENT_TOOL_CALLS = 4;

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
  toolTimeoutMs?: number;
  maxConcurrentToolCalls?: number;
}

class ToolTimeoutError extends Error {}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError()), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
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
  private toolCallsInFlight = 0;
  private readonly pending = new Set<RequestId>();
  private readonly cancelled = new Set<RequestId>();

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
        const handled = this.handleLine(line)
          .then((response) => {
            if (response) transport.send(response);
          })
          .catch((error: unknown) => logger.error(`[MCP] Could not answer a request: ${error}`, 'MCP'));
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
        return undefined;
      case 'notification':
        this.handleNotification(parsed.message.method, parsed.message.params ?? {});
        return undefined;
      case 'request': {
        const { id } = parsed.message;
        this.pending.add(id);
        try {
          const response = await this.handleRequest(parsed.message);
          // A cancelled request gets no response, as the protocol asks.
          return this.cancelled.delete(id) ? undefined : response;
        } finally {
          this.pending.delete(id);
        }
      }
    }
  }

  /**
   * `notifications/cancelled` marks a pending request so its result is dropped. The work itself runs to completion
   * (or its deadline); tools don't take an abort signal.
   */
  private handleNotification(method: string, params: Record<string, unknown>): void {
    const { requestId } = params;
    if (method === 'notifications/cancelled' && (typeof requestId === 'string' || typeof requestId === 'number') && this.pending.has(requestId)) {
      this.cancelled.add(requestId);
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
    // Bad arguments are the model's mistake to correct, so they come back as a tool error it can read.
    const problem = validateValue(tool.definition.inputSchema, rawArgs);
    if (problem) {
      return toolErrorResult(`Invalid arguments for ${tool.definition.name}: ${problem}`);
    }

    const limit = this.options.maxConcurrentToolCalls ?? DEFAULT_MAX_CONCURRENT_TOOL_CALLS;
    if (this.toolCallsInFlight >= limit) {
      return toolErrorResult(`Too many tool calls in progress (${limit}). Wait for one to finish, then try again.`);
    }
    const timeoutMs = this.options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

    let output: ToolOutput;
    this.toolCallsInFlight++;
    try {
      output = await withDeadline(tool.run(rawArgs as Record<string, unknown>), timeoutMs);
    } catch (error) {
      if (error instanceof ToolError) return toolErrorResult(error.message);
      if (error instanceof ToolTimeoutError) {
        return toolErrorResult(`${tool.definition.name} took longer than ${timeoutMs / 1000}s and was stopped. Try a narrower path.`);
      }
      logger.error(`[MCP] Tool ${tool.definition.name} failed: ${error}`, 'MCP');
      return toolErrorResult(`${tool.definition.name} failed unexpectedly. Check the server log for details.`);
    } finally {
      this.toolCallsInFlight--;
    }

    const result = toolResult(output, this.protocolVersion);
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
      return toolErrorResult(`The ${tool.definition.name} result is too large. Narrow the request, e.g. pass a single file path.`);
    }
    return result;
  }
}
