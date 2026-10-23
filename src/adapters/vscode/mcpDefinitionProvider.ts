/**
 * Register the bundled MCP server with VS Code, so Copilot Chat (agent mode) and other in-editor MCP clients can
 * start it without any setup. Tokens are only handed over when VS Code starts the server, through a one-time private
 * file (never the environment), and never logged.
 */

import * as vscode from 'vscode';
import { CONFIG_DEFAULTS, CONFIG_SECTION } from '../../core/config/defaults';
import { getRuntime } from '../../core/runtime';
import type { Event } from '../../core/emitter';
import { Logger } from '../../utils/logger';
import {
  buildServerArgs,
  buildServerEnv,
  buildTokenEnv,
  definitionVersion,
  effectiveSettings,
  serverLaunchPlan,
  tokenCandidateHosts,
  userSourceHosts,
} from '../../mcp/launchConfig';
import { HANDOFF_DIR_NAME, HANDOFF_ENV, HANDOFF_TTL_MS, purgeTokenHandoffs, removeTokenHandoff } from '../../mcp/tokenHandoff';
import { buildCacheSeed, CACHE_SEED_DIR_NAME, CACHE_SEED_ENV, writeCacheSeed } from '../../mcp/cacheSeed';
import { getComponentCacheManager } from '../../services/cache/componentCacheManager';

export const MCP_PROVIDER_ID = 'gitlabComponentHelper.mcp';
const SERVER_LABEL = 'GitLab Component Helper';
const SERVER_SCRIPT = 'out/mcp/server.js';
const CACHE_DIR_NAME = 'mcp-cache';

export interface TokenSource {
  getTokenInstances(): Promise<string[]>;
  getTokenForInstance(instance: string): Promise<string | undefined>;
  readonly onDidChangeToken: Event<string>;
}

/** componentSources from the user's global settings (or the defaults), never from the workspace or a folder. */
function userComponentSources(): unknown {
  const inspected = vscode.workspace.getConfiguration(CONFIG_SECTION).inspect('componentSources');
  return inspected?.globalValue ?? inspected?.defaultValue ?? CONFIG_DEFAULTS.componentSources;
}

async function collectTokens(tokens: TokenSource): Promise<Map<string, string>> {
  const hosts = tokenCandidateHosts(await tokens.getTokenInstances(), userComponentSources());
  const found = new Map<string, string>();
  for (const host of hosts) {
    const token = await tokens.getTokenForInstance(host);
    if (token) found.set(host, token);
  }
  return found;
}

/** After a burst of cache changes, rewrite the seed once. */
const SEED_REWRITE_DELAY_MS = 2000;

/** Write the extension's component cache for the server to read. A failure only costs the server some fetches. */
async function writeSeed(dir: string): Promise<string | undefined> {
  try {
    const { components, clearedAt } = getComponentCacheManager().peekCache();
    return await writeCacheSeed(dir, buildCacheSeed(components, clearedAt));
  } catch (error) {
    Logger.getInstance().debug(`[MCP] Could not write the cache seed: ${error}`, 'MCP');
    return undefined;
  }
}

/** Keep the seed in step with the cache while the server is on, so a running server sees later changes. */
function watchCacheForSeed(dir: string): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subscription = getComponentCacheManager().onDidChangeComponents(() => {
    if (!vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('mcp.enabled', CONFIG_DEFAULTS['mcp.enabled'])) return;
    clearTimeout(timer);
    timer = setTimeout(() => void writeSeed(dir), SEED_REWRITE_DELAY_MS);
  });
  return new vscode.Disposable(() => {
    clearTimeout(timer);
    subscription.dispose();
  });
}

/**
 * @returns The registration, or `undefined` when this VS Code has no MCP provider API.
 */
export function registerMcpServerProvider(context: vscode.ExtensionContext, tokens: TokenSource): vscode.Disposable | undefined {
  const logger = Logger.getInstance();
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function' || typeof vscode.McpStdioServerDefinition !== 'function') {
    logger.info('[MCP] This VS Code has no MCP server provider API; not registering the MCP server', 'MCP');
    return undefined;
  }

  // Tokens go to the server in one-time files here. Clear stale ones a previous session left behind.
  const handoffDir = vscode.Uri.joinPath(context.globalStorageUri, HANDOFF_DIR_NAME).fsPath;
  void purgeTokenHandoffs(handoffDir);
  const pendingHandoffs = new Map<string, ReturnType<typeof setTimeout>>();
  const seedDir = vscode.Uri.joinPath(context.globalStorageUri, CACHE_SEED_DIR_NAME).fsPath;

  const changed = new vscode.EventEmitter<void>();
  const fire = () => changed.fire();
  // Bumped on every token change and folded into the definition version, so VS Code restarts the server with them.
  let tokenRevision = 0;
  const onTokenChange = () => {
    tokenRevision++;
    fire();
  };
  const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: () => {
      const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file');
      // `mcp.enabled` is application-scoped, so a workspace can't turn the server on.
      const enabled = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('mcp.enabled', CONFIG_DEFAULTS['mcp.enabled']);
      const plan = serverLaunchPlan(folders.map((folder) => folder.uri.fsPath), enabled);
      if (!plan) return [];
      const { config } = getRuntime();
      const vscodeConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const settings = effectiveSettings(
        (key) => config.get(key, CONFIG_DEFAULTS[key]),
        (key) => {
          const inspected = vscodeConfig.inspect(key);
          return inspected?.globalValue ?? inspected?.defaultValue ?? CONFIG_DEFAULTS[key];
        }
      );
      const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, CACHE_DIR_NAME).fsPath;
      const definition = new vscode.McpStdioServerDefinition(
        SERVER_LABEL,
        process.execPath,
        buildServerArgs(context.asAbsolutePath(SERVER_SCRIPT), plan.roots),
        buildServerEnv(settings, cacheDir, userSourceHosts(userComponentSources())),
        definitionVersion(String(context.extension.packageJSON.version ?? ''), tokenRevision)
      );
      definition.cwd = vscode.Uri.file(plan.cwd);
      return [definition];
    },
    resolveMcpServerDefinition: async (server) => {
      const found = await collectTokens(tokens);
      logger.debug(`[MCP] Starting the MCP server with tokens for ${found.size} instance(s)`, 'MCP');
      const tokenEnv = await buildTokenEnv(found, handoffDir);
      const handoffFile = tokenEnv[HANDOFF_ENV];
      if (handoffFile) {
        // The server deletes the file as it starts; this catches a server that never did.
        pendingHandoffs.set(handoffFile, setTimeout(() => {
          pendingHandoffs.delete(handoffFile);
          void removeTokenHandoff(handoffFile);
        }, HANDOFF_TTL_MS));
      }
      const seedFile = await writeSeed(seedDir);
      server.env = { ...server.env, ...tokenEnv, ...(seedFile ? { [CACHE_SEED_ENV]: seedFile } : {}) };
      return server;
    },
  };

  return vscode.Disposable.from(
    changed,
    {
      // Only this window's files: other windows share the directory.
      dispose: () => {
        pendingHandoffs.forEach((timer, file) => {
          clearTimeout(timer);
          void removeTokenHandoff(file);
        });
        pendingHandoffs.clear();
      },
    },
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider),
    watchCacheForSeed(seedDir),
    tokens.onDidChangeToken(onTokenChange),
    vscode.workspace.onDidChangeWorkspaceFolders(fire),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) fire();
    })
  );
}
