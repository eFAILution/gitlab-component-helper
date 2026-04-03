# Unified Cache System

Centralized cache management for the GitLab Component Helper extension, replacing scattered Map-based caches.

## Overview

The unified cache provides:
- **Single cache manager** for all cache types
- **Hierarchical cache keys** with type namespacing
- **Automatic TTL** checking and expiration
- **Persistence** to VS Code global state
- **Graceful fallback** to stale data on fetch failures
- **Statistics** and memory estimation
- **Singleton pattern** for global access

## Architecture

### Cache Types

```typescript
enum CacheType {
  COMPONENT = 'component',    // Individual component metadata
  CATALOG = 'catalog',        // Full catalog of components from a project
  SOURCE = 'source',          // Source file content
  PROJECT_VERSIONS = 'versions' // Available versions (tags/branches) for a project
}
```

### Hierarchical Keys

Cache keys are built hierarchically with type prefix:

```
component:gitlab.com/group/project/component@1.0.0
catalog:gitlab.com/group/project
source:gitlab.com/group/project/file.yml
versions:gitlab.com/group/project
```

This prevents key collisions between different cache types and makes invalidation easier.

## API

### Basic Usage

#### Get Singleton Instance

```typescript
import { getUnifiedCache, CacheType } from './services/cache';

const cache = getUnifiedCache(context); // Pass VS Code context for persistence
```

### Cache Operations

#### Get with Auto-Fetch

The `get()` method automatically fetches data on cache miss:

```typescript
const result = await cache.get<ComponentData>(
  CacheType.COMPONENT,
  ['gitlab.com', 'project/path', 'component@1.0.0'],
  async () => {
    // Fetcher function - only called on cache miss
    return await fetchComponentFromGitLab();
  },
  3600000 // Optional TTL in milliseconds (defaults based on type)
);

console.log(result.data); // The component data
console.log(result.fromCache); // true if from cache
console.log(result.isStale); // true if stale data was returned
console.log(result.age); // Age of cached data in milliseconds
```

#### Set Explicitly

```typescript
cache.set(
  CacheType.COMPONENT,
  ['gitlab.com', 'project/path', 'component@1.0.0'],
  componentData,
  3600000 // Optional TTL
);
```

#### Invalidate Entries

```typescript
// Invalidate all components
cache.invalidate(CacheType.COMPONENT);

// Invalidate specific instance
cache.invalidate(CacheType.COMPONENT, 'gitlab.com/project/*');

// Invalidate specific component version
cache.invalidate(CacheType.COMPONENT, 'gitlab.com/project/component@1.0.0');
```

#### Clear Cache

```typescript
// Clear all entries
cache.clear();

// Clear specific type
cache.clear(CacheType.COMPONENT);
```

#### Get Statistics

