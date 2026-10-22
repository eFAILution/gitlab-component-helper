/**
 * How the extension launches the MCP server: arguments, environment, and the tokens to hand over. Pure, so it can be
 * unit-tested without VS Code.
 */

import { CONFIG_DEFAULTS, type ConfigKey } from '../core/config/defaults';
import { DEFAULT_GITLAB_HOST, normalizeHost } from './adapters/network';
import { tokenEnvName } from './adapters/secrets';

/** Settings never passed to the server: the deprecated plain-text token is not a setting the server accepts. */
const WITHHELD_SETTINGS: ReadonlySet<ConfigKey> = new Set(['gitlabToken']);

export function buildServerArgs(serverScript: string, workspaceFolders: readonly string[]): string[] {
  return [serverScript, ...workspaceFolders.flatMap((folder) => ['--root', folder])];
}

/** The effective settings to pass as `GCH_CONFIG_JSON`, read through `get`, with withheld keys left out. */
export function effectiveSettings(get: (key: ConfigKey) => unknown): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(CONFIG_DEFAULTS) as ConfigKey[]).filter((key) => !WITHHELD_SETTINGS.has(key)).map((key) => [key, get(key)])
  );
}

export function buildServerEnv(settings: Record<string, unknown>, cacheDir: string): Record<string, string> {
  return {
    // Runs the editor's Electron binary as plain Node.
    ELECTRON_RUN_AS_NODE: '1',
    GCH_CONFIG_JSON: JSON.stringify(settings),
    GCH_CACHE_DIR: cacheDir,
  };
}

/** Every instance with a token record or a configured source, normalized and de-duplicated. */
export function tokenCandidateHosts(indexedHosts: readonly string[], componentSources: unknown): string[] {
  const sourceHosts = Array.isArray(componentSources)
    ? componentSources.map((source) => normalizeHost(typeof source?.gitlabInstance === 'string' ? source.gitlabInstance : DEFAULT_GITLAB_HOST))
    : [];
  return [...new Set([...indexedHosts.map(normalizeHost), ...sourceHosts])].filter(Boolean);
}

/**
 * The environment entries that hand tokens to the server: one `GCH_TOKEN_<HOST>` per host, and `GCH_TOKEN_HOSTS`
 * naming the hosts so the server can bind each token to exactly one.
 */
export function buildTokenEnv(tokens: ReadonlyMap<string, string>): Record<string, string> {
  if (tokens.size === 0) return {};
  const env: Record<string, string> = { GCH_TOKEN_HOSTS: [...tokens.keys()].join(',') };
  for (const [host, token] of tokens) env[tokenEnvName(host)] = token;
  return env;
}
