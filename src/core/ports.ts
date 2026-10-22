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

/**
 * Asks the user for a GitLab token after a request was refused. Hosts without a UI return `undefined`, which the core
 * treats as "no token, use public access".
 */
export interface AuthPromptPort {
  /**
   * @param instance The GitLab host the token is for (e.g. `gitlab.com`).
   * @param hadToken Whether a stored token was just rejected (replace it) or there was none (first-time auth).
   * @returns The token the user entered, already stored, or `undefined` if they gave none.
   */
  promptForToken(instance: string, hadToken: boolean): Promise<string | undefined>;
}

export interface RuntimePorts {
  config: ConfigPort;
  secrets: SecretsPort;
  storage: StoragePort;
  log: LogSink;
  authPrompt: AuthPromptPort;
}