```typescript
const stats = cache.getStats();
console.log(`Total entries: ${stats.totalEntries}`);
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
console.log(`Memory: ${(stats.estimatedMemoryBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`Components: ${stats.entriesByType.component}`);
console.log(`Catalogs: ${stats.entriesByType.catalog}`);
```

## Advanced Usage

### Graceful Fallback to Stale Data

When the fetcher fails, you can choose to return stale cached data:

```typescript
try {
  const result = await cache.get(
    CacheType.COMPONENT,
    ['gitlab.com', 'project/path', 'component'],
    fetchComponent,
    undefined,
    { allowStale: true } // Return stale data if fetch fails
  );

  if (result.isStale) {
    console.warn('Using stale data due to fetch failure');
  }
} catch (error) {
  // Only throws if no stale data available
  console.error('No data available:', error);
}
```

### Skip Cache for Fresh Data

```typescript
const result = await cache.get(
  CacheType.COMPONENT,
  ['gitlab.com', 'project/path', 'component'],
  fetchComponent,
  undefined,
  { skipCache: true } // Always fetch fresh
);
```

### Manual Cache Cleanup

```typescript
// Remove expired entries
const prunedCount = cache.prune();
console.log(`Removed ${prunedCount} expired entries`);
```

## Migration Guide

### Before: Scattered Map Caches

```typescript
// componentService.ts
private componentCache = new Map<string, Component>();
private catalogCache = new Map<string, any>();
const sourceCache = new Map<string, CacheEntry>();

// componentCacheManager.ts
private projectVersionsCache: Map<string, string[]> = new Map();

// Manual cache key building
const key = `${instance}|${path}|${version}`;
if (componentCache.has(key)) {
  return componentCache.get(key);
}
const data = await fetch();
componentCache.set(key, data);
```

### After: Unified Cache

```typescript
import { getUnifiedCache, CacheType } from './services/cache';

const cache = getUnifiedCache(context);

// Automatic cache key building and TTL management
const result = await cache.get(
  CacheType.COMPONENT,
  [instance, path, version],
  async () => await fetch()
);

return result.data;
```

## Migration Examples

### Example 1: Component Cache

**Before:**
```typescript
const key = `${gitlabInstance}|${sourcePath}|${componentName}|${version}`;
if (this.componentCache.has(key)) {
  return this.componentCache.get(key);
}
const component = await this.fetchComponent(...);
this.componentCache.set(key, component);
```

**After:**
```typescript
const result = await cache.get(
  CacheType.COMPONENT,
  [gitlabInstance, sourcePath, componentName, version],
  () => this.fetchComponent(...)
);
return result.data;
```

### Example 2: Catalog Cache

**Before:**
```typescript
const key = `${gitlabInstance}|${projectPath}`;
if (this.catalogCache.has(key)) {
  const cached = this.catalogCache.get(key);
  if (Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
}
const catalog = await this.fetchCatalog(...);
this.catalogCache.set(key, { data: catalog, timestamp: Date.now() });
```

**After:**
```typescript
const result = await cache.get(
  CacheType.CATALOG,
  [gitlabInstance, projectPath],
  () => this.fetchCatalog(...)
);
return result.data;
```

### Example 3: Version Cache

**Before:**
```typescript
const key = `${gitlabInstance}|${projectPath}`;
if (this.projectVersionsCache.has(key)) {
  return this.projectVersionsCache.get(key);
}
const versions = await this.fetchVersions(...);
this.projectVersionsCache.set(key, versions);
```

**After:**
```typescript
const result = await cache.get(
  CacheType.PROJECT_VERSIONS,
  [gitlabInstance, projectPath],
  () => this.fetchVersions(...),
  DEFAULT_VERSION_CACHE_TIME_SECONDS * 1000
);
return result.data;
```

## Default TTL Values

| Cache Type | Default TTL | Source |
|------------|-------------|--------|
| COMPONENT | 1 hour (3600s) | `DEFAULT_CACHE_TIME_SECONDS` |
| CATALOG | 1 hour (3600s) | `DEFAULT_CACHE_TIME_SECONDS` |
| SOURCE | 1 hour (3600s) | `DEFAULT_CACHE_TIME_SECONDS` |
| PROJECT_VERSIONS | 24 hours (86400s) | `DEFAULT_VERSION_CACHE_TIME_SECONDS` |

## Persistence

Cache is automatically persisted to VS Code global state:
- Survives VS Code restarts
- Shared across all workspaces
- Version-aware (invalidates on schema changes)

```typescript
// Persistence happens automatically on:
// - set()
// - invalidate()
// - clear()
// - prune()
```

## Testing

```typescript
import { resetUnifiedCache } from './services/cache';

beforeEach(() => {
  resetUnifiedCache(); // Reset singleton for test isolation
});
```

## Performance Characteristics

- **Get operation**: O(1) hash map lookup
- **Set operation**: O(1) hash map insert + async persistence
- **Invalidate**: O(n) where n = entries of that type
- **Clear**: O(1) for full clear, O(n) for type-specific
- **Stats**: O(n) where n = total entries
- **Prune**: O(n) where n = total entries

## Memory Management

The cache automatically tracks memory usage:

```typescript
const stats = cache.getStats();
if (stats.estimatedMemoryBytes > 50 * 1024 * 1024) { // 50 MB
  cache.prune(); // Remove expired entries
  // or
  cache.clear(CacheType.SOURCE); // Clear specific type
}
```

## Best Practices

1. **Always pass VS Code context** to enable persistence:
   ```typescript
   const cache = getUnifiedCache(context);
   ```

2. **Use allowStale for reliability**:
   ```typescript
   await cache.get(type, key, fetcher, ttl, { allowStale: true });
   ```

3. **Invalidate on config changes**:
   ```typescript
   vscode.workspace.onDidChangeConfiguration(e => {
     if (e.affectsConfiguration('gitlabComponentHelper')) {
       cache.invalidate(CacheType.COMPONENT);
     }
   });
   ```

4. **Monitor cache health**:
   ```typescript
   setInterval(() => {
     const stats = cache.getStats();
     logger.debug(`Cache: ${stats.totalEntries} entries, ${stats.hitRate}`);
   }, 60000);
   ```

5. **Prune periodically**:
   ```typescript
   setInterval(() => cache.prune(), 3600000); // Every hour
   ```

## Troubleshooting

### Cache not persisting
Ensure VS Code context is passed to `getUnifiedCache(context)`.

### High memory usage
Run `cache.prune()` to remove expired entries or `cache.clear()` to reset.

### Stale data issues
Adjust TTL values or use `skipCache: true` option for critical operations.

### Cache key collisions
Ensure you're using the correct `CacheType` and unique key parts.

## Future Enhancements

- [ ] LRU eviction for memory limits
- [ ] Cache warming on extension activation
- [ ] Compression for large entries
- [ ] Cache export/import for debugging
- [ ] Metrics dashboard in extension UI
