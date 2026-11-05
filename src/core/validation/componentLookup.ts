/**
 * Pure lookups over the cached component list, shared by every host that validates against the component cache.
 */

import { Logger } from '../../utils/logger';
import {
  findAnyCachedComponentVersion,
  findCachedComponentVersion,
  parseComponentIdentity,
  type ComponentIdentity,
} from '../../utils/cachedComponentLookup';
import type { CachedComponent } from '../../types/cache';
import type { Component } from '../../types/git-component';

const logger = Logger.getInstance();

/**
 * Parse a component URL into its cache identity, treating a reference with no `@ref` as `main`.
 */
export function parseComponentRef(url: string): Required<ComponentIdentity> | null {
  const identity = parseComponentIdentity(url);
  if (!identity) {
    logger.debug(`[ValidationProvider] Not a component URL: ${url}`, 'ValidationProvider');
    return null;
  }
  return { ...identity, version: identity.version ?? 'main' };
}

/**
 * Find the cached entry for exactly the referenced component version.
 *
 * @param cachedComponents The cache contents.
 * @param componentUrl     The expanded component URL.
 * @returns The entry as a `Component`, or `null` when the URL isn't a component reference or nothing matches.
 */
export function findComponentInCache(cachedComponents: readonly CachedComponent[], componentUrl: string): Component | null {
  const identity = parseComponentRef(componentUrl);
  if (!identity) {
    return null;
  }

  const cachedComponent =
    cachedComponents.find(comp => comp.url === componentUrl) ??
    findCachedComponentVersion(cachedComponents, identity);
  if (!cachedComponent) {
    return null;
  }

  // Convert cached component to Component interface
  return {
    name: cachedComponent.name,
    description: cachedComponent.description,
    parameters: cachedComponent.parameters,
    version: cachedComponent.version,
    source: cachedComponent.source,
    documentationUrl: undefined,
    context: {
      gitlabInstance: cachedComponent.gitlabInstance,
      path: cachedComponent.sourcePath
    }
  };
}

/**
 * The cache entry to fetch a component's versions with. Reuses a cached version when one is known (so monorepo
 * tag-pattern scoping applies), otherwise builds a minimal lookup from the parsed URL.
 *
 * @param getCachedComponents Reads the cache contents; only called once the URL parses.
 * @param baseUrl             The component base URL (no `@version`).
 * @returns The lookup entry, or `undefined` when the URL can't be parsed.
 */
export async function buildVersionLookup(
  getCachedComponents: () => Promise<readonly CachedComponent[]>,
  baseUrl: string
): Promise<CachedComponent | undefined> {
  const identity = parseComponentRef(baseUrl);
  if (!identity) {
    return undefined;
  }
  return findAnyCachedComponentVersion(await getCachedComponents(), identity) ?? {
    name: identity.name,
    description: '',
    parameters: [],
    source: `${identity.gitlabInstance}/${identity.sourcePath}`,
    sourcePath: identity.sourcePath,
    gitlabInstance: identity.gitlabInstance,
    version: identity.version,
    url: baseUrl,
  };
}
