import { createDefaultRuntime, setRuntime } from '../../../src/core/runtime';
import type { ConfigKey } from '../../../src/core/config/defaults';
import type { LogLevelName, RuntimePorts } from '../../../src/core/ports';

export interface FakeRuntime {
  lines: string[];
  levels: Array<LogLevelName | undefined>;
  configReads: ConfigKey[];
}

/**
 * Install a runtime whose config returns `settings` (falling back to the caller's fallback) and whose log sink
 * records every line. Restore the default runtime with {@link restoreRuntime}.
 */
export function installFakeRuntime(settings: Partial<Record<ConfigKey, unknown>> = {}): FakeRuntime {
  const fake: FakeRuntime = { lines: [], levels: [], configReads: [] };
  const ports: RuntimePorts = {
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
  };
  setRuntime(ports);
  return fake;
}

export function restoreRuntime(): void {
  setRuntime(createDefaultRuntime());
}
