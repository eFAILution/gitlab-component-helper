/**
 * Functions for deriving a component description from its README — operating on already-fetched text and
 * resolved paths.
 */

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
    const text = block.trim();
    if (!text) {
      continue;
    }
    // Skip a top-level title and badge/image-only blocks (every line is a link or image).
    if (/^#\s/.test(text)) {
      continue;
    }
    const lines = text.split('\n');
    if (lines.every(isBadgeOrImageOnly)) {
      continue;
    }
    return text.replace(/^#+\s*/, '').trim();
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
