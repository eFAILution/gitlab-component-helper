/**
 * Pure helpers for recognising and normalising `include: - local:` entries in a `.gitlab-ci.yml`. No `vscode` or
 * `Logger` dependency — safe to load from plain Node (unit tests).
 *
 * The richer `localComponentResolver` builds on these to resolve a local include into a synthetic `Component`,
 * which requires `vscode.workspace.fs` and the workspace-root lookup.
 */

export const LOCAL_COMPONENT_URL_PREFIX = 'local://';

const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Extract the path string from a single line that looks like an `include: - local:` entry.
 *
 * Accepts quoted, single-quoted, and unquoted forms, with or without the leading list dash. The regex is deliberately
 * line-anchored (`^...$`) so a stray `local:` token inside a value or comment elsewhere on the line won't match.
 *
 * @param line  A raw document line, exactly as returned by `vscode.TextDocument.lineAt(...).text`.
 * @returns     The path string with surrounding quotes stripped, or `null` if the line isn't a `local:` include.
 */
export function extractLocalIncludePath(line: string): string | null {
  const match = line.match(/^\s*-?\s*local:\s*["']?([^"'\s]+)["']?\s*$/);
  return match ? match[1] : null;
}

/**
 * Test whether a URL string identifies a synthetic local-include "component" produced by the resolver.
 *
 * The resolver tags every local-source `Component` with a `local://<path>` URL so the rest of the providers can
 * distinguish them from real catalog component URLs without inspecting the `source` field.
 *
 * @param url  Candidate URL — usually `Component.url`. `undefined` is treated as not-local for caller convenience.
 * @returns    `true` if the URL begins with the local-component prefix; `false` otherwise.
 */
export function isLocalComponentUrl(url: string | undefined): boolean {
  return !!url && url.startsWith(LOCAL_COMPONENT_URL_PREFIX);
}

/**
 * Build the synthetic `local://<path>` URL used to tag local-source components.
 *
 * Leading slashes on the relative path are stripped first so `local:///x` and `local:/x` never appear in cached
 * URLs — only the canonical `local://x` form.
 *
 * @param relativePath  Repository-relative path to the local component template.
 * @returns             A `local://`-prefixed URL suitable for `Component.url` / `Component.originalUrl`.
 */
export function buildLocalComponentUrl(relativePath: string): string {
  const normalised = relativePath.replace(/^\/+/, '');
  return `${LOCAL_COMPONENT_URL_PREFIX}${normalised}`;
}

/**
 * Detect `local:` paths the resolver refuses to handle: glob patterns (`*`, `?`, `[`, `]`, `{`, `}`) and traversal
 * segments (`..`).
 *
 * @param localPath  The raw path string from a parsed `include: - local:` entry.
 * @returns          `true` if the path contains glob metacharacters or a `..` segment; `false` otherwise.
 */
export function isUnsupportedLocalPath(localPath: string): boolean {
  if (GLOB_CHARS.test(localPath)) {
    return true;
  }
  if (localPath.split('/').some((segment) => segment === '..')) {
    return true;
  }
  return false;
}
