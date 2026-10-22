/**
 * Build the MCP server's runtime from its arguments and environment, install it once, and lock it.
 */

import { createDefaultRuntime, lockRuntime, setRuntime } from '../core/runtime';
import type { RepoContextPort } from '../core/referenceResolver';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
import { Logger } from '../utils/logger';
import { createGitCliRepoContext } from '../adapters/node/repoContext';
import type { ComponentSource } from '../types/api';
import { parseArgs } from './adapters/args';
import { createLayeredConfig, loadConfigLayers, toSettings, type ConfigLayer } from './adapters/config';
import { resolveGitPath } from './adapters/gitPath';
import { createNetworkPolicy, DEFAULT_GITLAB_HOST, normalizeHost } from './adapters/network';
import { bindTokens, createEnvSecrets, takeEnvTokens } from './adapters/secrets';
import { createFileStorage, resolveCacheDir } from './adapters/storage';
import { createMcpWorkspace, type McpWorkspace } from './adapters/workspace';

/** Hosts from the launcher's user-level settings (the extension passes the user's global componentSources). */
const TRUSTED_HOSTS_ENV = 'GCH_TRUSTED_HOSTS';

export interface McpContext {
  workspace: McpWorkspace;
  repoContext: RepoContextPort<string>;
  /** Whether the server may contact a GitLab host. */
  isHostAllowed(host: string): boolean;
}

function sourceHosts(sources: unknown): string[] {
  if (!Array.isArray(sources)) return [];
  return (sources as ComponentSource[])
    .filter((source) => source && typeof source === 'object')
    .map((source) => normalizeHost(typeof source.gitlabInstance === 'string' ? source.gitlabInstance : DEFAULT_GITLAB_HOST));
}

const noRepoContext: RepoContextPort<string> = { remoteContext: async () => ({}), nonGitLabRemote: async () => null };

export async function bootstrap(argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<McpContext> {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  // Take the tokens out of the environment before anything else can read or pass it on.
  const tokens = takeEnvTokens(env, warn);
  const args = parseArgs(argv, cwd);
  const workspace = createMcpWorkspace(args.roots);

  const fileLayers = await loadConfigLayers({ cliJson: args.configJson, env, root: workspace.roots()[0], workspace, warn });
  const layers: ConfigLayer[] = args.logLevel
    ? [{ name: '--log-level', settings: toSettings({ logLevel: args.logLevel }, '--log-level', warn) }, ...fileLayers]
    : fileLayers;
  const config = createLayeredConfig(layers);

  // Only the launcher widens the allowlist: --config sources, the user's own settings (GCH_TRUSTED_HOSTS), token hosts,
  // and gitlab.com. componentSources from GCH_CONFIG_JSON or workspace files still drive the catalog, but a host they
  // name alone is never contacted: a cloned repository must not choose where the server sends requests.
  const cliHosts = sourceHosts(layers.find((layer) => layer.name === '--config')?.settings.componentSources);
  // gitlab.com is ours, not the workspace's, so GCH_TOKEN_GITLAB_COM works without naming it.
  const bound = bindTokens(tokens, [DEFAULT_GITLAB_HOST, ...cliHosts], warn);
  const userHosts = (env[TRUSTED_HOSTS_ENV] ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  const network = createNetworkPolicy([DEFAULT_GITLAB_HOST, ...cliHosts, ...userHosts, ...tokens.namedHosts, ...bound.keys()]);

  setRuntime({
    ...createDefaultRuntime(),
    config,
    secrets: createEnvSecrets(bound),
    storage: createFileStorage(resolveCacheDir(args.cacheDir, env)),
    network,
  });
  lockRuntime();

  const logger = Logger.getInstance();
  logger.reloadLogLevel();
  warnings.forEach((message) => logger.warn(`[MCP] ${message}`, 'MCP'));
  getComponentCacheManager({ eagerRefresh: false });

  const gitPath = resolveGitPath(env);
  if (!gitPath) logger.warn('[MCP] git not found on PATH; CI variables like $CI_SERVER_FQDN will not be expanded', 'MCP');
  return {
    workspace,
    repoContext: gitPath ? createGitCliRepoContext({ gitPath, allowedRoots: workspace.roots() }) : noRepoContext,
    isHostAllowed: network.isAllowed,
  };
}
