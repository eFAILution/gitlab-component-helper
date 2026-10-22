/**
 * Tokens for the MCP server, read once from the environment and deleted from it, so child processes never inherit
 * them:
 *
 * - `GCH_TOKENS_JSON`: `{"<host[:port]>": "<token>"}`, how the extension hands tokens over. Each token is bound to
 *   exactly its key.
 * - `GCH_TOKEN_<HOST>`: for terminal use. The host is upper-cased with `.`, `-`, and `:` turned into `_`, so the name
 *   is lossy (`gitlab.example.com` and `gitlab-example.com` share one). Such a token is only bound to a host named in
 *   `GCH_TOKEN_HOSTS` or in `--config` componentSources, never to one from a workspace file, and to neither of two
 *   named hosts that share a variable name.
 * - `GITLAB_TOKEN`: for the host in `GITLAB_HOST` (default gitlab.com).
 */

import type { SecretsPort } from '../../core/ports';
import { DEFAULT_GITLAB_HOST, normalizeHost } from './network';

export const TOKEN_ENV_PREFIX = 'GCH_TOKEN_';
export const TOKENS_JSON_ENV = 'GCH_TOKENS_JSON';
export const TOKEN_HOSTS_ENV = 'GCH_TOKEN_HOSTS';
const TOKEN_KEY_PREFIX = 'gitlab-token-';

/** The `GCH_TOKEN_*` variable name for a GitLab host. */
export function tokenEnvName(host: string): string {
  return `${TOKEN_ENV_PREFIX}${normalizeHost(host).toUpperCase().replace(/[.:-]/g, '_')}`;
}

export interface EnvTokens {
  /** From `GCH_TOKENS_JSON`, keyed by normalized host. */
  exact: Map<string, string>;
  /** From `GCH_TOKEN_<HOST>`, keyed by variable name. */
  byEnvName: Map<string, string>;
  /** Hosts listed in `GCH_TOKEN_HOSTS`. */
  namedHosts: string[];
  /** The host `GITLAB_TOKEN` applies to, when it was set. */
  fallbackHost?: string;
  fallbackToken?: string;
}

function parseTokensJson(text: string | undefined, warn: (message: string) => void): Map<string, string> {
  const exact = new Map<string, string>();
  if (!text) return exact;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    warn(`Ignoring ${TOKENS_JSON_ENV}: not valid JSON`);
    return exact;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    warn(`Ignoring ${TOKENS_JSON_ENV}: expected an object of host to token`);
    return exact;
  }
  for (const [host, token] of Object.entries(raw)) {
    if (typeof token === 'string' && token !== '' && host.trim() !== '') exact.set(normalizeHost(host), token);
  }
  return exact;
}

/**
 * Read every token variable from `env`, then delete them all (and `GCH_TOKEN_HOSTS`) from it.
 */
export function takeEnvTokens(env: NodeJS.ProcessEnv, warn: (message: string) => void = () => undefined): EnvTokens {
  const exact = parseTokensJson(env[TOKENS_JSON_ENV], warn);
  const namedHosts = (env[TOKEN_HOSTS_ENV] ?? '').split(',').map((host) => host.trim()).filter(Boolean).map(normalizeHost);
  delete env[TOKENS_JSON_ENV];
  delete env[TOKEN_HOSTS_ENV];

  const byEnvName = new Map<string, string>();
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(TOKEN_ENV_PREFIX)) continue;
    if (value) byEnvName.set(name, value);
    delete env[name];
  }
  const fallbackToken = env.GITLAB_TOKEN || undefined;
  const fallbackHost = fallbackToken ? normalizeHost(env.GITLAB_HOST || DEFAULT_GITLAB_HOST) : undefined;
  delete env.GITLAB_TOKEN;
  return { exact, byEnvName, namedHosts, fallbackHost, fallbackToken };
}

/**
 * Bind tokens to hosts.
 *
 * @param cliHosts Hosts from `--config` componentSources; with `GCH_TOKEN_HOSTS`, the only hosts a `GCH_TOKEN_<HOST>`
 *   variable can bind to.
 * @returns Token per normalized host.
 */
export function bindTokens(tokens: EnvTokens, cliHosts: Iterable<string>, warn: (message: string) => void): Map<string, string> {
  const bound = new Map(tokens.exact);
  const hostsByName = new Map<string, string[]>();
  for (const host of new Set([...tokens.namedHosts, ...[...cliHosts].map(normalizeHost)].filter(Boolean))) {
    const name = tokenEnvName(host);
    hostsByName.set(name, [...(hostsByName.get(name) ?? []), host]);
  }
  for (const [name, hosts] of hostsByName) {
    const token = tokens.byEnvName.get(name);
    if (!token) continue;
    if (hosts.length > 1) {
      warn(`Not using ${name}: it could belong to ${hosts.join(' or ')}`);
      continue;
    }
    if (!bound.has(hosts[0])) bound.set(hosts[0], token);
  }
  if (tokens.fallbackHost && tokens.fallbackToken && !bound.has(tokens.fallbackHost)) {
    bound.set(tokens.fallbackHost, tokens.fallbackToken);
  }
  return bound;
}

/** A read-only secrets port over bound tokens; there is no `store`, so the server never saves one. */
export function createEnvSecrets(bound: ReadonlyMap<string, string>): SecretsPort {
  return {
    get: async (key) => {
      if (!key.startsWith(TOKEN_KEY_PREFIX)) return undefined;
      return bound.get(normalizeHost(key.slice(TOKEN_KEY_PREFIX.length)));
    },
  };
}
