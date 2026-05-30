import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Component, ComponentParameter } from './componentDetector';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

export const LOCAL_COMPONENT_URL_PREFIX = 'local://';

export function extractLocalIncludePath(line: string): string | null {
  const match = line.match(/^\s*-?\s*local:\s*["']?([^"'\s]+)["']?\s*$/);
  return match ? match[1] : null;
}

export function isLocalComponentUrl(url: string | undefined): boolean {
  return !!url && url.startsWith(LOCAL_COMPONENT_URL_PREFIX);
}

export function buildLocalComponentUrl(relativePath: string): string {
  const normalised = relativePath.replace(/^\/+/, '');
  return `${LOCAL_COMPONENT_URL_PREFIX}${normalised}`;
}

function getWorkspaceRoot(document?: vscode.TextDocument): vscode.Uri | null {
  if (document) {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder) {
      return folder.uri;
    }
  }
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri : null;
}

export function resolveLocalIncludeUri(localPath: string, document?: vscode.TextDocument): vscode.Uri | null {
  const root = getWorkspaceRoot(document);
  if (!root) {
    return null;
  }
  const relative = localPath.replace(/^\/+/, '');
  return vscode.Uri.joinPath(root, ...relative.split('/'));
}

function parseInputs(specInputs: any): ComponentParameter[] {
  if (!specInputs || typeof specInputs !== 'object') {
    return [];
  }
  return Object.entries(specInputs).map(([name, raw]) => {
    const definition = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    return {
      name,
      description: typeof definition.description === 'string' ? definition.description : '',
      required: definition.default === undefined,
      type: typeof definition.type === 'string' ? definition.type : 'string',
      default: definition.default,
    };
  });
}

export async function resolveLocalComponent(
  localPath: string,
  document?: vscode.TextDocument
): Promise<Component | null> {
  const uri = resolveLocalIncludeUri(localPath, document);
  if (!uri) {
    logger.debug(`[LocalComponentResolver] No workspace root available to resolve: ${localPath}`, 'LocalComponentResolver');
    return null;
  }

  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch (err) {
    logger.debug(`[LocalComponentResolver] Could not read ${uri.fsPath}: ${err}`, 'LocalComponentResolver');
    return null;
  }

  const text = Buffer.from(bytes).toString('utf8');
  let docs: unknown[];
  try {
    docs = yaml.loadAll(text);
  } catch (err) {
    logger.debug(`[LocalComponentResolver] Failed to parse ${uri.fsPath}: ${err}`, 'LocalComponentResolver');
    return null;
  }
  const specDoc = docs.find(
    (d): d is { spec?: { inputs?: unknown } } => !!d && typeof d === 'object' && 'spec' in d
  );
  if (!specDoc) {
    logger.debug(`[LocalComponentResolver] ${uri.fsPath} has no spec document`, 'LocalComponentResolver');
    return null;
  }

  const specInputs = specDoc.spec && specDoc.spec.inputs;
  const parameters = parseInputs(specInputs);
  const displayName = path.basename(localPath);
  const url = buildLocalComponentUrl(localPath);

  return {
    name: displayName,
    description: `Local include: \`${localPath}\``,
    parameters,
    source: 'local',
    url,
    originalUrl: url,
    sourcePath: localPath,
  };
}

export async function detectLocalIncludeComponent(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<Component | null> {
  const line = document.lineAt(position.line).text;
  const localPath = extractLocalIncludePath(line);
  if (!localPath) {
    return null;
  }
  logger.debug(`[LocalComponentResolver] Detected local include: ${localPath}`, 'LocalComponentResolver');
  return resolveLocalComponent(localPath, document);
}
