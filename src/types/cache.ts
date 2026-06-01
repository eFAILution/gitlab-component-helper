/**
 * Cache-related type definitions for the GitLab Component Helper extension
 */

import type { ParameterDefault } from './git-component';

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
  }>;
  source: string;
  sourcePath: string;
  gitlabInstance: string;
  version: string;
  url: string;
  availableVersions?: string[];
  templatePath?: string;
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
