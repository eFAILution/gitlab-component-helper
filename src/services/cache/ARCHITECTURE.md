# Cache Module Architecture

## Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                     External Consumers                           │
│  (extension.ts, completionProvider.ts, etc.)                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ getComponentCacheManager()
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              ComponentCacheManager (Orchestrator)                │
│                         806 lines                                │
│                                                                   │
│  • Component lifecycle management                                │
│  • Refresh scheduling and expiration                             │
│  • Persistence to VS Code global state                           │
│  • Source error tracking                                         │
│  • Singleton pattern                                             │
└─────────┬───────────────────┬───────────────────┬───────────────┘
          │                   │                   │
          │ uses              │ uses              │ uses
          ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  ProjectCache    │ │  VersionCache    │ │   GroupCache     │
│    180 lines     │ │    166 lines     │ │    195 lines     │
│                  │ │                  │ │                  │
│ • Fetch from     │ │ • Version fetch  │ │ • Group scan     │
│   projects       │ │ • Version cache  │ │ • Batch process  │
│ • Transform data │ │ • Semver sort    │ │ • Error handling │
└──────────────────┘ └──────────────────┘ └────────┬─────────┘
                                                     │
                                                     │ delegates to
                                                     ▼
                                           ┌──────────────────┐
                                           │  ProjectCache    │
                                           │  (for each proj) │
                                           └──────────────────┘
```

## Data Flow

### 1. Component Refresh Flow
```
User/Timer Trigger
       │
       ▼
ComponentCacheManager.refreshComponents()
       │
       ├─→ ProjectCache.fetchComponentsFromProject()  (for project sources)
       │   └─→ ComponentService.fetchCatalogData()
       │       └─→ Returns CachedComponent[]
       │
       ├─→ GroupCache.fetchComponentsFromGroup()      (for group sources)
       │   └─→ GroupCache.fetchGroupProjects()
       │       └─→ For each project:
       │           └─→ ProjectCache.fetchComponentsFromProject()
       │
       └─→ Merge all results
           └─→ Save to global state
```

### 2. Version Fetch Flow
```
ComponentCacheManager.fetchComponentVersions(component)
       │
       ▼
VersionCache.fetchComponentVersions(component)
       │
       ├─→ Check cache: projectVersionsCache.get(key)
       │   ├─→ HIT: Return cached versions
       │   └─→ MISS: Fetch from API
       │       └─→ ComponentService.fetchProjectTags()
       │           └─→ Sort versions by priority
       │               └─→ Cache and return
       │
       └─→ Update component.availableVersions
           └─→ Save to global state
```

### 3. Specific Version Fetch Flow
```
ComponentCacheManager.fetchSpecificVersion(name, path, instance, version)
       │
       ├─→ Check if already cached
       │   └─→ HIT: Return existing component
       │
       └─→ MISS: Delegate to ProjectCache
           └─→ ProjectCache.fetchSpecificVersion()
               ├─→ Validate version exists
               ├─→ Fetch catalog data for version
               ├─→ Transform to CachedComponent
               └─→ Return to ComponentCacheManager
                   └─→ Add to components array
```

## Module Interfaces

### ComponentCacheManager
```typescript
class ComponentCacheManager {
  // Public API
  async getComponents(): Promise<CachedComponent[]>
  async refreshComponents(): Promise<void>
  async forceRefresh(): Promise<void>
  addDynamicComponent(component: {...}): void
  addComponentToCache(component: CachedComponent): void
  async fetchComponentVersions(component: CachedComponent): Promise<string[]>
  async fetchSpecificVersion(name, path, instance, version): Promise<CachedComponent | null>

  // Cache management
  async updateCache(): Promise<void>
  async resetCache(): Promise<void>
  getCacheStats(): {...}
  getSourceErrors(): Map<string, string>
  hasErrors(): boolean

  // Context management
  setContext(context: vscode.ExtensionContext): void
  getCacheInfo(): {...}

  // Private helpers
  private async initializeCache(): Promise<void>
  private async refreshVersions(): Promise<void>
  private shouldRefreshVersions(): boolean
  private async loadCacheFromDisk(): Promise<void>
  private async saveCacheToDisk(): Promise<void>
  private getLocalFallbackComponents(): CachedComponent[]
}

// Singleton access
function getComponentCacheManager(context?: vscode.ExtensionContext): ComponentCacheManager
```

### ProjectCache
```typescript
class ProjectCache {
  async fetchComponentsFromProject(
    gitlabInstance: string,
    projectPath: string,
    sourceName: string
  ): Promise<CachedComponent[]>

  async fetchSpecificVersion(
    componentName: string,
    sourcePath: string,
    gitlabInstance: string,
    version: string
  ): Promise<CachedComponent | null>
}
```

### VersionCache
```typescript
class VersionCache {
  async fetchComponentVersions(component: CachedComponent): Promise<string[]>
  sortVersionsByPriority(versions: string[]): string[]
  clearCache(): void
  getCachedVersions(gitlabInstance: string, sourcePath: string): string[] | undefined
  serializeCache(): Array<[string, string[]]>
  deserializeCache(data: Array<[string, string[]]>): void
  getCacheStats(): { count: number; keys: string[] }
}
```

### GroupCache
```typescript
class GroupCache {
  constructor(projectCache: ProjectCache)

