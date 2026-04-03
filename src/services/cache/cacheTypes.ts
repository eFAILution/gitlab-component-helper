/**
 * Type definitions for the unified cache system
 */

/**
 * Cache entry types for hierarchical key namespacing
 */
export enum CacheType {
  COMPONENT = 'component',
  CATALOG = 'catalog',
  SOURCE = 'source',
  PROJECT_VERSIONS = 'versions',
}

/**
 * Internal cache entry with data, metadata, and TTL tracking
 */
export interface UnifiedCacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  isStale?: boolean;
}

/**
 * Cache statistics for monitoring and debugging
 */
export interface CacheStats {
  totalEntries: number;
  entriesByType: Record<CacheType, number>;
  estimatedMemoryBytes: number;
  hitRate: number;
  missRate: number;
  totalHits: number;
  totalMisses: number;
  staleHits: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

/**
 * Serializable cache data for persistence to VS Code global state
 */
export interface SerializedCacheData {
  entries: Array<{
    type: CacheType;
    key: string;
    data: any;
    timestamp: number;
    ttl: number;
  }>;
  stats: {
    totalHits: number;
    totalMisses: number;
    staleHits: number;
  };
  version: string;
}

/**
 * Fetcher function for auto-populating cache on miss
 */
export type CacheFetcher<T> = () => Promise<T>;

/**
 * Options for cache operations
 */
export interface CacheGetOptions {
  allowStale?: boolean; // Allow returning stale data if fresh fetch fails
  skipCache?: boolean; // Skip cache and always fetch fresh
}

/**
 * Result of a cache get operation with metadata
 */
export interface CacheGetResult<T> {
  data: T;
  fromCache: boolean;
  isStale: boolean;
  age: number; // Age in milliseconds
}
