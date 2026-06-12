import * as vscode from 'vscode';
import {
  DEFAULT_GITLAB_CI_FILE_GLOBS,
  buildFileGlobs,
  matchesGitLabCIFile,
} from './gitlabCiFileMatcherCore';

export { DEFAULT_GITLAB_CI_FILE_GLOBS };

let cachedGlobs: string[] | undefined;

/**
 * Return the full set of globs that identify a GitLab CI file. Cached after the first call to avoid re-reading
 * config on every provider invocation.
 *
 * @returns Combined, normalised glob list ready to feed to {@link matchesGitLabCIFile}.
 */
export function getConfiguredFileGlobs(): string[] {
  if (cachedGlobs) return cachedGlobs;
  const additional = vscode.workspace
    .getConfiguration('gitlabComponentHelper')
    .get<string[]>('additionalFileGlobs', []);
  cachedGlobs = buildFileGlobs(additional);
  return cachedGlobs;
}

/**
 * Drop the cached glob list so the next call to {@link getConfiguredFileGlobs} re-reads from config. The extension
 * activation hook invokes this when the user changes `gitlabComponentHelper.additionalFileGlobs`.
 */
export function invalidateFileGlobsCache(): void {
  cachedGlobs = undefined;
}

/**
 * Decide whether the providers should treat a document as a GitLab CI file.
 *
 * Delegates the path-matching itself to {@link matchesGitLabCIFile} (pure, `minimatch`-based) so the same logic
 * runs in both the extension host and the plain-Node unit tests.
 *
 * @param document - The text document being inspected by a provider.
 * @returns `true` if the providers should activate on this document; `false` otherwise.
 */
export function isGitLabCIFile(document: vscode.TextDocument): boolean {
  return matchesGitLabCIFile(document.uri.fsPath, document.languageId, getConfiguredFileGlobs());
}
