/**
 * JSON-RPC 2.0 message shapes and parsing, as MCP uses them over stdio: one JSON object per line, no batches.
 */

export const JSONRPC_VERSION = '2.0';

export const ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type RequestId = string | number;

export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: RequestId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: typeof JSONRPC_VERSION; id: RequestId; result: unknown }
  | { jsonrpc: typeof JSONRPC_VERSION; id: RequestId | null; error: JsonRpcError };

/** A thrown error that becomes a JSON-RPC error response. */
export class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
}

export type ParsedMessage =
  | { kind: 'request'; message: JsonRpcRequest }
  | { kind: 'notification'; message: JsonRpcNotification }
  | { kind: 'response' }
  | { kind: 'invalid'; id: RequestId | null; error: JsonRpcError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value));
}

/**
 * Classify one line of input.
 *
 * @returns A request, a notification, a response (which this server ignores; it sends no requests), or an invalid
 *   message with the error to answer it with.
 */
export function parseMessage(line: string): ParsedMessage {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: 'invalid', id: null, error: { code: ErrorCode.PARSE_ERROR, message: 'Parse error' } };
  }
  if (!isRecord(value) || value.jsonrpc !== JSONRPC_VERSION) {
    return { kind: 'invalid', id: null, error: { code: ErrorCode.INVALID_REQUEST, message: 'Invalid Request' } };
  }
  const id = isRequestId(value.id) ? value.id : null;
  if (typeof value.method !== 'string') {
    if ('result' in value || 'error' in value) return { kind: 'response' };
    return { kind: 'invalid', id, error: { code: ErrorCode.INVALID_REQUEST, message: 'Invalid Request' } };
  }
  if (value.params !== undefined && !isRecord(value.params)) {
    return { kind: 'invalid', id, error: { code: ErrorCode.INVALID_PARAMS, message: 'params must be an object' } };
  }
  const params = value.params as Record<string, unknown> | undefined;
  if (!('id' in value)) {
    return { kind: 'notification', message: { jsonrpc: JSONRPC_VERSION, method: value.method, params } };
  }
  if (id === null) {
    return { kind: 'invalid', id: null, error: { code: ErrorCode.INVALID_REQUEST, message: 'Invalid Request: bad id' } };
  }
  return { kind: 'request', message: { jsonrpc: JSONRPC_VERSION, id, method: value.method, params } };
}

export function resultResponse(id: RequestId, result: unknown): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function errorResponse(id: RequestId | null, error: JsonRpcError): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, error };
}
