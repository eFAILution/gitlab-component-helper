/**
 * Settings for the MCP server, layered (highest first): `--config`, `GCH_CONFIG_JSON`, `GCH_LOG_LEVEL` (for
 * `logLevel`), `<root>/.gitlab-component-helper.json`, `<root>/.vscode/settings.json` (`gitlabComponentHelper.*`,
 * JSONC), then the package.json defaults. `gitlabToken` is refused: tokens come from the environment only.
 */

import * as path from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { CONFIG_DEFAULTS, CONFIG_SECTION, type ConfigKey } from '../../core/config/defaults';
import type { ConfigPort } from '../../core/ports';
import { readBoundedTextFile } from '../../adapters/node/readTextFile';

export const REPO_CONFIG_FILE = '.gitlab-component-helper.json';
const VSCODE_SETTINGS_FILE = path.join('.vscode', 'settings.json');
const REFUSED_KEYS = new Set(['gitlabToken']);

export type Settings = Partial<Record<ConfigKey, unknown>>;

export interface ConfigLayer {
  name: string;
  settings: Settings;
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
export function toSettings(raw: Record<string, unknown>, layer: string, warn: (message: string) => void): Settings {
  const settings: Settings = {};
  for (const [key, value] of Object.entries(raw)) {
    if (REFUSED_KEYS.has(key)) {
      warn(`Ignoring ${key} from ${layer}: tokens are read from GCH_TOKEN_<HOST> or GITLAB_TOKEN only`);
      continue;
    }
    if (!(key in CONFIG_DEFAULTS)) {
      warn(`Ignoring unknown setting ${key} from ${layer}`);
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
export function parseJsonSettings(text: string, layer: string, warn: (message: string) => void): Settings {
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
  return toSettings(raw, layer, warn);
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
  return toSettings(ours, layer, warn);
}

export interface ConfigSources {
  cliJson?: string;
  env: NodeJS.ProcessEnv;
  /** The first workspace root; its config files are read. */
  root: string;
  warn(message: string): void;
}

export async function loadConfigLayers({ cliJson, env, root, warn }: ConfigSources): Promise<ConfigLayer[]> {
  const layers: ConfigLayer[] = [];
  if (cliJson) layers.push({ name: '--config', settings: parseJsonSettings(cliJson, '--config', warn) });
  if (env.GCH_CONFIG_JSON) {
    layers.push({ name: 'GCH_CONFIG_JSON', settings: parseJsonSettings(env.GCH_CONFIG_JSON, 'GCH_CONFIG_JSON', warn) });
  }
  if (env.GCH_LOG_LEVEL) layers.push({ name: 'GCH_LOG_LEVEL', settings: { logLevel: env.GCH_LOG_LEVEL } });

  const repoFile = await readBoundedTextFile(path.join(root, REPO_CONFIG_FILE));
  if (repoFile !== null) layers.push({ name: REPO_CONFIG_FILE, settings: parseJsonSettings(repoFile, REPO_CONFIG_FILE, warn) });
  const vscodeFile = await readBoundedTextFile(path.join(root, VSCODE_SETTINGS_FILE));
  if (vscodeFile !== null) {
    layers.push({ name: VSCODE_SETTINGS_FILE, settings: parseVscodeSettings(vscodeFile, VSCODE_SETTINGS_FILE, warn) });
  }
  return layers;
}

/** A config port answering from the first layer that sets a key, then the defaults. */
export function createLayeredConfig(layers: readonly ConfigLayer[]): ConfigPort & { effective(): Settings } {
  const lookup = (key: ConfigKey): unknown => {
    const layer = layers.find((candidate) => candidate.settings[key] !== undefined);
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
