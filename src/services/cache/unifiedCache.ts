/**
 * Unified cache system to replace scattered Map-based caches throughout the extension.
 *
 * Features:
 * - Single cache manager for all cache types (component, catalog, source, versions)
 * - Hierarchical cache keys with type namespacing
 * - Automatic TTL checking and expiration
 * - Persistence to VS Code global state
 * - Graceful fallback to stale data on fetch failures
 * - Statistics and memory estimation
 * - Singleton pattern for global access
 */

import * as vscode from 'vscode';
import {
  CacheType,
  UnifiedCacheEntry,
  CacheStats,
  SerializedCacheData,
  CacheFetcher,
  CacheGetOptions,
  CacheGetResult,
} from './cacheTypes';
import { DEFAULT_CACHE_TIME_SECONDS, DEFAULT_VERSION_CACHE_TIME_SECONDS } from '../../constants/timing';
import { CACHE_KEY_COMPONENTS } from '../../constants/cache';
import { Logger } from '../../utils/logger';

/**
 * Unified cache manager for all extension caching needs
 */
export class UnifiedCache {
  private cache = new Map<string, UnifiedCacheEntry<any>>();
  private context: vscode.ExtensionContext | null = null;
  private logger = Logger.getInstance();
  private persistenceEnabled = false;

  // Statistics tracking
  private stats = {
    totalHits: 0,
    totalMisses: 0,
    staleHits: 0,
  };

  constructor(context?: vscode.ExtensionContext) {
    if (context) {
      this.context = context;
      this.persistenceEnabled = true;
      this.loadFromPersistence().catch(error => {
        this.logger.debug(`[UnifiedCache] Failed to load from persistence: ${error}`);
      });
    }
  }

  /**
   * Build a hierarchical cache key with type prefix
   * Examples:
   * - component:gitlab.com/project/path/component@1.0.0
   * - catalog:gitlab.com/project/path
   * - source:gitlab.com/project/path
   * - versions:gitlab.com/project/path
   */
  private buildKey(type: CacheType, ...parts: string[]): string {
    return `${type}:${parts.join('/')}`;
  }

  /**
   * Check if a cache entry is expired based on its TTL
   */
  private isExpired(entry: UnifiedCacheEntry<any>): boolean {
    const now = Date.now();
    const age = now - entry.timestamp;
    return age > entry.ttl;
  }

  /**
   * Get data from cache with automatic fetching on miss
   *
   * @param type Cache type for namespacing
   * @param key Cache key parts (will be joined with type)
   * @param fetcher Function to fetch data on cache miss
   * @param ttl Time-to-live in milliseconds (defaults based on type)
   * @param options Additional options for cache behavior
   * @returns Promise resolving to cached or fetched data with metadata
   */
  async get<T>(
    type: CacheType,
    key: string[],
    fetcher: CacheFetcher<T>,
    ttl?: number,
    options: CacheGetOptions = {}
  ): Promise<CacheGetResult<T>> {
    const cacheKey = this.buildKey(type, ...key);
    const effectiveTtl = ttl ?? this.getDefaultTtl(type);

    // Skip cache if requested
    if (options.skipCache) {
      this.stats.totalMisses++;
      const data = await fetcher();
      this.set(type, key, data, effectiveTtl);
      return {
        data,
        fromCache: false,
        isStale: false,
        age: 0,
      };
    }

    // Check cache
    const entry = this.cache.get(cacheKey);

    if (entry) {
      const isExpired = this.isExpired(entry);
      const age = Date.now() - entry.timestamp;

      // Fresh hit
      if (!isExpired) {
        this.stats.totalHits++;
        return {
          data: entry.data as T,
          fromCache: true,
          isStale: false,
          age,
        };
      }

      // Stale hit - try to refresh
      try {
        this.stats.totalMisses++;
        const freshData = await fetcher();
        this.set(type, key, freshData, effectiveTtl);
        return {
          data: freshData,
          fromCache: false,
          isStale: false,
          age: 0,
        };
      } catch (error) {
        // Fallback to stale data if allowed
        if (options.allowStale) {
          this.stats.staleHits++;
          this.logger.debug(
            `[UnifiedCache] Fetch failed, using stale data for ${cacheKey}: ${error}`
          );
          return {
            data: entry.data as T,
            fromCache: true,
            isStale: true,
            age,
          };
        }
        throw error;
      }
    }

    // Cache miss - fetch fresh data
    this.stats.totalMisses++;
    const data = await fetcher();
    this.set(type, key, data, effectiveTtl);
    return {
      data,
      fromCache: false,
      isStale: false,
      age: 0,
    };
  }

