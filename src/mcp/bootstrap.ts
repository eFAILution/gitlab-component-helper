/**
 * Build the MCP server's runtime from its arguments and environment, install it once, and lock it.
 */

import { CONFIG_DEFAULTS } from '../core/config/defaults';
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

/** Layers set by whoever launched the server, as opposed to files in the (possibly untrusted) workspace. */
const LAUNCHER_LAYERS = new Set(['--config', 'GCH_CONFIG_JSON']);

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
  // Take the tokens out of the environment before anything else can read or pass it on.
  const tokens = takeEnvTokens(env);
  const args = parseArgs(argv, cwd);
  const workspace = createMcpWorkspace(args.roots);
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);

  const fileLayers = await loadConfigLayers({ cliJson: args.configJson, env, root: workspace.roots()[0], warn });
  const layers: ConfigLayer[] = args.logLevel
    ? [{ name: '--log-level', settings: toSettings({ logLevel: args.logLevel }, '--log-level', warn) }, ...fileLayers]
    : fileLayers;
  const config = createLayeredConfig(layers);

  const trustedHosts = [
    ...layers.filter((layer) => LAUNCHER_LAYERS.has(layer.name)).flatMap((layer) => sourceHosts(layer.settings.componentSources)),
    ...(env.GCH_TOKEN_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean),
  ];
  const bound = bindTokens(tokens, trustedHosts, warn);
  const network = createNetworkPolicy([
    DEFAULT_GITLAB_HOST,
    ...sourceHosts(config.get('componentSources', CONFIG_DEFAULTS.componentSources)),
    ...bound.keys(),
  ]);

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
