import * as vscode from 'vscode';

/**
 * Built-in glob patterns that always identify a file as a GitLab CI file. Covers the canonical entrypoint and the
 * conventional `.gitlab/` directory used for nested/included pipeline config.
 */
export const DEFAULT_GITLAB_CI_FILE_GLOBS = [
  '**/.gitlab-ci.yml',
  '**/.gitlab-ci.yaml',
  '**/.gitlab/**/*.yml',
  '**/.gitlab/**/*.yaml',
];

/**
 * Languages whose documents are always in-scope for the providers regardless of filename.
 */
const ALLOWED_LANGUAGE_IDS = new Set(['gitlab-ci', 'shellscript']);

/**
 * Normalise a user-supplied glob so it matches the same way users intuitively expect.
 *
 * `vscode.languages.match` anchors string globs at the start of the document's absolute path, so an unanchored entry
 * never matches a real file. We prepend a globstar segment when the pattern isn't already anchored at any-depth.
 *
 * @param pattern - Raw glob string as supplied by the user via settings.
 * @returns Glob string that matches at any directory depth.
 */
function normaliseGlob(pattern: string): string {
  if (pattern.startsWith('**/') || pattern.startsWith('/')) return pattern;
  return `**/${pattern}`;
}

let cachedGlobs: string[] | undefined;

/**
 * Return the full set of globs that identify a GitLab CI file. Cached after the first call to avoid re-reading config.
 *
 * @returns Combined, normalised glob list ready to feed to `vscode.languages.match`.
 */
export function getConfiguredFileGlobs(): string[] {
  if (cachedGlobs) return cachedGlobs;
  const additional = vscode.workspace
    .getConfiguration('gitlabComponentHelper')
    .get<string[]>('additionalFileGlobs', []);
  cachedGlobs = [
    ...DEFAULT_GITLAB_CI_FILE_GLOBS,
    ...additional.map(normaliseGlob),
  ];
  return cachedGlobs;
}

/**
 * Drop the cached glob list so the next call to {@link getConfiguredFileGlobs} re-reads from config.
 */
export function invalidateFileGlobsCache(): void {
  cachedGlobs = undefined;
}

/**
 * Decide whether the providers should treat a document as a GitLab CI file.
 *
 * @param document - The text document being inspected by a provider.
 * @returns `true` if the providers should activate on this document; `false` otherwise.
 */
export function isGitLabCIFile(document: vscode.TextDocument): boolean {
  if (ALLOWED_LANGUAGE_IDS.has(document.languageId)) return true;

  for (const glob of getConfiguredFileGlobs()) {
    if (vscode.languages.match({ pattern: glob }, document) > 0) return true;
  }
  return false;
}