  /**
   * Set data in cache with explicit TTL
   */
  set<T>(type: CacheType, key: string[], data: T, ttl?: number): void {
    const cacheKey = this.buildKey(type, ...key);
    const effectiveTtl = ttl ?? this.getDefaultTtl(type);

    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      ttl: effectiveTtl,
    });

    // Trigger async persistence (fire and forget)
    if (this.persistenceEnabled) {
      this.saveToPersistence().catch(error => {
        this.logger.debug(`[UnifiedCache] Failed to persist cache: ${error}`);
      });
    }
  }

  /**
   * Invalidate specific cache entries by type and key pattern
   *
   * @param type Cache type to invalidate
   * @param keyPattern Optional key pattern to match (supports wildcards)
   */
  invalidate(type: CacheType, keyPattern?: string): number {
    let invalidatedCount = 0;
    const prefix = `${type}:`;

    for (const key of Array.from(this.cache.keys())) {
      if (!key.startsWith(prefix)) {
        continue;
      }

      if (!keyPattern) {
        // Invalidate all of this type
        this.cache.delete(key);
        invalidatedCount++;
      } else {
        // Match pattern (simple wildcard support)
        const pattern = keyPattern.replace(/\*/g, '.*');
        const regex = new RegExp(`^${prefix}${pattern}$`);
        if (regex.test(key)) {
          this.cache.delete(key);
          invalidatedCount++;
        }
      }
    }

    this.logger.debug(
      `[UnifiedCache] Invalidated ${invalidatedCount} entries for type=${type} pattern=${keyPattern || '*'}`
    );

    // Trigger async persistence
    if (this.persistenceEnabled && invalidatedCount > 0) {
      this.saveToPersistence().catch(error => {
        this.logger.debug(`[UnifiedCache] Failed to persist after invalidation: ${error}`);
      });
    }

    return invalidatedCount;
  }

  /**
   * Clear all cache entries, optionally filtered by type
   */
  clear(type?: CacheType): void {
    if (type) {
      this.invalidate(type);
    } else {
      this.cache.clear();
      this.logger.debug('[UnifiedCache] Cleared all cache entries');
    }

    // Reset stats
    this.stats = {
      totalHits: 0,
      totalMisses: 0,
      staleHits: 0,
    };

    // Trigger async persistence
    if (this.persistenceEnabled) {
      this.saveToPersistence().catch(error => {
        this.logger.debug(`[UnifiedCache] Failed to persist after clear: ${error}`);
      });
    }
  }

  /**
   * Get cache statistics for monitoring and debugging
   */
  getStats(): CacheStats {
    const entriesByType: Record<CacheType, number> = {
      [CacheType.COMPONENT]: 0,
      [CacheType.CATALOG]: 0,
      [CacheType.SOURCE]: 0,
      [CacheType.PROJECT_VERSIONS]: 0,
    };

    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;
    let estimatedBytes = 0;

    for (const [key, entry] of Array.from(this.cache.entries())) {
      // Count by type
      const type = key.split(':')[0] as CacheType;
      if (type in entriesByType) {
        entriesByType[type]++;
      }

      // Track timestamps
      if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
      if (newestTimestamp === null || entry.timestamp > newestTimestamp) {
        newestTimestamp = entry.timestamp;
      }

      // Estimate memory (rough approximation)
      try {
        estimatedBytes += JSON.stringify(entry).length * 2; // UTF-16 = 2 bytes per char
      } catch {
        estimatedBytes += 1000; // Fallback estimate for non-serializable data
      }
    }

    const totalRequests = this.stats.totalHits + this.stats.totalMisses;
    const hitRate = totalRequests > 0 ? this.stats.totalHits / totalRequests : 0;
    const missRate = totalRequests > 0 ? this.stats.totalMisses / totalRequests : 0;

    return {
      totalEntries: this.cache.size,
      entriesByType,
      estimatedMemoryBytes: estimatedBytes,
      hitRate,
      missRate,
      totalHits: this.stats.totalHits,
      totalMisses: this.stats.totalMisses,
      staleHits: this.stats.staleHits,
      oldestEntry: oldestTimestamp,
      newestEntry: newestTimestamp,
    };
  }

  /**
   * Get default TTL based on cache type
   */
  private getDefaultTtl(type: CacheType): number {
    switch (type) {
      case CacheType.PROJECT_VERSIONS:
        return DEFAULT_VERSION_CACHE_TIME_SECONDS * 1000;
      case CacheType.COMPONENT:
      case CacheType.CATALOG:
      case CacheType.SOURCE:
      default:
        return DEFAULT_CACHE_TIME_SECONDS * 1000;
    }
  }

  /**
   * Load cache from VS Code global state
   */
  private async loadFromPersistence(): Promise<void> {
    if (!this.context) {
      return;
    }

    try {
      const serialized = this.context.globalState.get<SerializedCacheData>(CACHE_KEY_COMPONENTS);

      if (!serialized) {
        this.logger.debug('[UnifiedCache] No persisted cache found');
        return;
      }

      // Validate version compatibility
      const currentVersion = '1.0.0';
      if (serialized.version !== currentVersion) {
        this.logger.debug(
          `[UnifiedCache] Cache version mismatch (stored=${serialized.version}, current=${currentVersion}), ignoring`
        );
        return;
      }

      // Restore entries
      for (const { type, key, data, timestamp, ttl } of serialized.entries) {
        const cacheKey = `${type}:${key}`;
        this.cache.set(cacheKey, { data, timestamp, ttl });
      }

      // Restore stats
      this.stats = serialized.stats;

      this.logger.debug(
        `[UnifiedCache] Loaded ${serialized.entries.length} entries from persistence`
      );
    } catch (error) {
      this.logger.debug(`[UnifiedCache] Error loading from persistence: ${error}`);
    }
  }

  /**
   * Save cache to VS Code global state
   */
  private async saveToPersistence(): Promise<void> {
    if (!this.context) {
      return;
    }

    try {
      const entries: SerializedCacheData['entries'] = [];

      for (const [fullKey, entry] of Array.from(this.cache.entries())) {
        const [type, ...keyParts] = fullKey.split(':');
        entries.push({
          type: type as CacheType,
          key: keyParts.join(':'),
          data: entry.data,
          timestamp: entry.timestamp,
          ttl: entry.ttl,
        });
      }

      const serialized: SerializedCacheData = {
        entries,
        stats: this.stats,
        version: '1.0.0',
      };

      await this.context.globalState.update(CACHE_KEY_COMPONENTS, serialized);

      this.logger.debug(`[UnifiedCache] Persisted ${entries.length} entries`);
    } catch (error) {
      this.logger.debug(`[UnifiedCache] Error saving to persistence: ${error}`);
    }
  }

  /**
   * Remove all expired entries from cache (manual cleanup)
   */
  prune(): number {
    let prunedCount = 0;

    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        prunedCount++;
      }
    }

    if (prunedCount > 0) {
      this.logger.debug(`[UnifiedCache] Pruned ${prunedCount} expired entries`);

      // Trigger async persistence
      if (this.persistenceEnabled) {
        this.saveToPersistence().catch(error => {
          this.logger.debug(`[UnifiedCache] Failed to persist after pruning: ${error}`);
        });
      }
    }

    return prunedCount;
  }
}

// Singleton instance
let unifiedCacheInstance: UnifiedCache | null = null;

/**
 * Get or create the singleton unified cache instance
 */
export function getUnifiedCache(context?: vscode.ExtensionContext): UnifiedCache {
  if (!unifiedCacheInstance) {
    unifiedCacheInstance = new UnifiedCache(context);
  }
  return unifiedCacheInstance;
}

/**
 * Reset the singleton (mainly for testing)
 */
export function resetUnifiedCache(): void {
  unifiedCacheInstance = null;
}
