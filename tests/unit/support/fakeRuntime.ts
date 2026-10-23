import { createDefaultRuntime, setRuntime } from '../../../src/core/runtime';
import type { ConfigKey } from '../../../src/core/config/defaults';
import type { LogLevelName, RuntimePorts, SecretsPort } from '../../../src/core/ports';

export interface FakeRuntime {
  lines: string[];
  levels: Array<LogLevelName | undefined>;
  configReads: ConfigKey[];
}

/**
 * Install a runtime whose config returns `settings` (falling back to the caller's fallback) and whose log sink
 * records every line. `ports` replaces any other port. Restore the default runtime with {@link restoreRuntime}.
 */
export function installFakeRuntime(
  settings: Partial<Record<ConfigKey, unknown>> = {},
  ports: Partial<RuntimePorts> = {},
): FakeRuntime {
  const fake: FakeRuntime = { lines: [], levels: [], configReads: [] };
  const runtime: RuntimePorts = {
    ...createDefaultRuntime(),
    config: {
      get: <T>(key: ConfigKey, fallback: T): T => {
        fake.configReads.push(key);
        return key in settings ? (settings[key] as T) : fallback;
      },
    },
    log: {
      appendLine: (line, level) => {
        fake.lines.push(line);
        fake.levels.push(level);
      },
    },
    ...ports,
  };
  setRuntime(runtime);
  return fake;
}

export function restoreRuntime(): void {
  setRuntime(createDefaultRuntime());
}

/** An in-memory secrets port that supports `store`, plus the map behind it. */
export function createMemorySecrets(): { secrets: SecretsPort; values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    secrets: {
      get: async (key) => values.get(key),
      store: async (key, value) => {
        values.set(key, value);
      },
    },
  };
}
