/**
 * Pure GitLab CI file-matching logic — no `vscode` dependency, so the unit suite can exercise it without an
 * extension host. The vscode-coupled `isGitLabCIFile(document)` in `gitlabCiFileMatcher.ts` delegates here.
 */

import { minimatch } from 'minimatch';

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
 * Languages whose documents are always in-scope for the providers regardless of filename. `shellscript` covers
 * standalone shell scripts and embedded `script:` blocks; GitLab CI files themselves use the `yaml` language and
 * are matched by path against {@link DEFAULT_GITLAB_CI_FILE_GLOBS}.
 */
export const ALLOWED_LANGUAGE_IDS: ReadonlySet<string> = new Set(['shellscript']);

/**
 * Normalise a user-supplied glob so it matches the same way users intuitively expect.
 *
 * Globs anchored at the start of the absolute path (`/...`) or already at any depth (`**\/...`) are returned
 * verbatim; anything else gets a `**\/` prefix so it matches at any directory depth.
 *
 * @param pattern - Raw glob string as supplied by the user via settings.
 * @returns Glob string that matches at any directory depth.
 */
export function normaliseGlob(pattern: string): string {
  if (pattern.startsWith('**/') || pattern.startsWith('/')) return pattern;
  return `**/${pattern}`;
}

/**
 * Merge the built-in defaults with user-supplied additional globs, normalising each user entry to match at any
 * directory depth.
 *
 * @param additionalGlobs Extra user-configured globs from `gitlabComponentHelper.additionalFileGlobs`.
 * @returns Combined, normalised glob list ready to feed to {@link matchesGitLabCIFile}.
 */
export function buildFileGlobs(additionalGlobs: readonly string[] = []): string[] {
  return [...DEFAULT_GITLAB_CI_FILE_GLOBS, ...additionalGlobs.map(normaliseGlob)];
}

/**
 * Decide whether a given (path, languageId) pair represents a GitLab CI file. Pure version of `isGitLabCIFile` —
 * the production wrapper extracts `path` and `languageId` from a `vscode.TextDocument` and delegates here.
 *
 * Resolution order:
 *  1. If `languageId` is in {@link ALLOWED_LANGUAGE_IDS} (`shellscript`), match unconditionally.
 *  2. Otherwise check the path against the supplied `globs` list.
 *
 * @param filePath   Repo-relative or absolute filesystem path of the document.
 * @param languageId Document's language ID as reported by the editor.
 * @param globs      Full glob list to test against. Use {@link buildFileGlobs} to build from user config, or pass
 *                   the array directly when you already have one (e.g. cached at the call site).
 */
export function matchesGitLabCIFile(
  filePath: string,
  languageId: string,
  globs: readonly string[],
): boolean {
  if (ALLOWED_LANGUAGE_IDS.has(languageId)) return true;
  return globs.some((glob) => minimatch(filePath, glob, { dot: true }));
}
