/**
 * Deriving a component description from its README: locating and fetching the file, then extracting the
 * first prose paragraph.
 */

/** The slice of the HTTP client this module needs — the real `HttpClient` satisfies it. */
export interface ReadmeHttpClient {
  fetchText(url: string, options?: { headers?: Record<string, string> }): Promise<string>;
}

/**
 * Remove HTML comments (`<!-- … -->`) from `text`.
 *
 * Emits only the spans that sit outside a comment, so no `<!--` opener can survive into the output (which
 * feeds a component description) — an unterminated trailing `<!--` runs to end-of-string and is dropped.
 *
 * @param text The raw text to strip comments from.
 * @returns    `text` with every HTML comment removed.
 */
export function stripHtmlComments(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('<!--', i);
    if (open === -1) {
      result += text.slice(i);
      break;
    }
    result += text.slice(i, open);
    const close = text.indexOf('-->', open + 4);
    if (close === -1) {
      break; // Unterminated comment — drop the remainder.
    }
    i = close + 3;
  }
  return result;
}

/**
 * Whether a line consists only of images and links (a badge row), and so isn't prose.
 *
 * Removes image tokens (`![alt](url)`) and link tokens (`[text](url)`, whose `text` may itself be an image,
 * as in a linked badge `[![alt](img)](href)`) and reports whether only whitespace remains.
 *
 * @param line A single line of README text.
 * @returns    `true` when the line has no textual content once images/links are removed.
 */
function isBadgeOrImageOnly(line: string): boolean {
  const stripped = line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images first, so a linked image's inner ![..](..) is gone
    .replace(/\[[^\]]*\]\([^)]*\)/g, '') // then links (now with image-free text)
    .trim();
  return stripped === '';
}

/**
 * Extract the first meaningful prose paragraph from a README to use as a component description.
 *
 * Skips a leading H1 title, HTML comments, and badge/image-only lines (e.g. shields), then returns the
 * first paragraph with its Markdown heading markers stripped.
 *
 * @param readme The raw README text, or `undefined` when no README was fetched.
 * @returns      The first prose paragraph, or `undefined` when the README is empty/missing or has no usable prose.
 */
export function firstParagraph(readme: string | undefined): string | undefined {
  if (!readme) {
    return undefined;
  }
  const blocks = stripHtmlComments(readme).split(/\n\s*\n/);
  for (const block of blocks) {
    // Within a block, drop leading heading and badge/image lines so a `# Title` immediately followed by
    // prose (no blank line between) still yields the prose rather than being skipped whole.
    const prose = block
      .split('\n')
      .filter((line) => line.trim() && !/^\s*#+\s/.test(line) && !isBadgeOrImageOnly(line));
    if (prose.length > 0) {
      return prose.join('\n').trim();
    }
  }
  return undefined;
}

/**
 * The directory a component's own README would sit in, derived from its resolved template path.
 *
 * Only the directory-form layout (`templates/<name>/template.yml`) has a per-component folder, so only it
 * yields a directory (`templates/<name>`). A flat template (`templates/<name>.yml`) has no component-specific
 * folder — its `templates/README.md` sibling would be a folder index, not this component's description — so it
 * returns `''`, signalling the caller to look at the repo root instead.
 *
 * @param templatePath The resolved repo-relative template path, or `undefined` when none was found.
 * @returns            The per-component directory, or `''` for a flat template or a missing path.
 */
export function readmeDirForTemplate(templatePath: string | undefined): string {
  if (!templatePath) {
    return '';
  }
  const lastSlash = templatePath.lastIndexOf('/');
  // Flat form has a single segment after `templates/` (one slash total); directory form has ≥2.
  if (lastSlash === -1 || templatePath.indexOf('/') === lastSlash) {
    return '';
  }
  return templatePath.slice(0, lastSlash);
}

/** README filename/casing variants tried, in order, within each candidate directory. */
const README_NAMES = ['README.md', 'README.MD', 'readme.md', 'README', 'README.rst', 'README.txt'];

/**
 * Fetch a README, trying {@link README_NAMES} under each of `dirs` in order. A component's own README lives
 * next to its template (`templates/<name>/README.md`), so callers pass that directory ahead of the root.
 *
 * @param http         Structural HTTP client (the real `HttpClient` satisfies it).
 * @param apiBaseUrl   GitLab API v4 base.
 * @param projectId    Numeric or string project id for the raw-file endpoint.
 * @param version      Git ref to read each file at.
 * @param dirs         Directories to search, in priority order; `''` means the repo root.
 * @param fetchOptions Optional request headers.
 * @returns            The raw text of the first README that exists, or `null` when none are present (or the fetch fails).
 */
export async function fetchReadme(
  http: ReadmeHttpClient,
  apiBaseUrl: string,
  projectId: string | number,
  version: string,
  dirs: string[],
  fetchOptions?: { headers?: Record<string, string> }
): Promise<string | null> {
  for (const dir of dirs) {
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : '';
    for (const name of README_NAMES) {
      const path = `${prefix}${name}`;
      const url = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(path)}/raw?ref=${version}`;
      try {
        const content = await http.fetchText(url, fetchOptions);
        if (content && content.trim()) {
          return content;
        }
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}
