# Unified Cache Examples

Practical examples for migrating existing code to use the unified cache.

## Example 1: Replacing componentCache

### Before (componentService.ts)

```typescript
private componentCache = new Map<string, Component>();

async getComponent(
  gitlabInstance: string,
  path: string,
  name: string,
  version: string
): Promise<Component> {
  const key = `${gitlabInstance}|${path}|${name}|${version}`;

  // Check cache
  if (this.componentCache.has(key)) {
    return this.componentCache.get(key)!;
  }

  // Fetch if not cached
  const component = await this.fetchComponentFromGitLab(
    gitlabInstance,
    path,
    name,
    version
  );

  // Store in cache
  this.componentCache.set(key, component);

  return component;
}
```

### After (using UnifiedCache)

```typescript
import { getUnifiedCache, CacheType } from './cache';

async getComponent(
  gitlabInstance: string,
  path: string,
  name: string,
  version: string
): Promise<Component> {
  const cache = getUnifiedCache(this.context);

  const result = await cache.get(
    CacheType.COMPONENT,
    [gitlabInstance, path, name, version],
    () => this.fetchComponentFromGitLab(gitlabInstance, path, name, version)
  );

  return result.data;
}
```

**Benefits:**
- Automatic TTL management
- Persistence across restarts
- Statistics tracking
- Graceful stale data fallback
- Reduced boilerplate code

## Example 2: Replacing catalogCache with TTL

### Before (componentService.ts)

```typescript
private catalogCache = new Map<string, any>();

async getCatalog(gitlabInstance: string, projectPath: string): Promise<any> {
  const key = `${gitlabInstance}|${projectPath}`;

  // Check cache with manual TTL
  if (this.catalogCache.has(key)) {
    const cached = this.catalogCache.get(key);
    const age = Date.now() - cached.timestamp;

    if (age < DEFAULT_CACHE_TIME_SECONDS * 1000) {
      return cached.data;
    }

    // Expired, remove it
    this.catalogCache.delete(key);
  }

  // Fetch fresh data
  const catalog = await this.fetchCatalog(gitlabInstance, projectPath);

  // Cache with timestamp
  this.catalogCache.set(key, {
    data: catalog,
    timestamp: Date.now()
  });

  return catalog;
}
```

### After (using UnifiedCache)

```typescript
import { getUnifiedCache, CacheType } from './cache';

async getCatalog(gitlabInstance: string, projectPath: string): Promise<any> {
  const cache = getUnifiedCache(this.context);

  const result = await cache.get(
    CacheType.CATALOG,
    [gitlabInstance, projectPath],
    () => this.fetchCatalog(gitlabInstance, projectPath)
    // TTL is automatically applied from DEFAULT_CACHE_TIME_SECONDS
  );

  return result.data;
}
```

**Benefits:**
- Automatic expiration without manual checks
- No need to store timestamps manually
- Cleaner code

## Example 3: Replacing sourceCache with Error Handling

### Before (componentService.ts)

```typescript
const sourceCache = new Map<string, CacheEntry>();

async getSource(
  gitlabInstance: string,
  projectPath: string,
  filePath: string
): Promise<string> {
  const key = `${gitlabInstance}|${projectPath}|${filePath}`;

  if (sourceCache.has(key)) {
    const cached = sourceCache.get(key)!;
    if (Date.now() - cached.timestamp < DEFAULT_CACHE_TIME_SECONDS * 1000) {
      return cached.data;
    }
  }

  try {
    const source = await this.httpClient.getFileContent(
      gitlabInstance,
      projectPath,
      filePath
    );

    sourceCache.set(key, {
      data: source,
      timestamp: Date.now()
    });

    return source;
  } catch (error) {
    // If we have stale cache, use it as fallback
    if (sourceCache.has(key)) {
      console.warn('Using stale cache due to error:', error);
      return sourceCache.get(key)!.data;
    }
    throw error;
  }
}
```

### After (using UnifiedCache)

```typescript
import { getUnifiedCache, CacheType } from './cache';

async getSource(
  gitlabInstance: string,
  projectPath: string,
  filePath: string
): Promise<string> {
  const cache = getUnifiedCache(this.context);

  const result = await cache.get(
    CacheType.SOURCE,
    [gitlabInstance, projectPath, filePath],
    () => this.httpClient.getFileContent(gitlabInstance, projectPath, filePath),
    undefined,
    { allowStale: true } // Automatically fallback to stale on error
  );

  if (result.isStale) {
    this.logger.warn(`Using stale source cache for ${filePath}`);
  }

  return result.data;
}
```

