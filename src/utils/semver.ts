/**
 * Minimal semantic-version helpers for the component version-check feature.
 *
 * Scope is deliberately narrow: only clean, stable `MAJOR.MINOR.PATCH` refs are recognised, with an optional
 * leading `v` tolerated. Everything else is intentionally *not* clean semver here, so the version check leaves it
 * untouched rather than guessing at an upgrade:
 *  - floating refs (`main`, `latest`, `~latest`),
 *  - partial refs (`1`, `1.2`),
 *  - pre-release / build-metadata versions (`1.2.3-rc.1`, `1.2.3+build`),
 *  - commit SHAs.
 *
 * Kept free of `vscode` imports so the unit suite can exercise it directly.
 */

/** A parsed clean semantic version. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** A clean, stable `X.Y.Z` ref with an optional `v` prefix and nothing else. */
const CLEAN_SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parse a ref into its major/minor/patch parts.
 *
 * @param ref The ref string (surrounding whitespace is tolerated).
 * @returns The parsed version, or `null` when `ref` isn't a clean stable semver.
 */
export function parseSemver(ref: string): SemVer | null {
  const match = CLEAN_SEMVER.exec(ref.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Is `ref` a clean, stable semver (`X.Y.Z`, optional `v` prefix)?
 *
 * @param ref The ref to test.
 */
export function isCleanSemver(ref: string): boolean {
  return parseSemver(ref) !== null;
}

/**
 * Compare two clean semver refs numerically.
 *
 * @param a First ref.
 * @param b Second ref.
 * @returns A positive number when `a` > `b`, negative when `a` < `b`, `0` when equal, or `null` when either ref
 *   isn't clean semver (so callers never treat an unknown comparison as ordered).
 */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/**
 * Pick the highest clean stable semver from a list of refs (e.g. a project's tags + branches), ignoring every entry
 * that isn't clean semver.
 *
 * @param refs Candidate refs.
 * @returns The winning ref string verbatim (preserving any `v` prefix as it appeared), or `null` when none of the
 *   refs are clean semver.
 */
export function getLatestStableSemver(refs: readonly string[]): string | null {
  let best: string | null = null;
  for (const ref of refs) {
    if (!isCleanSemver(ref)) continue;
    if (best === null || (compareSemver(ref, best) ?? 0) > 0) {
      best = ref;
    }
  }
  return best;
}

/**
 * Is `latest` strictly newer than the pinned `current` ref?
 *
 * @param current The currently pinned ref.
 * @param latest The candidate latest ref.
 * @returns `true` only when both are clean semver and `current` < `latest`; `false` otherwise (non-semver or
 *   equal refs never report as outdated).
 */
export function isOutdated(current: string, latest: string): boolean {
  const comparison = compareSemver(current, latest);
  return comparison !== null && comparison < 0;
}
