import { CachedComponent } from '../types/cache';

/**
 * What a component reference identifies in the cache: the instance, project and component name, plus the ref it pins.
 * `version` is absent when the reference has no `@ref`.
 */
export interface ComponentIdentity {
  gitlabInstance: string;
  sourcePath: string;
  name: string;
  version?: string;
}

type CacheKeyFields = Pick<CachedComponent, 'gitlabInstance' | 'sourcePath' | 'name' | 'version'>;

/**
 * Parses an expanded component URL (`https://host/group/project/name@ref`) into its cache identity. The instance is
 * the URL's `hostname`, matching how fetched components are stored. Everything after the first `@` is the ref, so refs
 * containing `/` survive intact.
 *
 * @param componentUrl A component URL with any CI variables already expanded.
 * @returns The identity, or `null` when the URL doesn't parse or has no project segment before the component name.
 */
export function parseComponentIdentity(componentUrl: string): ComponentIdentity | null {
  const at = componentUrl.indexOf('@');
  const base = at === -1 ? componentUrl : componentUrl.slice(0, at);
  const version = at === -1 ? undefined : componentUrl.slice(at + 1) || undefined;

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  return {
    gitlabInstance: url.hostname,
    sourcePath: segments.slice(0, -1).join('/'),
    name: segments[segments.length - 1],
    version,
  };
}

const sameComponent = (comp: CacheKeyFields, identity: ComponentIdentity): boolean =>
  comp.gitlabInstance === identity.gitlabInstance &&
  comp.sourcePath === identity.sourcePath &&
  comp.name === identity.name;

/**
 * The cache entry for exactly the referenced version. Never substitutes another version of the same component — a
 * component's inputs can change between versions, so a different version's spec would offer or accept the wrong ones.
 *
 * @param components The cached components to search.
 * @param identity   The reference to look up; an absent `version` matches nothing, since every entry has one.
 */
export function findCachedComponentVersion<T extends CacheKeyFields>(
  components: readonly T[],
  identity: ComponentIdentity
): T | undefined {
  return components.find(comp => sameComponent(comp, identity) && comp.version === identity.version);
}

/**
 * Any cached version of the referenced component, for a best-effort fallback when the referenced version can't be had.
 *
 * @param components The cached components to search.
 * @param identity   The reference to look up; its `version` is ignored.
 */
export function findAnyCachedComponentVersion<T extends CacheKeyFields>(
  components: readonly T[],
  identity: ComponentIdentity
): T | undefined {
  return components.find(comp => sameComponent(comp, identity));
}
