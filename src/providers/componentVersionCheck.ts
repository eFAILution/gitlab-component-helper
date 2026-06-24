/**
 * Pure detection of out-of-date component version refs in a `.gitlab-ci.yml`.
 *
 * Given the document text and a resolver that yields the available versions for a component's project, this finds
 * every `component:` include pinned to a clean semver ref that has a newer stable release available, and returns the
 * ref's location (line + column span) so the provider can place a precise diagnostic squiggle and the "update" flows
 * can rewrite exactly the version ref.
 *
 * Only clean stable semver refs are considered (see {@link isCleanSemver}); floating refs and monorepo
 * tag-pattern refs (e.g. `my-comp-1.2.3`) are not clean semver and are skipped. Kept free of `vscode` imports for
 * unit-testability — the provider supplies the (async) version resolver and converts findings into vscode types.
 */

import { isCleanSemver, getLatestStableSemver, isOutdated } from '../utils/semver';

/** A component include whose pinned semver ref is behind the latest available stable release. */
export interface OutdatedComponentRef {
  /** Full component URL as written, including the `@version` suffix. */
  componentUrl: string;
  /** Project + component base URL (the `@version` stripped) — the key version lookups are cached under. */
  baseUrl: string;
  /** Short component name (last path segment of the base URL), for diagnostic messages. */
  componentName: string;
  /** 0-based document line of the `component:` entry. */
  line: number;
  /** Column (0-based) where the version ref starts — just past the `@`. */
  refStart: number;
  /** Column (0-based, exclusive) where the version ref ends. */
  refEnd: number;
  /** The pinned ref currently in the document. */
  currentVersion: string;
  /** The latest stable semver available for the component. */
  latestVersion: string;
}

/**
 * A `component:` include line: leading indent, an optional `- ` list marker, the `component:` key, and the URL value
 * (optionally quoted). Group 1 is everything up to and including the opening quote, so its length is the column the
 * URL value starts at.
 */
const COMPONENT_LINE = /^(\s*(?:-\s*)?component:\s*['"]?)(\S+?)['"]?\s*$/;

/**
 * Split a component URL into its base and `@version` ref.
 *
 * @param url The full component URL (e.g. `https://gitlab.com/g/p/c@1.2.3`).
 * @returns The base URL and the version ref, or `version: undefined` when the URL carries no `@ref`.
 */
export function splitComponentRef(url: string): { baseUrl: string; version: string | undefined } {
  const at = url.lastIndexOf('@');
  if (at === -1) return { baseUrl: url, version: undefined };
  return { baseUrl: url.slice(0, at), version: url.slice(at + 1) };
}

/**
 * Collect the base URLs of every component include pinned to a clean semver ref.
 *
 * The provider uses this to fetch each project's versions once (deduplicated) before running the synchronous
 * {@link findOutdatedComponentRefs} pass.
 *
 * @param text The full document text.
 * @returns Unique base URLs, in first-seen document order.
 */
export function collectSemverComponentBases(text: string): string[] {
  const bases = new Set<string>();
  for (const lineText of text.split('\n')) {
    const match = COMPONENT_LINE.exec(lineText);
    if (!match) continue;
    const { baseUrl, version } = splitComponentRef(match[2]);
    if (version && isCleanSemver(version)) {
      bases.add(baseUrl);
    }
  }
  return [...bases];
}

/**
 * Find every component include whose pinned semver ref is behind the latest stable release.
 *
 * @param text The full document text.
 * @param availableVersionsFor Resolver returning the known refs (tags/branches) for a component's base URL, or
 *   `undefined` when they couldn't be determined (offline, unknown project) — those components are skipped.
 * @returns One {@link OutdatedComponentRef} per outdated include, in document order.
 */
export function findOutdatedComponentRefs(
  text: string,
  availableVersionsFor: (baseUrl: string) => readonly string[] | undefined,
): OutdatedComponentRef[] {
  const findings: OutdatedComponentRef[] = [];
  const lines = text.split('\n');

  for (let line = 0; line < lines.length; line++) {
    const match = COMPONENT_LINE.exec(lines[line]);
    if (!match) continue;

    const valueStart = match[1].length; // column the URL value begins at (past any opening quote)
    const componentUrl = match[2];
    const { baseUrl, version } = splitComponentRef(componentUrl);

    // Only clean stable semver refs are eligible; everything else is left untouched.
    if (!version || !isCleanSemver(version)) continue;

    const versions = availableVersionsFor(baseUrl);
    if (!versions || versions.length === 0) continue;

    const latestVersion = getLatestStableSemver(versions);
    if (!latestVersion || !isOutdated(version, latestVersion)) continue;

    // The ref sits at the tail of the URL value: <value-start> + <base> + '@'.
    const refStart = valueStart + baseUrl.length + 1;
    findings.push({
      componentUrl,
      baseUrl,
      componentName: baseUrl.split('/').filter(Boolean).pop() ?? baseUrl,
      line,
      refStart,
      refEnd: refStart + version.length,
      currentVersion: version,
      latestVersion,
    });
  }

  return findings;
}
