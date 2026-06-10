/**
 * Cache-related type definitions for the GitLab Component Helper extension
 */

import type { ParameterDefault } from './git-component';

/**
 * How a component's ref is classified for caching: a `branch` gets the freshness check (it can move); a `tag` skips it
 * (taken as fixed by convention).
 */
export type RefType = 'branch' | 'tag';

/**
 * Generic cache entry with timestamp for expiration tracking
 */
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Cache entry for GitLab catalog data
 */
export interface CatalogCacheEntry {
  components: Array<{
    name: string;
    description?: string;
    variables?: Array<{
      name: string;
      description?: string;
      required?: boolean;
      type?: string;
      default?: ParameterDefault;
    }>;
    latest_version?: string;
  }>;
}

/**
 * Cache entry for individual component data
 */
export interface ComponentCacheEntry {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    description: string;
    required: boolean;
    type: string;
    default?: ParameterDefault;
    options?: Array<string | number | boolean>;
  }>;
  version?: string;
  source?: string;
  documentationUrl?: string;
  context?: {
    gitlabInstance: string;
    path: string;
  };
}

/**
 * Cache entry for project versions (tags and branches)
 */
export interface ProjectVersionsCacheEntry {
  versions: string[];
  timestamp: number;
}

/**
 * Cached component with all metadata
 */
export interface CachedComponent {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    description: string;
    required: boolean;
    type: string;
    default?: ParameterDefault;
    options?: Array<string | number | boolean>;
  }>;
  source: string;
  sourcePath: string;
  gitlabInstance: string;
  version: string;
  url: string;
  availableVersions?: string[];
  templatePath?: string;
  /** Rendered README content, populated when the component fetch succeeded against the project's README. */
  readme?: string;
  /** Catalog `spec.summary` — short one-line component summary. */
  summary?: string;
  /** Catalog `spec.usage` — usage instructions. */
  usage?: string;
  /** Catalog `spec.notes` — additional notes from the component's template header. */
  notes?: string[];
  /** Raw YAML source of the template, populated when the fetch retrieved the template file. */
  rawYaml?: string;
  /** For components pinned to a mutable branch ref, the branch HEAD commit SHA at the time this entry was cached. */
  resolvedSha?: string;
  /** Epoch ms when this branch entry was last fetched/revalidated. */
  cachedAt?: number;
  /** Authoritative ref classification for this entry, resolved once against GitLab and persisted. */
  refType?: RefType;
}

/**
 * Persistent cache data structure stored in global state
 */
export interface PersistentCacheData {
  components: CachedComponent[];
  lastRefreshTime: number;
  projectVersionsCache: Array<[string, string[]]>;
  version: string;
}
