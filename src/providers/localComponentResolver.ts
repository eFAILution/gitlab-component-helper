import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Component, ComponentParameter } from './componentDetector';
import { Logger } from '../utils/logger';
import { isYamlNode } from '../utils/yamlParser';
import type { ParameterDefault } from '../types/git-component';

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
function parseInputs(specInputs: unknown): ComponentParameter[] {
  if (!isYamlNode(specInputs)) {
    return [];
  }
  return Object.entries(specInputs).map(([name, raw]) => {
    const definition: Record<string, unknown> = isYamlNode(raw) ? raw : {};
    const rawDefault = definition.default;
    const rawOptions = definition.options;
    return {
      name,
      description: typeof definition.description === 'string' ? definition.description : '',
      required: rawDefault === undefined,
      type: typeof definition.type === 'string' ? definition.type : 'string',
      default: isParameterDefault(rawDefault) ? rawDefault : undefined,
      options: isOptionsList(rawOptions) ? rawOptions : undefined,
    };
  });
}

/**
 * Narrow an unknown value to the primitive array accepted by `inputs.*.options`.
 *
 * @param value - The raw `options` value from a parsed input definition; may be any value.
 * @returns `true` when `value` is an array of only string/number/boolean entries, narrowing it for the caller.
 */
function isOptionsList(value: unknown): value is Array<string | number | boolean> {
  return (
    Array.isArray(value) &&
    value.every(v => {
      const t = typeof v;
      return t === 'string' || t === 'number' || t === 'boolean';
    })
  );
}

/** Narrow an unknown value to {@link ParameterDefault} (the union accepted by `inputs.*.default`). */
function isParameterDefault(value: unknown): value is ParameterDefault {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(value)) {
    return value.every(v => {
      const vt = typeof v;
      return vt === 'string' || vt === 'number' || vt === 'boolean';
    });
  }
  return false;
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
 * The outcome of resolving a `local:` include, discriminating the reasons resolution can fail to yield a component.
 *
 * `unreadable` and `no-spec` look identical to callers that only want the component, but they are opposites to the
 * validator: `unreadable` is a real problem (the included file is missing or can't be read) worth a diagnostic,
 * whereas `no-spec` is a legitimate plain include (hidden jobs, `.pre`/`.post`, cache config) with nothing to
 * validate and must stay silent. Collapsing both to `null` is what made valid non-parameterised includes report a
 * spurious "file not found" warning.
 */
export type LocalIncludeOutcome =
  | { kind: 'component'; component: Component }
  /** Path is a glob/`..`, or no resolution root is available — not something to diagnose. */
  | { kind: 'skipped' }
  /** The include target is missing or unreadable — the validator surfaces this as a diagnostic. */
  | { kind: 'unreadable' }
  /** The target was read and parsed but declares no `spec:` document — a valid plain include, nothing to validate. */
  | { kind: 'no-spec' };

/**
 * Resolve a local include path into a {@link LocalIncludeOutcome}. Reads the target file (preferring an open editor
 * buffer), parses every YAML document in it, picks the first one declaring `spec`, and maps `spec.inputs` onto
 * `ComponentParameter[]`.
 *
 * @param localPath  The raw path string from a parsed `include: - local:` entry.
 * @param document   The document making the include. Used to determine the resolution root and the open-buffer fast path.
 * @returns          The resolution outcome — a `component` on success, or one of `skipped`/`unreadable`/`no-spec`.
 */
export async function resolveLocalIncludeOutcome(
  localPath: string,
  document?: vscode.TextDocument
): Promise<LocalIncludeOutcome> {
  if (isUnsupportedLocalPath(localPath)) {
    return { kind: 'skipped' };
  }

  const uri = resolveLocalIncludeUri(localPath, document);
  if (!uri) {
    logger.debug(`[LocalComponentResolver] No resolution root available for: ${localPath}`, 'LocalComponentResolver');
    return { kind: 'skipped' };
  }

  const text = await readIncludeTarget(uri);
  if (text === null) {
    return { kind: 'unreadable' };
  }
  let docs: unknown[];
  try {
    docs = yaml.loadAll(text);
  } catch (err) {
    logger.debug(`[LocalComponentResolver] Failed to parse ${uri.fsPath}: ${err}`, 'LocalComponentResolver');
    // The file exists and was read; it just isn't valid YAML. That's a plain include we can't extract inputs from,
    // not a missing file — treat it like a no-spec include rather than a false "not found".
    return { kind: 'no-spec' };
  }
  const specDoc = docs.find(
    (d): d is { spec?: { inputs?: unknown } } => !!d && typeof d === 'object' && 'spec' in d
  );
  if (!specDoc) {
    logger.debug(`[LocalComponentResolver] ${uri.fsPath} has no spec document`, 'LocalComponentResolver');
    return { kind: 'no-spec' };
  }

  const specInputs = specDoc.spec && specDoc.spec.inputs;
  const parameters = parseInputs(specInputs);
  const displayName = path.basename(localPath);
  const url = buildLocalComponentUrl(localPath);

  return {
    kind: 'component',
    component: {
      name: displayName,
      description: `Local include: \`${localPath}\``,
      parameters,
      source: 'local',
      url,
      originalUrl: url,
      sourcePath: localPath,
    },
  };
}

/**
 * Resolve a local include path into a synthetic `Component`, or `null` when no component can be produced (unsupported
 * path, no resolution root, unreadable file, or no `spec` block). A thin wrapper over
 * {@link resolveLocalIncludeOutcome} for callers (completion, include detection) that only need the component and
 * treat every failure the same way.
 *
 * @param localPath  The raw path string from a parsed `include: - local:` entry.
 * @param document   The document making the include. Used to determine the resolution root and the open-buffer fast path.
 * @returns          A `Component` describing the local template, or `null` if no usable component can be produced.
 */
export async function resolveLocalComponent(
  localPath: string,
  document?: vscode.TextDocument
): Promise<Component | null> {
  const outcome = await resolveLocalIncludeOutcome(localPath, document);
  return outcome.kind === 'component' ? outcome.component : null;
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
