/**
 * Register the bundled MCP server with VS Code, so Copilot Chat (agent mode) and other in-editor MCP clients can
 * start it without any setup. Tokens are only added when VS Code starts the server, and never logged.
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
  effectiveSettings,
  tokenCandidateHosts,
  userSourceHosts,
} from '../../mcp/launchConfig';

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

/**
 * @returns The registration, or `undefined` when this VS Code has no MCP provider API.
 */
export function registerMcpServerProvider(context: vscode.ExtensionContext, tokens: TokenSource): vscode.Disposable | undefined {
  const logger = Logger.getInstance();
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function' || typeof vscode.McpStdioServerDefinition !== 'function') {
    logger.info('[MCP] This VS Code has no MCP server provider API; not registering the MCP server', 'MCP');
    return undefined;
  }

  const changed = new vscode.EventEmitter<void>();
  const fire = () => changed.fire();
  const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: () => {
      const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file');
      const { config } = getRuntime();
      const settings = effectiveSettings((key) => config.get(key, CONFIG_DEFAULTS[key]));
      const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, CACHE_DIR_NAME).fsPath;
      const version = String(context.extension.packageJSON.version ?? '');
      return [
        new vscode.McpStdioServerDefinition(
          SERVER_LABEL,
          process.execPath,
          buildServerArgs(context.asAbsolutePath(SERVER_SCRIPT), folders.map((folder) => folder.uri.fsPath)),
          buildServerEnv(settings, cacheDir, userSourceHosts(userComponentSources())),
          version
        ),
      ];
    },
    resolveMcpServerDefinition: async (server) => {
      const found = await collectTokens(tokens);
      logger.debug(`[MCP] Starting the MCP server with tokens for ${found.size} instance(s)`, 'MCP');
      server.env = { ...server.env, ...buildTokenEnv(found) };
      return server;
    },
  };

  return vscode.Disposable.from(
    changed,
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider),
    tokens.onDidChangeToken(fire),
    vscode.workspace.onDidChangeWorkspaceFolders(fire),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) fire();
    })
  );
}
