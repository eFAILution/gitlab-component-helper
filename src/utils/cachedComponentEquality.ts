import { CachedComponent } from '../types/cache';

/**
 * Whether two cache entries are equivalent for the purposes of the cache's change notification. Callers pass entries
 * already matched on identity (name/sourcePath/gitlabInstance/version), so this compares the remaining fields that
 * consumers render from — chiefly `templatePath`, which the document link provider gates on. Used to suppress the
 * no-op re-adds that validation performs on every open/change/save, which would otherwise thrash the link provider.
 *
 * @param a One cache entry.
 * @param b The other cache entry, already identity-matched against `a`.
 * @returns `true` when the render-relevant fields match (so the re-add is a no-op), `false` when any differ.
 */
export function sameCachedComponent(a: CachedComponent, b: CachedComponent): boolean {
  return (
    a.templatePath === b.templatePath &&
    a.url === b.url &&
    a.source === b.source &&
    a.tagPattern === b.tagPattern &&
    a.resolvedSha === b.resolvedSha &&
    JSON.stringify(a.availableVersions) === JSON.stringify(b.availableVersions)
  );
}
