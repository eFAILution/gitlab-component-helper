/**
 * Per-component version preferences, stored in `gitlabComponentHelper.versionPreferences` as a map from
 * {@link versionPreferenceKey} to either a pinned version or {@link LATEST_VERSION_PREFERENCE}.
 *
 * Kept free of `vscode` imports for unit-testability.
 */

import { compileTagTemplate } from '../services/component/tagScoping';
import { compareSemver, isCleanSemver } from '../utils/semver';

/** Preference value meaning "offer the latest stable version". `~` cannot appear in a git ref, so no tag collides. */
export const LATEST_VERSION_PREFERENCE = '~latest';

/** Map from {@link versionPreferenceKey} to a pinned version or {@link LATEST_VERSION_PREFERENCE}. */
export type VersionPreferences = Readonly<Record<string, string>>;

/** A component as far as its version preference is concerned. */
export interface PreferenceComponent {
  name: string;
  sourcePath: string;
  gitlabInstance: string;
  tagPattern?: string;
}

/**
 * Is `value` a well-formed preferences map?
 *
 * @param value A value read from configuration, which the user can edit by hand.
 * @returns `true` when `value` is a plain object whose every value is a string.
 */
export function isVersionPreferences(value: unknown): value is VersionPreferences {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

/**
 * The key a component's preference is stored under. Includes the instance and project so that two projects with a
 * component of the same name keep separate preferences.
 *
 * @param component The component to key.
 * @returns `<instance>/<project path>/<name>`, matching the component URL without its scheme and version.
 */
export function versionPreferenceKey(component: Pick<PreferenceComponent, 'name' | 'sourcePath' | 'gitlabInstance'>): string {
  return `${component.gitlabInstance}/${component.sourcePath}/${component.name}`;
}

/**
 * Look up a component's preference.
 *
 * @param preferences The preferences to search.
 * @param component The component to look up.
 * @returns The stored preference, or `undefined` when there is none. Inherited keys such as `constructor` never match.
 */
export function preferenceFor(preferences: VersionPreferences, component: PreferenceComponent): string | undefined {
  const key = versionPreferenceKey(component);
  return Object.prototype.hasOwnProperty.call(preferences, key) ? preferences[key] : undefined;
}

/**
 * Set one component's preference, replacing any earlier one.
 *
 * VS Code hands back configuration values as proxies whose mutation can throw, so the input is never modified.
 *
 * @param preferences The current preferences, as read from configuration.
 * @param key The component's {@link versionPreferenceKey}.
 * @param value A version to pin, or {@link LATEST_VERSION_PREFERENCE}.
 * @returns A new map with `key` set to `value` and every other entry kept.
 */
export function withVersionPreference(preferences: VersionPreferences, key: string, value: string): VersionPreferences {
  return { ...preferences, [key]: value };
}

/**
 * The highest stable semantic version among `availableVersions`. For a tag-pattern source each tag is compared by
 * its `{version}` capture, so `deploy-1.10.0` beats `deploy-1.9.0`.
 *
 * @param availableVersions The versions to choose from. For a tag-pattern source these are full tags.
 * @param component The component, whose `tagPattern` (if any) says how tags embed the version.
 * @returns The winning version as it appears in `availableVersions`, or `undefined` when none is stable semver.
 */
export function latestStableVersion(
  availableVersions: readonly string[],
  component: Pick<PreferenceComponent, 'name' | 'tagPattern'>,
): string | undefined {
  const matcher = component.tagPattern ? compileTagTemplate(component.tagPattern, component.name) : null;
  const versionOf = (tag: string): string => matcher?.extractVersion(tag) ?? tag;

  return availableVersions
    .filter((tag) => isCleanSemver(versionOf(tag)))
    .reduce<string | undefined>(
      (best, tag) => (best === undefined || (compareSemver(versionOf(tag), versionOf(best)) ?? 0) > 0 ? tag : best),
      undefined,
    );
}

/**
 * Resolve a component's preference to one of its available versions.
 *
 * @param preference The component's stored preference, or `undefined` when it has none.
 * @param availableVersions The versions the component currently offers.
 * @param component The component, whose `tagPattern` (if any) is needed to find the latest version.
 * @returns The pinned version if still available, the latest stable version for {@link LATEST_VERSION_PREFERENCE},
 *   or `undefined` when nothing matches, so the caller falls back to its own default ordering.
 */
export function resolvePreferredVersion(
  preference: string | undefined,
  availableVersions: readonly string[],
  component: Pick<PreferenceComponent, 'name' | 'tagPattern'>,
): string | undefined {
  if (preference === LATEST_VERSION_PREFERENCE) {
    return latestStableVersion(availableVersions, component);
  }
  return preference !== undefined && availableVersions.includes(preference) ? preference : undefined;
}
