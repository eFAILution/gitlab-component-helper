import * as vscode from 'vscode';
import { Component } from './componentDetector';
import { Logger } from '../utils/logger';
import {
  resolveLocalIncludeOutcome as resolveCoreLocalIncludeOutcome,
  type LocalIncludeOutcome as CoreLocalIncludeOutcome,
} from '../core/localInclude';
import { createVscodeWorkspace, getResolutionRoot } from '../adapters/vscode/workspace';

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
const vscodeWorkspace = createVscodeWorkspace();

/**
 * Resolve a `local:` path string to an absolute URI against the chosen resolution root.
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

/** See {@link CoreLocalIncludeOutcome}; the extension's components carry the wider provider `Component` shape. */
export type LocalIncludeOutcome = CoreLocalIncludeOutcome<Component>;

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
  return resolveCoreLocalIncludeOutcome(localPath, document, vscodeWorkspace);
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
