import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Component, ComponentParameter } from './componentDetector';
import { Logger } from '../utils/logger';

// Pure parser helpers live in their own module so the unit suite can exercise them under plain Node. Re-exported
// here so existing callers (e.g. validationProvider) keep their import path.
import {
  LOCAL_COMPONENT_URL_PREFIX,
  extractLocalIncludePath,
  isLocalComponentUrl,
  buildLocalComponentUrl,
  isUnsupportedLocalPath,
} from './localIncludeParser';
export {
  LOCAL_COMPONENT_URL_PREFIX,
  extractLocalIncludePath,
  isLocalComponentUrl,
  buildLocalComponentUrl,
  isUnsupportedLocalPath,
};

const logger = Logger.getInstance();

/**
 * Look up the git repository root that contains the given document via VS Code's built-in Git extension.
 *
 * Returns `null` if there's no document, no Git extension, or the document doesn't live inside a known repo. Errors
 * thrown by the Git extension API are caught and logged at debug level.
 *
 * @param document  The active document. Resolution is anchored on its URI so multi-repo workspaces map correctly.
 * @returns         The repo's `rootUri`, or `null` if it can't be determined.
 */
function getRepositoryRoot(document?: vscode.TextDocument): vscode.Uri | null {
  if (!document) {
    return null;
  }
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
      const git = gitExtension.exports.getAPI(1);
      const repo = git?.getRepository?.(document.uri);
      if (repo?.rootUri) {
        return repo.rootUri as vscode.Uri;
      }
    }
  } catch (err) {
    logger.debug(`[LocalComponentResolver] Git extension lookup failed: ${err}`, 'LocalComponentResolver');
  }
  return null;
}

/**
 * Pick the URI that `local:` paths resolve against. Prefers the git repo root (matching GitLab's own semantics);
 * falls back to the document's workspace folder, then to the first workspace folder, then `null`.
 *
 * The fallback chain matters for unsaved buffers, no-Git workspaces, and tests — none of these have a real repo root
 * but most can still resolve a sensible workspace-relative path.
 *
 * @param document  The active document being processed. Used for both the repo lookup and the workspace-folder fallback.
 * @returns         The root URI to join `local:` paths against, or `null` if no usable root exists.
 */
function getResolutionRoot(document?: vscode.TextDocument): vscode.Uri | null {
  const repoRoot = getRepositoryRoot(document);
  if (repoRoot) {
    return repoRoot;
  }
  if (document) {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder) {
      return folder.uri;
    }
  }
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri : null;
}

/**
 * Resolve a `local:` path string to an absolute URI against the chosen resolution root.
 *
 * Leading slashes are tolerated (GitLab itself accepts both `/templates/x.yml` and `templates/x.yml`) and stripped
 * before joining, so the result never contains a doubled separator.
 *
 * @param localPath  The raw path string from a parsed `include: - local:` entry.
 * @param document   The active document, used to determine the resolution root.
 * @returns          The resolved absolute URI, or `null` if no resolution root is available.
 */
export function resolveLocalIncludeUri(localPath: string, document?: vscode.TextDocument): vscode.Uri | null {
  const root = getResolutionRoot(document);
  if (!root) {
    return null;
  }
  const relative = localPath.replace(/^\/+/, '');
  return vscode.Uri.joinPath(root, ...relative.split('/'));
}

/**
 * Convert a parsed `spec.inputs` block into the `ComponentParameter[]` shape the rest of the providers consume.
 *
 * Mirrors GitLab's own input contract: a parameter is treated as required when no `default` is supplied. Missing or
 * non-string `description` / `type` fields collapse to safe defaults rather than throwing — the resolver never wants
 * to fail on a malformed-but-readable template since that just produces user-visible spurious diagnostics.
 *
 * @param specInputs  The raw `spec.inputs` object from a parsed YAML document; may be `undefined`, `null`, or any value.
 * @returns           A normalised array of input definitions, or `[]` when `specInputs` isn't an object.
 */
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

/**
 * Read the text content of a local include target, preferring the open editor buffer over the on-disk file.
 *
 * Reading from the open buffer surfaces unsaved edits immediately — without this, hovering an input on the consumer
 * file would show stale parameters whenever the template was edited but not yet saved. Falls back to
 * `vscode.workspace.fs.readFile` when the target isn't open in any editor. Read failures are logged at debug level
 * and surface to the caller as `null` so they can be converted into the right user-facing signal (e.g. a not-found
 * diagnostic from the validation provider, or a silent skip from the hover/completion providers).
 *
 * @param uri  The resolved absolute URI of the include target.
 * @returns    The file's text, or `null` if the file can't be read.
 */
async function readIncludeTarget(uri: vscode.Uri): Promise<string | null> {
  const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (openDoc) {
    return openDoc.getText();
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  } catch (err) {
    logger.debug(`[LocalComponentResolver] Could not read ${uri.fsPath}: ${err}`, 'LocalComponentResolver');
    return null;
  }
}

/**
 * Resolve a local include path into a synthetic `Component` so the rest of the providers can treat it identically to
 * a catalog component. Reads the target file (preferring an open editor buffer), parses every YAML document in it,
 * picks the first one declaring `spec`, and maps `spec.inputs` onto `ComponentParameter[]`.
 *
 * Returns `null` for several distinct reasons, all of which the caller treats the same way (no spurious diagnostics):
 *   - the path is a glob or contains `..` (see `isUnsupportedLocalPath`)
 *   - no resolution root is available (no document, no Git repo, no workspace folder)
 *   - the file doesn't exist or can't be read
 *   - the file parses but has no `spec` block (a legitimate plain include, not a parameterised template)
 *
 * @param localPath  The raw path string from a parsed `include: - local:` entry.
 * @param document   The document making the include. Used to determine the resolution root and the open-buffer fast path.
 * @returns          A `Component` describing the local template, or `null` if no usable component can be produced.
 */
export async function resolveLocalComponent(
  localPath: string,
  document?: vscode.TextDocument
): Promise<Component | null> {
  if (isUnsupportedLocalPath(localPath)) {
    return null;
  }

  const uri = resolveLocalIncludeUri(localPath, document);
  if (!uri) {
    logger.debug(`[LocalComponentResolver] No resolution root available for: ${localPath}`, 'LocalComponentResolver');
    return null;
  }

  const text = await readIncludeTarget(uri);
  if (text === null) {
    return null;
  }
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

/**
 * Position-driven entry point for detecting a local include component at a cursor position. Used by
 * `componentDetector.detectIncludeComponent` to short-circuit catalog lookups when the line is a `- local:` entry.
 *
 * Only looks at the single line under the cursor — if the cursor isn't on a `local:` line, returns `null` immediately
 * without any file I/O. When it is, delegates to `resolveLocalComponent` which handles every downstream concern
 * (unsupported paths, file reading, YAML parsing, the "no spec block" case).
 *
 * @param document  The active document.
 * @param position  The cursor position; only `position.line` is consulted.
 * @returns         The resolved local `Component`, or `null` if the line isn't a local include or can't be resolved.
 */
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
