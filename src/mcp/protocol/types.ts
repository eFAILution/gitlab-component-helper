/**
 * The slice of the Model Context Protocol this server speaks: the initialize handshake, ping, and tools.
 *
 * Only the handshake-based ("legacy") revisions are implemented. The stateless 2026-07-28 revision is not: a client
 * that probes with `server/discover` gets "method not found", which the spec tells dual-era clients to treat as a
 * legacy server and fall back to `initialize`.
 */

/** Supported revisions, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/** The first revision with tool `outputSchema` and `structuredContent`. */
const STRUCTURED_CONTENT_SINCE: ProtocolVersion = '2025-06-18';

/** Echo the client's revision when supported; otherwise answer with our newest and let the client decide. */
export function negotiateProtocolVersion(requested: unknown): ProtocolVersion {
  const match = SUPPORTED_PROTOCOL_VERSIONS.find((version) => version === requested);
  return match ?? SUPPORTED_PROTOCOL_VERSIONS[0];
}

export function supportsStructuredContent(version: ProtocolVersion): boolean {
  // Revision strings are ISO dates, so they order lexically.
  return version >= STRUCTURED_CONTENT_SINCE;
}

/** A JSON Schema object, restricted to what our tool schemas use. */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly string[];
  additionalProperties?: boolean;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface CallToolResult {
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ServerInfo {
  name: string;
  title?: string;
  version: string;
}
