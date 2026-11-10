/**
 * Settings for the MCP server, layered (highest first): `--config`, `GCH_CONFIG_JSON`, `GCH_LOG_LEVEL` (for
 * `logLevel`), `<root>/.gitlab-component-helper.json`, `<root>/.vscode/settings.json` (`gitlabComponentHelper.*`,
 * JSONC), then the package.json defaults. `gitlabToken` is refused: tokens come from the environment only.
 */

import * as path from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { CONFIG_DEFAULTS, CONFIG_SECTION, WORKSPACE_SETTABLE_KEYS, type ConfigKey } from '../../core/config/defaults';
import type { ConfigPort } from '../../core/ports';
import { readBoundedTextFile } from '../../adapters/node/readTextFile';
import type { WorkspacePort } from '../../core/localInclude';

export const REPO_CONFIG_FILE = '.gitlab-component-helper.json';
const VSCODE_SETTINGS_FILE = path.join('.vscode', 'settings.json');
const REFUSED_KEYS = new Set(['gitlabToken']);

/**
 * The workspace files read here may only set {@link WORKSPACE_SETTABLE_KEYS}. Network, cache, and logging settings come
 * from the launcher: `--config`, or `GCH_CONFIG_JSON`, which the extension builds from user-scope values for exactly
 * those keys. Either way a cloned repository can't slow the server down or turn up its logging.
 */
const REPO_ALLOWED_KEYS: ReadonlySet<string> = WORKSPACE_SETTABLE_KEYS;

export type Settings = Partial<Record<ConfigKey, unknown>>;

export interface ConfigLayer {
  name: string;
  settings: Settings;
}

/** `Object.hasOwn`, which the es2018 lib this project targets lacks. */
function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Same JSON kind as the default: array, object, or the primitive `typeof`. */
function sameKind(value: unknown, reference: unknown): boolean {
  if (Array.isArray(reference)) return Array.isArray(value);
  if (isRecord(reference)) return isRecord(value);
  return typeof value === typeof reference;
}

/**
 * Keep only known settings of the right kind. Unknown keys, wrongly-typed values, and `gitlabToken` are dropped and
 * reported through `warn`.
 */
export function toSettings(
  raw: Record<string, unknown>,
  layer: string,
  warn: (message: string) => void,
  { fromWorkspace = false }: { fromWorkspace?: boolean } = {}
): Settings {
  // No prototype, so a `__proto__` key is just a key and lookups never see inherited values.
  const settings: Settings = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (REFUSED_KEYS.has(key)) {
      warn(`Ignoring ${key} from ${layer}: tokens are read from GCH_TOKENS_JSON, GCH_TOKEN_<HOST>, or GITLAB_TOKEN only`);
      continue;
    }
    if (!hasOwn(CONFIG_DEFAULTS, key)) {
      warn(`Ignoring unknown setting ${key} from ${layer}`);
      continue;
    }
    if (fromWorkspace && !REPO_ALLOWED_KEYS.has(key)) {
      warn(`Ignoring ${key}: it is not allowed in ${layer}; set it in your user settings or pass it with --config`);
      continue;
    }
    if (!sameKind(value, CONFIG_DEFAULTS[key as ConfigKey])) {
      warn(`Ignoring ${key} from ${layer}: expected the same type as its default`);
      continue;
    }
    settings[key as ConfigKey] = value;
  }
  return settings;
}

/** Parse a JSON settings object, or report why it isn't one. */
export function parseJsonSettings(
  text: string,
  layer: string,
  warn: (message: string) => void,
  options: { fromWorkspace?: boolean } = {}
): Settings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    warn(`Ignoring ${layer}: not valid JSON`);
    return {};
  }
  if (!isRecord(raw)) {
    warn(`Ignoring ${layer}: expected a JSON object`);
    return {};
  }
  return toSettings(raw, layer, warn, options);
}

/** The `gitlabComponentHelper.*` entries of a VS Code settings file, prefix removed. */
export function parseVscodeSettings(text: string, layer: string, warn: (message: string) => void): Settings {
  const errors: ParseError[] = [];
  const raw: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !isRecord(raw)) {
    warn(`Ignoring ${layer}: not a valid settings file`);
    return {};
  }
  const prefix = `${CONFIG_SECTION}.`;
  const ours = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value])
  );
  return toSettings(ours, layer, warn, { fromWorkspace: true });
}

export interface ConfigSources {
  cliJson?: string;
  env: NodeJS.ProcessEnv;
  /** The first workspace root; its config files are read. */
  root: string;
  /** Reads the files, so they get the workspace's containment checks. Defaults to a bounded read. */
  workspace?: Pick<WorkspacePort<string>, 'readText'>;
  warn(message: string): void;
}

export async function loadConfigLayers({ cliJson, env, root, workspace, warn }: ConfigSources): Promise<ConfigLayer[]> {
  const read = (file: string) => (workspace ? workspace.readText(file) : readBoundedTextFile(file));
  const layers: ConfigLayer[] = [];
  if (cliJson) layers.push({ name: '--config', settings: parseJsonSettings(cliJson, '--config', warn) });
  if (env.GCH_CONFIG_JSON) {
    layers.push({ name: 'GCH_CONFIG_JSON', settings: parseJsonSettings(env.GCH_CONFIG_JSON, 'GCH_CONFIG_JSON', warn) });
  }
  if (env.GCH_LOG_LEVEL) layers.push({ name: 'GCH_LOG_LEVEL', settings: { logLevel: env.GCH_LOG_LEVEL } });

  const repoFile = await read(path.join(root, REPO_CONFIG_FILE));
  if (repoFile !== null) {
    layers.push({ name: REPO_CONFIG_FILE, settings: parseJsonSettings(repoFile, REPO_CONFIG_FILE, warn, { fromWorkspace: true }) });
  }
  const vscodeFile = await read(path.join(root, VSCODE_SETTINGS_FILE));
  if (vscodeFile !== null) {
    layers.push({ name: VSCODE_SETTINGS_FILE, settings: parseVscodeSettings(vscodeFile, VSCODE_SETTINGS_FILE, warn) });
  }
  return layers;
}

/** A config port answering from the first layer that sets a key, then the defaults. */
export function createLayeredConfig(layers: readonly ConfigLayer[]): ConfigPort & { effective(): Settings } {
  const lookup = (key: ConfigKey): unknown => {
    const layer = layers.find((candidate) => hasOwn(candidate.settings, key) && candidate.settings[key] !== undefined);
    return layer ? layer.settings[key] : CONFIG_DEFAULTS[key];
  };
  return {
    get: <T>(key: ConfigKey, fallback: T): T => {
      const value = lookup(key);
      return value === undefined ? fallback : (structuredClone(value) as T);
    },
    effective: () => Object.fromEntries((Object.keys(CONFIG_DEFAULTS) as ConfigKey[]).map((key) => [key, lookup(key)])) as Settings,
  };
}
