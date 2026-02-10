/**
 * Unified cache system exports
 *
 * This module provides a hierarchical cache system with specialized modules:
 * - ComponentCacheManager: Main orchestrator for component caching
 * - ProjectCache: Project-level component fetching
 * - VersionCache: Version management and caching
 * - GroupCache: Group/multi-project scanning
 * - UnifiedCache: Low-level cache infrastructure
 */

export { UnifiedCache, getUnifiedCache, resetUnifiedCache } from './unifiedCache';
export {
  ComponentCacheManager,
  getComponentCacheManager,
} from './componentCacheManager';
export { ProjectCache } from './projectCache';
export { VersionCache } from './versionCache';
export { GroupCache } from './groupCache';
export {
  CacheType,
  CacheStats,
  CacheGetOptions,
  CacheGetResult,
  CacheFetcher,
  UnifiedCacheEntry,
  SerializedCacheData,
} from './cacheTypes';
