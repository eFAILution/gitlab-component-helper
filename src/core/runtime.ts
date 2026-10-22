/**
 * Process-wide host ports. The extension installs its VS Code adapters with {@link setRuntime} at the top of
 * `activate`; anything that runs before that, or outside VS Code, gets {@link createDefaultRuntime}: package.json
 * setting defaults, no secrets, in-memory storage, log lines on stderr, and no auth prompt. Unit tests need no setup.
 */

import { CONFIG_DEFAULTS } from './config/defaults';
import type { AuthPromptPort, ConfigPort, LogSink, RuntimePorts, SecretsPort, StoragePort } from './ports';

const defaultsConfig: ConfigPort = {
  get: <T>(key: keyof typeof CONFIG_DEFAULTS, fallback: T): T =>
    key in CONFIG_DEFAULTS ? (structuredClone(CONFIG_DEFAULTS[key]) as T) : fallback,
};

const noSecrets: SecretsPort = {
  get: async () => undefined,
};

const noAuthPrompt: AuthPromptPort = {
  promptForToken: async () => undefined,
};

function createMemoryStorage(): StoragePort {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => {
      if (value === undefined) {
        values.delete(key);
        return;
      }
      values.set(key, value);
    },
  };
}

// stderr, never stdout: the MCP server speaks JSON-RPC on stdout.
const stderrSink: LogSink = {
  appendLine: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

export function createDefaultRuntime(): RuntimePorts {
  return {
    config: defaultsConfig,
    secrets: noSecrets,
    storage: createMemoryStorage(),
    log: stderrSink,
    authPrompt: noAuthPrompt,
  };
}

let current: RuntimePorts = createDefaultRuntime();
let locked = false;

export function setRuntime(ports: RuntimePorts): void {
  if (locked) {
    throw new Error('The runtime is locked; ports can only be set once at startup');
  }
  current = ports;
}

/**
 * Refuse any later {@link setRuntime} and freeze the ports, so nothing loaded after startup can swap or patch them
 * (the MCP server).
 */
export function lockRuntime(): void {
  if (current.network) Object.freeze(current.network);
  Object.freeze(current);
  locked = true;
}

export function isRuntimeLocked(): boolean {
  return locked;
}

export function getRuntime(): RuntimePorts {
  return current;
}
