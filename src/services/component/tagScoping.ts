/**
 * Pure helpers for monorepo tag scoping.
 *
 * In a tag-per-component monorepo, every component lives in `templates/<name>/` of a single GitLab project and its
 * releases are git tags that embed the component name, e.g. `cloud-deploy-aws-ecs-1.1.0` or `apps/web/v2.0.0`. A
 * single project therefore carries the tags of *all* its components mixed together, and the viewer needs to pick out
 * the tags belonging to one component.
 *
 * The convention varies between teams, so the shape is described per-source by a **tag-version template** — a string
 * with two tokens:
 *  - `{name}`    — the component (== `templates/` directory) name.
 *  - `{version}` — the version portion to surface; captured for display.
 *
 * Examples: `{name}-{version}` (our house style), `apps/{name}/v{version}`, `{name}_{version}`.
 *
 * A template compiles to a regex anchored at both ends: literal text is escaped, `{name}` becomes the (escaped)
 * component name, and `{version}` becomes a capture group that must start with a digit (`\d.*`). The digit anchor
 * stops a component whose name is a prefix of another's (`docker-publish` vs `docker-publish-extra`) from capturing
 * the sibling's tags.
 *
 * The **full tag** is always retained as the canonical ref — it is what GitLab resolves an include against; the
 * `{version}` capture is presentation only.
 *
 * Kept free of `vscode`/`HttpClient` imports so the unit suite can exercise them directly.
 */

/** The default template — used as the fallback when a source's `tagPattern` is set but empty. */
export const DEFAULT_TAG_PATTERN = '{name}-{version}';

/** A template compiled against a specific component name, ready to test/strip that component's tags. */
export interface TagMatcher {
  /** Returns true if `tag` belongs to this component under the template. */
  matches(tag: string): boolean;
  /** Returns the `{version}` capture for `tag`, or `null` if it doesn't match. */
  extractVersion(tag: string): string | null;
}

const NAME_TOKEN = '{name}';
const VERSION_TOKEN = '{version}';

/**
 * Escape a string for safe literal use inside a `RegExp`.
 *
 * @param value The raw string (e.g. a component name or a template literal slice).
 * @returns The string with all regex metacharacters backslash-escaped, so it matches itself literally.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a tag-version template into a {@link TagMatcher} bound to one component name.
 *
 * The template must contain `{version}`; `{name}` is optional but normally present. Everything else is treated as
 * literal text (regex-escaped). `{version}` compiles to `(\d.*)` so a matched version always begins with a digit.
 *
 * @param template      The per-source template, e.g. `{name}-{version}`. Falls back to {@link DEFAULT_TAG_PATTERN}.
 * @param componentName The component name substituted for `{name}`.
 * @returns A matcher, or `null` if the template is malformed (missing `{version}`) — callers should treat `null` as
 *          "not a monorepo source" and fall back to using the full tag list.
 */
export function compileTagTemplate(
  template: string | undefined,
  componentName: string,
): TagMatcher | null {
  const tmpl = template && template.length > 0 ? template : DEFAULT_TAG_PATTERN;
  if (!tmpl.includes(VERSION_TOKEN)) return null;

  // Build the regex by escaping the literal slices around the tokens, substituting the (escaped) name and a version
  // capture group. Splitting on the tokens keeps surrounding literals (separators, `apps/`, `v`, …) intact.
  let pattern = '^';
  let rest = tmpl;
  while (rest.length > 0) {
    const nameAt = rest.indexOf(NAME_TOKEN);
    const versionAt = rest.indexOf(VERSION_TOKEN);

    // No more tokens — append the trailing literal and stop.
    if (nameAt === -1 && versionAt === -1) {
      pattern += escapeRegExp(rest);
      break;
    }

    // Whichever token comes first.
    const useName = nameAt !== -1 && (versionAt === -1 || nameAt < versionAt);
    const at = useName ? nameAt : versionAt;
    const token = useName ? NAME_TOKEN : VERSION_TOKEN;

    pattern += escapeRegExp(rest.slice(0, at));
    pattern += useName ? escapeRegExp(componentName) : '(\\d.*)';
    rest = rest.slice(at + token.length);
  }
  pattern += '$';

  const regex = new RegExp(pattern);

  return {
    matches: (tag: string): boolean => regex.test(tag),
    extractVersion: (tag: string): string | null => {
      const m = regex.exec(tag);
      return m ? m[1] ?? null : null;
    },
  };
}

/**
 * Filter a project's full tag list down to the tags belonging to a single component, under the given template.
 *
 * @param allTagNames  Every tag name in the project.
 * @param componentName The component name to scope to.
 * @param template     The per-source tag-version template. Defaults to {@link DEFAULT_TAG_PATTERN}.
 * @returns The subset of tag names belonging to this component, order preserved. Empty if the template is malformed.
 */
export function scopeTagsToComponent(
  allTagNames: readonly string[],
  componentName: string,
  template?: string,
): string[] {
  const matcher = compileTagTemplate(template, componentName);
  if (!matcher) return [];
  return allTagNames.filter((tag) => matcher.matches(tag));
}

/**
 * Strip a tag down to its `{version}` portion for display. Tags that don't match the template (e.g. branch names
 * like `main`) are returned verbatim.
 *
 * @param tag           The full tag.
 * @param componentName The component name substituted for `{name}`.
 * @param template      The per-source tag-version template. Defaults to {@link DEFAULT_TAG_PATTERN}.
 */
export function stripTagPrefix(tag: string, componentName: string, template?: string): string {
  const matcher = compileTagTemplate(template, componentName);
  return matcher?.extractVersion(tag) ?? tag;
}
