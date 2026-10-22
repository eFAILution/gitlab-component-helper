/**
 * How the extension launches the MCP server: arguments, environment, and the tokens to hand over. Pure, so it can be
 * unit-tested without VS Code.
 */

import { CONFIG_DEFAULTS, WORKSPACE_SETTABLE_KEYS, type ConfigKey } from '../core/config/defaults';
import { DEFAULT_GITLAB_HOST, normalizeHost } from './adapters/network';
import { TOKENS_JSON_ENV } from './adapters/secrets';

/** Settings never passed to the server: the deprecated plain-text token is not a setting the server accepts. */
const WITHHELD_SETTINGS: ReadonlySet<ConfigKey> = new Set(['gitlabToken']);

export interface ServerLaunchPlan {
  cwd: string;
  roots: string[];
}

/**
 * Whether to offer the server, and where to run it.
 *
 * @returns `null` when the server is disabled or there is no workspace folder to give it as a root.
 */
export function serverLaunchPlan(workspaceFolders: readonly string[], enabled: boolean): ServerLaunchPlan | null {
  if (!enabled || workspaceFolders.length === 0) return null;
  return { cwd: workspaceFolders[0], roots: [...workspaceFolders] };
}

/** The definition version. VS Code restarts the server when it changes, so token changes bump `revision`. */
export function definitionVersion(packageVersion: string, revision: number): string {
  return `${packageVersion}+${revision}`;
}

export function buildServerArgs(serverScript: string, workspaceFolders: readonly string[]): string[] {
  return [serverScript, ...workspaceFolders.flatMap((folder) => ['--root', folder])];
}

/**
 * The settings to pass as `GCH_CONFIG_JSON`, with withheld keys left out. Keys a workspace may set use the effective
 * value; every other key (network, cache, logging) uses the user-scope value, because the server trusts this layer
 * and the workspace's `.vscode/settings.json` must not reach it that way.
 *
 * @param getEffective The value VS Code resolves for the workspace.
 * @param getUser      The user (global) value, else the default.
 */
export function effectiveSettings(
  getEffective: (key: ConfigKey) => unknown,
  getUser: (key: ConfigKey) => unknown
): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(CONFIG_DEFAULTS) as ConfigKey[])
      .filter((key) => !WITHHELD_SETTINGS.has(key))
      .map((key) => [key, WORKSPACE_SETTABLE_KEYS.has(key) ? getEffective(key) : getUser(key)])
  );
}

/**
 * @param trustedHosts Hosts from the user's own (global) settings; the only configured hosts the server may contact
 *   besides gitlab.com and hosts with a token.
 */
export function buildServerEnv(settings: Record<string, unknown>, cacheDir: string, trustedHosts: readonly string[]): Record<string, string> {
  return {
    // Runs the editor's Electron binary as plain Node.
    ELECTRON_RUN_AS_NODE: '1',
    GCH_CONFIG_JSON: JSON.stringify(settings),
    GCH_CACHE_DIR: cacheDir,
    ...(trustedHosts.length > 0 ? { GCH_TRUSTED_HOSTS: trustedHosts.join(',') } : {}),
  };
}

/** The instances named by a componentSources value, normalized and de-duplicated. */
export function userSourceHosts(componentSources: unknown): string[] {
  if (!Array.isArray(componentSources)) return [];
  const hosts = componentSources.map((source) =>
    normalizeHost(typeof source?.gitlabInstance === 'string' ? source.gitlabInstance : DEFAULT_GITLAB_HOST));
  return [...new Set(hosts)].filter(Boolean);
}

/**
 * The hosts to look up stored tokens for: the token index, plus the user's global componentSources (which covers
 * tokens saved before the index existed). Never workspace or folder settings, which a cloned repository controls.
 */
export function tokenCandidateHosts(indexedHosts: readonly string[], userComponentSources: unknown): string[] {
  return [...new Set([...indexedHosts.map(normalizeHost), ...userSourceHosts(userComponentSources)])].filter(Boolean);
}

/** Hand tokens over as one `GCH_TOKENS_JSON` map, so each token binds to exactly the host it was stored for. */
export function buildTokenEnv(tokens: ReadonlyMap<string, string>): Record<string, string> {
  if (tokens.size === 0) return {};
  return { [TOKENS_JSON_ENV]: JSON.stringify(Object.fromEntries(tokens)) };
}
