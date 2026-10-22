/**
 * Tokens for the MCP server, from the environment: `GCH_TOKEN_<HOST>` per instance (host upper-cased, with `.`,
 * `-`, and `:` turned into `_`, e.g. `GCH_TOKEN_GITLAB_COM`), and `GITLAB_TOKEN` for the host in `GITLAB_HOST`
 * (default gitlab.com). They are read once and deleted from `process.env`, so child processes never inherit them.
 *
 * The variable name loses information (`gitlab.example.com` and `gitlab-example.com` share one), so a token is only
 * bound to a host named by a trusted source (the launcher's settings, `GCH_TOKEN_HOSTS`, or `GITLAB_HOST`), never by a
 * file in the workspace, and never when two trusted hosts share a variable name.
 */

import type { SecretsPort } from '../../core/ports';
import { DEFAULT_GITLAB_HOST, normalizeHost } from './network';

export const TOKEN_ENV_PREFIX = 'GCH_TOKEN_';
const TOKEN_KEY_PREFIX = 'gitlab-token-';

/** The `GCH_TOKEN_*` variable name for a GitLab host. */
export function tokenEnvName(host: string): string {
  return `${TOKEN_ENV_PREFIX}${normalizeHost(host).toUpperCase().replace(/[.:-]/g, '_')}`;
}

export interface EnvTokens {
  /** Token per variable name, e.g. `GCH_TOKEN_GITLAB_COM`. */
  byEnvName: Map<string, string>;
  /** The host `GITLAB_TOKEN` applies to, when it was set. */
  fallbackHost?: string;
  fallbackToken?: string;
}

/**
 * Read the token variables from `env` and delete them from it.
 */
export function takeEnvTokens(env: NodeJS.ProcessEnv): EnvTokens {
  const byEnvName = new Map<string, string>();
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith(TOKEN_ENV_PREFIX)) {
      if (value) byEnvName.set(name, value);
      delete env[name];
    }
  }
  const fallbackToken = env.GITLAB_TOKEN || undefined;
  const fallbackHost = fallbackToken ? normalizeHost(env.GITLAB_HOST || DEFAULT_GITLAB_HOST) : undefined;
  delete env.GITLAB_TOKEN;
  return { byEnvName, fallbackHost, fallbackToken };
}

/**
 * Bind each token to the one trusted host whose variable name it was set under.
 *
 * @returns Token per normalized host.
 */
export function bindTokens(tokens: EnvTokens, trustedHosts: Iterable<string>, warn: (message: string) => void): Map<string, string> {
  const hostsByName = new Map<string, string[]>();
  for (const host of new Set([...trustedHosts].map(normalizeHost).filter(Boolean))) {
    const name = tokenEnvName(host);
    hostsByName.set(name, [...(hostsByName.get(name) ?? []), host]);
  }
  const bound = new Map<string, string>();
  for (const [name, hosts] of hostsByName) {
    const token = tokens.byEnvName.get(name);
    if (!token) continue;
    if (hosts.length > 1) {
      warn(`Not using ${name}: it could belong to ${hosts.join(' or ')}`);
      continue;
    }
    bound.set(hosts[0], token);
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