**Benefits:**
- Built-in stale data fallback
- Automatic error handling
- Clear indication when using stale data

## Example 4: Replacing projectVersionsCache

### Before (componentCacheManager.ts)

```typescript
private projectVersionsCache: Map<string, string[]> = new Map();

async getProjectVersions(
  gitlabInstance: string,
  sourcePath: string
): Promise<string[]> {
  const key = `${gitlabInstance}|${sourcePath}`;

  if (this.projectVersionsCache.has(key)) {
    return this.projectVersionsCache.get(key)!;
  }

  const versions = await this.fetchVersions(gitlabInstance, sourcePath);
  this.projectVersionsCache.set(key, versions);

  return versions;
}

// Clear cache on config change
vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('gitlabComponentHelper')) {
    this.projectVersionsCache.clear();
  }
});
```

### After (using UnifiedCache)

```typescript
import { getUnifiedCache, CacheType } from './cache';
import { DEFAULT_VERSION_CACHE_TIME_SECONDS } from '../../constants/timing';

async getProjectVersions(
  gitlabInstance: string,
  sourcePath: string
): Promise<string[]> {
  const cache = getUnifiedCache(this.context);

  const result = await cache.get(
    CacheType.PROJECT_VERSIONS,
    [gitlabInstance, sourcePath],
    () => this.fetchVersions(gitlabInstance, sourcePath),
    DEFAULT_VERSION_CACHE_TIME_SECONDS * 1000 // 24 hours
  );

  return result.data;
}

// Clear cache on config change
vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('gitlabComponentHelper')) {
    const cache = getUnifiedCache(this.context);
    cache.invalidate(CacheType.PROJECT_VERSIONS);
  }
});
```

**Benefits:**
- Explicit TTL for version cache (24 hours vs 1 hour for others)
- Type-safe invalidation
- Persistence across restarts

## Example 5: Cache Invalidation Patterns

### Invalidate All Components for an Instance

```typescript
const cache = getUnifiedCache(context);

// Invalidate all components from gitlab.com
cache.invalidate(CacheType.COMPONENT, 'gitlab.com/*');

// Invalidate specific project
cache.invalidate(CacheType.COMPONENT, 'gitlab.com/group/project/*');

// Invalidate specific component (all versions)
cache.invalidate(CacheType.COMPONENT, 'gitlab.com/group/project/my-component@*');

// Invalidate all components (any instance)
cache.invalidate(CacheType.COMPONENT);
```

### Clear Cache on Authentication Change

