import { isYamlNode } from './yamlParser';

/**
 * A `.gitlab-ci.yml` include entry that the validation provider validates. Either a remote `component:` URL
 * or a `local:` path; both branches carry an optional `inputs` mapping. Built by narrowing a parsed YAML node —
 * fields outside the union (anything else under the include) are intentionally not modelled.
 */
export type ComponentInclude = { component: string; local?: undefined; inputs?: Record<string, unknown> };
export type LocalInclude = { local: string; component?: undefined; inputs?: Record<string, unknown> };
export type IncludeEntry = ComponentInclude | LocalInclude;

/**
 * Narrow a parsed YAML value to an {@link IncludeEntry} (string-typed `component` or `local`).
 *
 * @param value A parsed YAML value of unknown shape — typically one element of the `include:` array.
 * @returns `true` (narrowing `value` to {@link IncludeEntry}) when `value` is a mapping with exactly one of a
 *          string `component` or a string `local`; `false` for non-mappings, entries with neither, or entries
 *          with both (e.g. `project:`/`template:`/`remote:` includes, which this provider does not validate).
 */
export function isIncludeEntry(value: unknown): value is IncludeEntry {
    if (!isYamlNode(value)) {
        return false;
    }
    let hasComponent = false;
    if (typeof value.component === 'string') {
        hasComponent = true;
    }
    let hasLocal = false;
    if (typeof value.local === 'string') {
        hasLocal = true;
    }
    if (hasComponent === hasLocal) {
        // Neither key, or both — not a component/local include this provider validates.
        return false;
    }
    return true;
}

/**
 * Narrow an {@link IncludeEntry} to the local-include shape (`local` is a string, `component` is absent).
 *
 * @param entry An include entry already validated by {@link isIncludeEntry}.
 * @returns `true` (narrowing `entry` to {@link LocalInclude}) when `entry.local` is a string; `false` for a
 *          {@link ComponentInclude}.
 */
export function isLocalInclude(entry: IncludeEntry): entry is LocalInclude {
    if (typeof entry.local === 'string') {
        return true;
    }
    return false;
}

/**
 * The YAML key and its URL/path value for an include entry — the two strings needed to locate the entry's line in
 * the document.
 *
 * @param entry An include entry already validated by {@link isIncludeEntry}.
 * @returns `{ key, url }` where `key` is the YAML key token (`'component:'` or `'local:'`) and `url` is the
 *          corresponding remote component URL or local path.
 */
export function includeKeyAndUrl(entry: IncludeEntry): { key: string; url: string } {
    if (entry.component !== undefined) {
        return { key: 'component:', url: entry.component };
    }
    return { key: 'local:', url: entry.local };
}

/**
 * Whether a document line is the one that declares an include with the given key and URL. The line must contain the
 * include key and the URL, and the URL must be terminated at a token boundary — end-of-line, whitespace, or a closing
 * quote. The boundary check is what stops a versioned URL from matching a longer sibling: e.g.
 * `…/comp@cloud-deploy-aws-ecs-1` must not match the line `…/comp@cloud-deploy-aws-ecs-10`, where it appears only as
 * a prefix. A bare substring test would, and that disagrees with the exact-equality occurrence counter the caller
 * uses to disambiguate duplicate includes — mis-anchoring the diagnostic onto the wrong include.
 *
 * @param line A single document line (no trailing newline).
 * @param key  The include key token to require on the line — `'component:'` or `'local:'`, as returned by
 *             {@link includeKeyAndUrl}.
 * @param url  The remote URL or local path that must appear on the line, terminated at a token boundary.
 * @returns `true` when `line` contains `key` and `url`, with `url` followed by end-of-line, whitespace, or a
 *          closing quote; `false` otherwise (including when `url` appears only as a prefix of a longer token).
 */
export function includeLineMatches(line: string, key: string, url: string): boolean {
    if (!line.includes(key)) {
        return false;
    }
    const at = line.indexOf(url);
    if (at === -1) {
        return false;
    }
    const after = line.charAt(at + url.length); // '' at end-of-line
    if (after === '' || /\s/.test(after) || after === '"' || after === "'") {
        return true;
    }
    return false;
}

/**
 * The document line where the include identified by `key`+`url` makes its `occurrence`-th appearance.
 *
 * Two include entries can share an identical key+URL (e.g. the same component included twice with different inputs).
 * Matching on key+URL alone returns the first occurrence for every duplicate, collapsing them onto one line. Callers
 * that hold includes in document order pass the 1-based ordinal of the entry among its identical siblings, and this
 * returns the correspondingly-numbered matching line. Matching uses {@link includeLineMatches}, so a versioned URL
 * matches only at a token boundary, not as a prefix of a longer sibling.
 *
 * @param lines      The document split into lines (no trailing newlines).
 * @param key        The include key token to require — `'component:'` or `'local:'`, as returned by
 *                   {@link includeKeyAndUrl}.
 * @param url        The remote URL or local path that must appear on the line, terminated at a token boundary.
 * @param occurrence The 1-based ordinal among identical key+URL includes — the 1st, 2nd, … such entry in document
 *                   order. Defaults to `1` (the first match) for callers with no duplicates to disambiguate.
 * @returns The 0-based line index of the `occurrence`-th match, or `-1` when fewer than `occurrence` lines match.
 */
export function findIncludeLine(lines: string[], key: string, url: string, occurrence = 1): number {
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
        if (includeLineMatches(lines[i], key, url)) {
            seen++;
            if (seen === occurrence) {
                return i;
            }
        }
    }
    return -1;
}
