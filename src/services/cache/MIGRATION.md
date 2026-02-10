# Migration Guide: Replacing Scattered Caches with UnifiedCache

This guide provides step-by-step instructions for migrating existing code to use the UnifiedCache.

## Overview of Changes

### Files to Modify
1. `/Users/collinpesicka/Documents/my_clones/gitlab-component-helper/src/services/componentService.ts`
2. `/Users/collinpesicka/Documents/my_clones/gitlab-component-helper/src/services/componentCacheManager.ts`

### Caches to Replace

| Current Location | Cache Variable | Line | Replacement |
|-----------------|----------------|------|-------------|
| componentService.ts | `sourceCache` | 173 | `getUnifiedCache()` + `CacheType.SOURCE` |
| componentService.ts | `componentCache` | 179 | `getUnifiedCache()` + `CacheType.COMPONENT` |
| componentService.ts | `catalogCache` | 180 | `getUnifiedCache()` + `CacheType.CATALOG` |
| componentCacheManager.ts | `projectVersionsCache` | 30 | `getUnifiedCache()` + `CacheType.PROJECT_VERSIONS` |

## Phase 1: componentService.ts

### Step 1: Add Import

```typescript
// Add at top of file with other imports
import { getUnifiedCache, CacheType } from './cache';
```

### Step 2: Remove Old Cache Declarations

**Remove:**
```typescript
// Line 173
const sourceCache = new Map<string, CacheEntry>();

// Line 179
private componentCache = new Map<string, Component>();

// Line 180
private catalogCache = new Map<string, any>();
```

### Step 3: Add Context Property

```typescript
export class ComponentService implements ComponentSource {
  public httpClient = new HttpClient();
  private logger = Logger.getInstance();
  private secretStorage: vscode.SecretStorage | undefined;
  private context: vscode.ExtensionContext | undefined; // ADD THIS

  constructor(context?: vscode.ExtensionContext) { // ADD PARAMETER
    this.context = context; // ADD THIS
  }

  // ... rest of class
}
```

### Step 4: Replace sourceCache Usage

**Find all occurrences of `sourceCache` and replace:**

**Before:**
```typescript
const cacheKey = `${gitlabInstance}|${projectPath}|${filePath}`;

if (sourceCache.has(cacheKey)) {
  const cached = sourceCache.get(cacheKey)!;
  if (Date.now() - cached.timestamp < DEFAULT_CACHE_TIME_SECONDS * 1000) {
    return cached.data;
  }
}

const source = await this.httpClient.getFileContent(...);
sourceCache.set(cacheKey, { data: source, timestamp: Date.now() });
return source;
```

**After:**
```typescript
const cache = getUnifiedCache(this.context);

const result = await cache.get(
  CacheType.SOURCE,
  [gitlabInstance, projectPath, filePath],
  () => this.httpClient.getFileContent(...),
  undefined,
  { allowStale: true }
);

return result.data;
```

### Step 5: Replace componentCache Usage

**Before:**
```typescript
const key = `${gitlabInstance}|${sourcePath}|${componentName}|${version}`;

if (this.componentCache.has(key)) {
  return this.componentCache.get(key)!;
}

const component = await this.fetchComponent(...);
this.componentCache.set(key, component);
return component;
```

**After:**
```typescript
const cache = getUnifiedCache(this.context);

const result = await cache.get(
  CacheType.COMPONENT,
  [gitlabInstance, sourcePath, componentName, version],
  () => this.fetchComponent(...)
);

return result.data;
```

### Step 6: Replace catalogCache Usage

**Before:**
```typescript
const key = `${gitlabInstance}|${projectPath}`;

if (this.catalogCache.has(key)) {
  const cached = this.catalogCache.get(key);
  if (Date.now() - cached.timestamp < DEFAULT_CACHE_TIME_SECONDS * 1000) {
    return cached.data;
  }
}

const catalog = await this.fetchCatalog(...);
this.catalogCache.set(key, { data: catalog, timestamp: Date.now() });
return catalog;
```

**After:**
```typescript
const cache = getUnifiedCache(this.context);

const result = await cache.get(
  CacheType.CATALOG,
  [gitlabInstance, projectPath],
  () => this.fetchCatalog(...)
);

return result.data;
```

## Phase 2: componentCacheManager.ts

### Step 1: Add Import

```typescript
// Add at top of file
import { getUnifiedCache, CacheType } from './cache';
import { DEFAULT_VERSION_CACHE_TIME_SECONDS } from '../constants/timing';
```

### Step 2: Remove Old Cache Declaration

**Remove:**
```typescript
// Line 30
private projectVersionsCache: Map<string, string[]> = new Map();
```

### Step 3: Update Constructor

Ensure the constructor stores the context:

```typescript
constructor(context?: vscode.ExtensionContext) {
  this.logger.debug('[ComponentCache] Constructor called', 'ComponentCache');
  this.context = context || null;
  // ... rest of constructor
}
```

### Step 4: Replace projectVersionsCache Usage

**Before:**
```typescript
const key = `${gitlabInstance}|${sourcePath}`;

if (this.projectVersionsCache.has(key)) {
  return this.projectVersionsCache.get(key)!;
}

const versions = await this.fetchVersions(...);
this.projectVersionsCache.set(key, versions);
return versions;
```

**After:**
```typescript
const cache = getUnifiedCache(this.context);

const result = await cache.get(
  CacheType.PROJECT_VERSIONS,
  [gitlabInstance, sourcePath],
  () => this.fetchVersions(...),
  DEFAULT_VERSION_CACHE_TIME_SECONDS * 1000
);

return result.data;
```

### Step 5: Update Cache Clear Logic