```typescript
// When user adds/removes token
async setToken(instance: string, token: string): Promise<void> {
  await this.secretStorage.store(`gitlab-token-${instance}`, token);

  const cache = getUnifiedCache(this.context);

  // Invalidate all caches for this instance
  cache.invalidate(CacheType.COMPONENT, `${instance}/*`);
  cache.invalidate(CacheType.CATALOG, `${instance}/*`);
  cache.invalidate(CacheType.SOURCE, `${instance}/*`);
  cache.invalidate(CacheType.PROJECT_VERSIONS, `${instance}/*`);
}
```

## Example 6: Monitoring Cache Health

### Add Cache Stats Command

```typescript
import { getUnifiedCache } from './services/cache';

const cache = getUnifiedCache(context);
const stats = cache.getStats();

const message = `
GitLab Component Helper Cache Statistics:

Total Entries: ${stats.totalEntries}
- Components: ${stats.entriesByType.component}
- Catalogs: ${stats.entriesByType.catalog}
- Sources: ${stats.entriesByType.source}
- Versions: ${stats.entriesByType.versions}

Hit Rate: ${(stats.hitRate * 100).toFixed(2)}%
Miss Rate: ${(stats.missRate * 100).toFixed(2)}%
Stale Hits: ${stats.staleHits}

Memory: ${(stats.estimatedMemoryBytes / 1024 / 1024).toFixed(2)} MB

Oldest Entry: ${stats.oldestEntry ? new Date(stats.oldestEntry).toLocaleString() : 'N/A'}
Newest Entry: ${stats.newestEntry ? new Date(stats.newestEntry).toLocaleString() : 'N/A'}
`;

vscode.window.showInformationMessage(message);
```

### Automatic Cache Pruning

```typescript
import { getUnifiedCache } from './services/cache';

// Prune expired entries every hour
setInterval(() => {
  const cache = getUnifiedCache(context);
  const pruned = cache.prune();

  if (pruned > 0) {
    logger.debug(`Pruned ${pruned} expired cache entries`);
  }
}, 3600000);
```

## Example 7: Background Cache Warming

### Pre-load Frequently Used Data

```typescript
import { getUnifiedCache, CacheType } from './services/cache';

async warmCache(context: vscode.ExtensionContext): Promise<void> {
  const cache = getUnifiedCache(context);
  const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
  const sources = config.get<any[]>('componentSources', []);

  logger.debug('Warming cache for configured sources...');

  for (const source of sources) {
    try {
      // Pre-load catalog
      await cache.get(
        CacheType.CATALOG,
        [source.gitlabInstance, source.path],
        () => componentService.fetchCatalog(source.gitlabInstance, source.path)
      );

      // Pre-load versions
      await cache.get(
        CacheType.PROJECT_VERSIONS,
        [source.gitlabInstance, source.path],
        () => componentService.fetchVersions(source.gitlabInstance, source.path)
      );

      logger.debug(`Warmed cache for ${source.gitlabInstance}/${source.path}`);
    } catch (error) {
      logger.debug(`Failed to warm cache for ${source.path}: ${error}`);
    }
  }
}

// Call on extension activation
export function activate(context: vscode.ExtensionContext) {
  // ... other activation code

  warmCache(context).catch(err =>
    logger.debug(`Cache warming failed: ${err}`)
  );
}
```

## Example 8: Testing with UnifiedCache

### Test Setup

```typescript
import { resetUnifiedCache, getUnifiedCache, CacheType } from './services/cache';

describe('ComponentService with UnifiedCache', () => {
  let service: ComponentService;
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    resetUnifiedCache(); // Reset singleton before each test

    mockContext = {
      globalState: {
        get: jest.fn().mockReturnValue(undefined),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    service = new ComponentService(mockContext);
  });

  it('should cache component fetches', async () => {
    const fetchSpy = jest.spyOn(service, 'fetchComponentFromGitLab');

    // First call - should fetch
    await service.getComponent('gitlab.com', 'project', 'comp', '1.0.0');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call - should use cache
    await service.getComponent('gitlab.com', 'project', 'comp', '1.0.0');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Still 1, not 2
  });

  it('should use stale data on fetch failure', async () => {
    const cache = getUnifiedCache(mockContext);

    // Prime the cache
    await cache.set(
      CacheType.COMPONENT,
      ['gitlab.com', 'project', 'comp', '1.0.0'],
      { name: 'comp', data: 'stale' },
      0 // Expired immediately
    );

    // Mock fetch to fail
    jest.spyOn(service, 'fetchComponentFromGitLab')
      .mockRejectedValue(new Error('Network error'));

    // Should return stale data instead of throwing
    const result = await cache.get(
      CacheType.COMPONENT,
      ['gitlab.com', 'project', 'comp', '1.0.0'],
      () => service.fetchComponentFromGitLab('gitlab.com', 'project', 'comp', '1.0.0'),
      undefined,
      { allowStale: true }
    );

    expect(result.data).toEqual({ name: 'comp', data: 'stale' });
    expect(result.isStale).toBe(true);
  });
});
```

## Migration Checklist

When migrating a cache to UnifiedCache:

- [ ] Identify cache type (COMPONENT, CATALOG, SOURCE, PROJECT_VERSIONS)
- [ ] Extract key parts (instance, path, name, version)
- [ ] Replace Map operations with cache.get()
- [ ] Remove manual TTL checking code
- [ ] Remove manual timestamp tracking
- [ ] Add allowStale option for reliability
- [ ] Update invalidation logic to use cache.invalidate()
- [ ] Update clear logic to use cache.clear()
- [ ] Pass VS Code context for persistence
- [ ] Update tests to use resetUnifiedCache()
- [ ] Remove old Map declarations
- [ ] Verify TypeScript compilation
- [ ] Test cache behavior in development
