/**
 * Process-wide host ports. The extension installs its VS Code adapters with {@link setRuntime} at the top of
 * `activate`; anything that runs before that, or outside VS Code, gets {@link createDefaultRuntime}: package.json
 * setting defaults, no secrets, in-memory storage, and log lines on stderr. Unit tests need no setup.
 */

import { CONFIG_DEFAULTS } from './config/defaults';
import type { ConfigPort, LogSink, RuntimePorts, SecretsPort, StoragePort } from './ports';

const defaultsConfig: ConfigPort = {
  get: <T>(key: keyof typeof CONFIG_DEFAULTS, fallback: T): T =>
    key in CONFIG_DEFAULTS ? (structuredClone(CONFIG_DEFAULTS[key]) as T) : fallback,
};

const noSecrets: SecretsPort = {
  get: async () => undefined,
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
  return { config: defaultsConfig, secrets: noSecrets, storage: createMemoryStorage(), log: stderrSink };
}

let current: RuntimePorts = createDefaultRuntime();

export function setRuntime(ports: RuntimePorts): void {
  current = ports;
}

export function getRuntime(): RuntimePorts {
  return current;
}