**Before:**
```typescript
public clearCache(): void {
  this.components = [];
  this.lastRefreshTime = 0;
  this.projectVersionsCache.clear();
  // ... persistence code
}
```

**After:**
```typescript
public clearCache(): void {
  this.components = [];
  this.lastRefreshTime = 0;

  const cache = getUnifiedCache(this.context);
  cache.clear(); // Clears all cache types

  // ... persistence code
}
```

### Step 6: Update Invalidation on Config Change

**Before:**
```typescript
vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('gitlabComponentHelper.componentSources')) {
    this.projectVersionsCache.clear();
    this.forceRefresh();
  }
});
```

**After:**
```typescript
vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('gitlabComponentHelper.componentSources')) {
    const cache = getUnifiedCache(this.context);
    cache.clear(); // Or use invalidate for specific types
    this.forceRefresh();
  }
});
```

## Phase 3: Update Instantiation

### extension.ts (or main activation file)

**Before:**
```typescript
const componentService = new ComponentService();
const cacheManager = new ComponentCacheManager();
```

**After:**
```typescript
const componentService = new ComponentService(context);
const cacheManager = new ComponentCacheManager(context);
```

## Phase 4: Testing

### Update Test Files

Add this to test setup:

```typescript
import { resetUnifiedCache } from './services/cache';

beforeEach(() => {
  resetUnifiedCache(); // Reset singleton for test isolation
});
```

### Example Test

```typescript
describe('ComponentService with UnifiedCache', () => {
  let service: ComponentService;
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    resetUnifiedCache();

    mockContext = {
      globalState: {
        get: jest.fn().mockReturnValue(undefined),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    service = new ComponentService(mockContext);
  });

  it('should cache components', async () => {
    const fetchSpy = jest.spyOn(service, 'fetchComponent');

    await service.getComponent('gitlab.com', 'path', 'comp', '1.0.0');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await service.getComponent('gitlab.com', 'path', 'comp', '1.0.0');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Still 1 - cache hit
  });
});
```

## Phase 5: Verification Checklist

After migration, verify:

- [ ] All TypeScript compilation errors resolved
- [ ] No references to old cache Maps remain
- [ ] All cache operations use UnifiedCache
- [ ] Context is passed to constructors
- [ ] Tests are updated and passing
- [ ] Cache invalidation works on config change
- [ ] Cache persistence works across restarts
- [ ] Extension activates without errors
- [ ] Component fetching uses cache correctly
- [ ] Catalog loading uses cache correctly
- [ ] Version fetching uses cache correctly
- [ ] Source file fetching uses cache correctly

## Common Issues and Solutions

### Issue: "Cannot find name 'getUnifiedCache'"

**Solution:** Add import at top of file:
```typescript
import { getUnifiedCache, CacheType } from './cache';
```

### Issue: "Property 'context' does not exist"

**Solution:** Add context property to class:
```typescript
private context: vscode.ExtensionContext | undefined;

constructor(context?: vscode.ExtensionContext) {
  this.context = context;
}
```

### Issue: Cache not persisting across restarts

**Solution:** Ensure context is passed to getUnifiedCache:
```typescript
const cache = getUnifiedCache(this.context); // Not undefined
```

### Issue: Tests failing with cache state

**Solution:** Reset cache before each test:
```typescript
import { resetUnifiedCache } from './services/cache';

beforeEach(() => {
  resetUnifiedCache();
});
```

## Search and Replace Patterns

### Pattern 1: Simple Map.has() + Map.get()

**Search:**
```regex
if \(this\.(\w+Cache)\.has\((\w+)\)\) \{\s*return this\.\1\.get\(\2\)!?;
```

**Replace with cache.get() call**

### Pattern 2: Map.set() after fetch

**Search:**
```regex
this\.(\w+Cache)\.set\((\w+), (\w+)\);
```

**Replace with cache.get() with fetcher**

### Pattern 3: Cache with timestamp

**Search:**
```regex
timestamp: Date\.now\(\)
```

**Delete** (handled automatically by UnifiedCache)

## Rollback Plan

If issues arise:

1. **Keep old code in comments temporarily:**
```typescript
// OLD: const key = `${instance}|${path}`;
// OLD: if (this.componentCache.has(key)) { ... }

// NEW:
const result = await cache.get(...);
```

2. **Create feature flag:**
```typescript
const USE_UNIFIED_CACHE = true; // Set to false to rollback

if (USE_UNIFIED_CACHE) {
  const result = await cache.get(...);
} else {
  // Old cache logic
}
```

3. **Keep old Map declarations:**
```typescript
// Remove after confirming migration works
// private componentCache = new Map<string, Component>();
```

## Performance Comparison

After migration, monitor:

1. **Memory usage** (should be similar or better)
2. **Cache hit rate** (use `cache.getStats()`)
3. **Response times** (should be same or faster)
4. **Persistence overhead** (minimal, async)

```typescript
// Add monitoring
setInterval(() => {
  const stats = cache.getStats();
  logger.debug(`Cache stats: ${stats.totalEntries} entries, ${stats.hitRate * 100}% hit rate`);
}, 60000);
```

## Migration Timeline Estimate

- Phase 1 (componentService.ts): 30-45 minutes
- Phase 2 (componentCacheManager.ts): 20-30 minutes
- Phase 3 (instantiation updates): 10 minutes
- Phase 4 (testing): 30 minutes
- Phase 5 (verification): 20 minutes

**Total estimated time: 2-3 hours**

## Support

For questions or issues during migration:
1. Check EXAMPLES.md for usage patterns
2. Check README.md for detailed API documentation
3. Run `cache.getStats()` to debug cache behavior
4. Use `resetUnifiedCache()` if singleton state is problematic
