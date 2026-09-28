/**
 * Per-component version preferences, stored in `gitlabComponentHelper.versionPreferences` as a map from component
 * name to either a pinned version or {@link LATEST_VERSION_PREFERENCE}.
 *
 * Kept free of `vscode` imports for unit-testability.
 */

import { getLatestStableSemver } from '../utils/semver';

/** Preference value meaning "offer the latest stable version". `~` cannot appear in a git ref, so no tag collides. */
export const LATEST_VERSION_PREFERENCE = '~latest';

/** Map from component name to a pinned version or {@link LATEST_VERSION_PREFERENCE}. */
export type VersionPreferences = Readonly<Record<string, string>>;

/**
 * Set one component's preference, replacing any earlier one.
 *
 * VS Code hands back configuration values as proxies whose mutation can throw, so the input is never modified.
 *
 * @param preferences The current preferences, as read from configuration.
 * @param componentName The component to set the preference for.
 * @param value A version to pin, or {@link LATEST_VERSION_PREFERENCE}.
 * @returns A new map with `componentName` set to `value` and every other entry kept.
 */
export function withVersionPreference(
  preferences: VersionPreferences,
  componentName: string,
  value: string,
): VersionPreferences {
  return { ...preferences, [componentName]: value };
}

/**
 * Resolve a component's preference to one of its available versions.
 *
 * @param preference The component's stored preference, or `undefined` when it has none.
 * @param availableVersions The versions the component currently offers.
 * @returns The pinned version if still available, the latest stable version for {@link LATEST_VERSION_PREFERENCE},
 *   or `undefined` when nothing matches, so the caller falls back to its own default ordering.
 */
export function resolvePreferredVersion(
  preference: string | undefined,
  availableVersions: readonly string[],
): string | undefined {
  if (preference === LATEST_VERSION_PREFERENCE) {
    return getLatestStableSemver(availableVersions) ?? undefined;
  }
  return preference !== undefined && availableVersions.includes(preference) ? preference : undefined;
}
