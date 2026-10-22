/**
 * Host ports for the core. The core reads settings, secrets, persistent state, and log output only through these
 * interfaces, so it runs the same under the VS Code extension host and under plain Node (unit tests, the MCP
 * server). Adapters live in `src/adapters/<host>/`.
 */

import type { ConfigKey } from './config/defaults';

export type LogLevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Reads `gitlabComponentHelper.*` settings, keyed without the prefix. */
export interface ConfigPort {
  get<T>(key: ConfigKey, fallback: T): T;
}

export interface SecretsPort {
  get(key: string): Promise<string | undefined>;
  store?(key: string, value: string): Promise<void>;
}

export interface StoragePort {
  get<T>(key: string): Promise<T | undefined>;
  update(key: string, value: unknown): Promise<void>;
}

/**
 * Where formatted log lines go. `level` lets a host mirror warnings and errors elsewhere (the extension also sends
 * them to the developer console). `show` reveals the log to the user, if the host has a UI for it.
 */
export interface LogSink {
  appendLine(line: string, level?: LogLevelName): void;
  show?(preserveFocus?: boolean): void;
}

export interface RuntimePorts {
  config: ConfigPort;
  secrets: SecretsPort;
  storage: StoragePort;
  log: LogSink;
}
