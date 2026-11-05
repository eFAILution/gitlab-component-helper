/**
 * The extension's {@link WorkspacePort}: the VS Code Git extension and workspace folders pick the resolution root,
 * and reads prefer an open editor buffer over the file on disk. The extension only runs as a Node extension, so
 * workspace roots are `file` URIs and plain filesystem paths stand in for them.
 */

import * as vscode from 'vscode';
import { Logger } from '../../utils/logger';
import { MAX_LOCAL_INCLUDE_BYTES, type WorkspacePort } from '../../core/localInclude';

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
export function getResolutionRoot(document?: vscode.TextDocument): vscode.Uri | null {
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
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.File) === 0 || stat.size > MAX_LOCAL_INCLUDE_BYTES) {
      logger.debug(`[LocalComponentResolver] Not reading ${uri.fsPath}: not a file, or over ${MAX_LOCAL_INCLUDE_BYTES} bytes`, 'LocalComponentResolver');
      return null;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  } catch (err) {
    logger.debug(`[LocalComponentResolver] Could not read ${uri.fsPath}: ${err}`, 'LocalComponentResolver');
    return null;
  }
}

export function createVscodeWorkspace(): WorkspacePort<vscode.TextDocument | undefined> {
  return {
    roots: () => (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath),
    resolutionRoot: async (document) => getResolutionRoot(document)?.fsPath ?? null,
    readText: (absolutePath) => readIncludeTarget(vscode.Uri.file(absolutePath)),
  };
}