  async fetchComponentsFromGroup(
    gitlabInstance: string,
    groupPath: string,
    sourceName: string
  ): Promise<CachedComponent[]>

  async fetchGroupProjects(
    gitlabInstance: string,
    groupPath: string
  ): Promise<any[]>
}
```

## Cache Keys and Storage

### ComponentCacheManager
- **Storage:** VS Code Global State (`componentCache` key)
- **Format:** PersistentCacheData
  ```typescript
  {
    components: CachedComponent[],
    lastRefreshTime: number,
    projectVersionsCache: Array<[string, string[]]>,
    version: string
  }
  ```

### VersionCache
- **Storage:** In-memory Map (persisted via ComponentCacheManager)
- **Key format:** `${gitlabInstance}|${sourcePath}`
- **Value:** `string[]` (sorted versions)

### Cache Timing
- **Component cache:** 1 hour default (configurable: `cacheTime`)
- **Version cache:** 4× component cache time (4 hours default)
- **Force refresh:** Available via `forceRefresh()` or config change

## Error Handling Strategy

### ComponentCacheManager
- **Source errors:** Tracked in `sourceErrors` Map
- **Continues on error:** Other sources still processed
- **Graceful degradation:** Uses local fallback if all sources fail

### GroupCache
- **Batch processing:** 5 projects at a time (configurable)
- **Promise.allSettled:** Handles individual project failures
- **Logging:** Detailed progress and error logging
- **Continues on error:** Partial success is acceptable

### ProjectCache
- **Throws errors:** Propagates to caller for proper error tracking
- **No silent failures:** Errors logged and tracked

### VersionCache
- **Fallback:** Returns current version on error
- **Caching:** Reduces API calls even on partial failures

## Configuration Sources

### Component Sources
```typescript
type ComponentSource = {
  name: string;
  path: string;
  gitlabInstance?: string;  // Default: 'gitlab.com'
  type?: 'project' | 'group'; // Default: 'project'
}
```

### Processing Logic
1. **project type:** `ProjectCache.fetchComponentsFromProject()`
2. **group type:** `GroupCache.fetchComponentsFromGroup()`
   - Fetches all projects in group
   - Delegates each to `ProjectCache.fetchComponentsFromProject()`

## Thread Safety and Concurrency

### Refresh Lock
- `refreshInProgress` flag prevents concurrent refreshes
- Early return if refresh already in progress
- No race conditions on component array updates

### Version Cache
- Single-threaded access (JavaScript event loop)
- No explicit locking needed
- Cache key uniqueness prevents collisions

### Batch Processing
- Groups projects into batches (default 5)
- Parallel processing within batch
- Sequential batch execution to avoid API overwhelming

## Testing Strategy

### Unit Tests (Recommended)
1. **VersionCache.sortVersionsByPriority()** - version sorting logic
2. **ProjectCache data transformation** - catalog to CachedComponent
3. **GroupCache batch processing** - error handling and progress
4. **ComponentCacheManager lifecycle** - refresh, expiration, persistence

### Integration Tests (Recommended)
1. **Full refresh cycle** - from config to cached components
2. **Group scanning** - multi-project scenarios
3. **Version fetching** - caching and fallback behavior
4. **Persistence** - save/load from global state

### Mocking Strategy
- Mock `ComponentService` for API calls
- Mock `vscode.ExtensionContext` for global state
- Mock `Logger` for output verification

## Migration Checklist

✅ Module files created:
  - componentCacheManager.ts (806 lines)
  - projectCache.ts (180 lines)
  - versionCache.ts (166 lines)
  - groupCache.ts (195 lines)

✅ Original file backed up:
  - componentCacheManager.ts.backup (865 lines)

✅ Imports updated in:
  - extension.ts
  - completionProvider.ts
  - componentBrowserProvider.ts
  - componentDetector.ts
  - validationProvider.ts

✅ Barrel exports added to index.ts

✅ TypeScript compilation successful (no cache errors)

✅ Backward compatibility maintained:
  - getComponentCacheManager() singleton
  - All public APIs unchanged
  - Same data structures

## Performance Characteristics

### Memory Usage
- **Component array:** ~1-2KB per component × N components
- **Version cache:** ~1KB per project × N projects
- **Source errors:** Minimal (only error strings)

### API Calls
- **Component refresh:** 1 call per project source
- **Group refresh:** 1 call for group + 1 per project
- **Version fetch:** 1 call per project (cached)
- **Batch size:** Limits concurrent API calls to 5

### Persistence
- **Auto-save:** After every refresh and version update
- **Load on startup:** Automatic from global state
- **Version check:** Ensures compatibility

## Future Enhancements

### Recommended Improvements
1. **Use UnifiedCache for VersionCache** - Leverage existing infrastructure
2. **Configurable batch size** - Make group scanning more flexible
3. **Progress notifications** - Show progress for long-running group scans
4. **Parallel group scanning** - Scan multiple groups concurrently
5. **Cache warming** - Pre-fetch popular components
6. **Smart refresh** - Only refresh stale sources
7. **Metrics collection** - Track cache hit rates and API call counts

### Breaking Changes to Avoid
- Keep singleton pattern
- Maintain public API signatures
- Preserve data structures in global state
- Keep backward compatibility with old cache format
