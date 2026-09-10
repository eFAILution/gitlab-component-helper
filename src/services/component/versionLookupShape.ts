/**
 * Shared type-guard for "can this component be used to look up versions?".
 *
 * `vscode`-free and pure so the unit suite can drive it directly. Both details-panel entry points check the same
 * thing, so they share one definition rather than a copy each.
 */

import type { Component } from '../../providers/componentDetector';
import type { VersionLookupComponent } from '../../types/cache';

/**
 * Narrow a `Component` to the fields a version lookup needs: the project coordinates to query and the ref to fall
 * back on. `Component` carries all three as optional, so they are checked before calling the cache.
 *
 * Deliberately does **not** require `url` or `source`. The details panel's component is rebuilt in the webview from
 * a `ComponentVersion`, which has no `url`, and nothing in the lookup path reads one — `fetchComponentVersions`
 * queries by `gitlabInstance` + `sourcePath` and scopes by `tagPattern`. Demanding `url` here only rejects
 * components the cache could have served.
 *
 * @param component The component to check.
 * @returns         `true` when `sourcePath`, `gitlabInstance` and `version` are all present and string-typed.
 */
export function isVersionLookupShape(
  component: Component
): component is Component & VersionLookupComponent {
  return typeof component.sourcePath === 'string'
    && typeof component.gitlabInstance === 'string'
    && typeof component.version === 'string';
}
