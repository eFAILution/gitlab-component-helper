# Architecture Documentation

**Version:** 1.0 (Proposed)
**Status:** 🎯 Target Architecture

---

## Overview

This document describes the target architecture after completing all improvements outlined in [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md).

---

## Directory Structure

```
src/
├── constants/              # Configuration constants
│   ├── timing.ts          # Delay/timeout constants
│   ├── api.ts             # API configuration
│   ├── regex.ts           # Regex patterns
│   └── cache.ts           # Cache configuration
│
├── core/                   # Core framework setup
│   └── container.ts       # Dependency injection container
│
├── parsers/                # Data parsing modules
│   ├── specParser.ts      # GitLab CI/CD spec parsing (SINGLE SOURCE)
│   └── yamlParser.ts      # General YAML parsing
│
├── providers/              # VS Code language providers
│   ├── componentBrowserProvider.ts  # Component browser UI
│   ├── hoverProvider.ts             # Hover information
│   ├── completionProvider.ts        # Auto-completion
│   ├── validationProvider.ts        # YAML validation
│   └── componentDetector.ts         # Component detection
│
├── services/               # Business logic
│   ├── cache/             # Caching system (UNIFIED)
│   │   ├── unifiedCache.ts        # Single cache implementation
│   │   └── cacheTypes.ts          # Cache type definitions
│   │
│   └── component/         # Component management
│       ├── componentService.ts    # Main orchestrator (<200 lines)
│       ├── componentFetcher.ts    # HTTP operations
│       ├── versionManager.ts      # Version handling
│       ├── tokenManager.ts        # Token storage/retrieval
│       └── urlParser.ts           # URL parsing utilities
│
├── templates/              # HTML template generation
│   ├── detachedComponent.ts       # Detached view template
│   ├── componentBrowser.ts        # Browser template
│   ├── loadingView.ts             # Loading state
│   ├── errorView.ts               # Error display
│   └── helpers/
│       ├── htmlBuilder.ts         # HTML construction helper
│       └── styleBuilder.ts        # CSS style helper
│
├── types/                  # TypeScript definitions
│   ├── cache.ts           # Cache-related types
│   ├── api.ts             # API response types
│   ├── component.ts       # Component types
│   └── gitlab-catalog.ts  # GitLab catalog types
│
├── utils/                  # Utility functions
│   ├── httpClient.ts              # HTTP client with retry
│   ├── requestDeduplicator.ts     # Request deduplication
│   ├── performanceMonitor.ts      # Performance tracking
│   ├── logger.ts                  # Logging utility
│   ├── outputChannel.ts           # VS Code output
│   └── gitlabVariables.ts         # GitLab variable expansion
│
└── extension.ts            # Extension entry point (<300 lines)
```

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      VS Code Extension                       │
│                      (extension.ts)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Registers & Orchestrates
                       │
        ┌──────────────┼──────────────┬──────────────┐
        │              │              │              │
        ▼              ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│   Providers  │ │ Services │ │Templates │ │   Parsers    │
│              │ │          │ │          │ │              │
│ • Hover      │ │ • Cache  │ │ • HTML   │ │ • Spec       │
│ • Completion │ │ • Fetch  │ │ • Styles │ │ • YAML       │
│ • Validation │ │ • Version│ │          │ │              │
│ • Browser    │ │ • Token  │ │          │ │              │
└──────┬───────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘
       │              │            │              │
       └──────────────┴────────────┴──────────────┘
                       │
                       │ Uses
                       ▼
              ┌─────────────────┐
              │   Utilities      │
              │                  │
              │ • HTTP Client    │
              │ • Deduplicator   │
              │ • Logger         │
              │ • Perf Monitor   │
              └─────────────────┘
```

---

## Data Flow

### 1. Component Fetching Flow

```
User Action (Browse Components)
        │
        ▼
ComponentBrowserProvider
        │
        ├─→ ComponentCacheManager.getComponents()
        │         │
        │         ├─→ UnifiedCache.get('component', key)
        │         │         │
        │         │         ├─→ [Cache Hit] Return cached data
        │         │         │
        │         │         └─→ [Cache Miss]
        │         │                   │
        │         │                   ▼
        │         └─────→ ComponentService.fetchCatalogData()
        │                         │
        │                         ├─→ RequestDeduplicator.fetch()
        │                         │         │
        │                         │         └─→ HttpClient.fetchJson()
        │                         │                   │
        │                         │                   └─→ GitLab API
        │                         │
        │                         └─→ GitLabSpecParser.parse()
        │                                   │
        │                                   └─→ Extract parameters
        │
        └─→ DetachedComponentTemplate.render()
                  │
                  └─→ Display in WebView
```

### 2. Hover Information Flow

```
User Hovers Over Component
        │
        ▼
HoverProvider.provideHover()
        │
        ├─→ ComponentDetector.detectIncludeComponent()
        │         │
        │         └─→ Parse YAML, extract component URL
        │
        └─→ ComponentService.getComponentFromUrl()
                  │
                  ├─→ UnifiedCache.get('component', url)
                  │         │
                  │         ├─→ [Hit] Return cached component
                  │         │
                  │         └─→ [Miss] Fetch fresh data
                  │
                  └─→ ComponentHtmlRenderer.render()
                            │
                            └─→ Return Markdown hover
```

### 3. Cache Flow (Unified)

```
                    ┌─────────────────────────┐
                    │    UnifiedCache         │
                    │                         │
                    │  Map<string, CacheEntry>│
                    └────────┬────────────────┘
                             │
                  ┌──────────┼──────────┐
                  │          │          │
                  ▼          ▼          ▼
         ┌──────────┐  ┌──────────┐  ┌──────────┐
         │component:│  │catalog:  │  │versions: │
         │instance/ │  │instance/ │  │instance/ │
         │path/name │  │path      │  │path      │
         └──────────┘  └──────────┘  └──────────┘

All cache types use hierarchical keys:
- component:{instance}/{path}/{name}@{version}
- catalog:{instance}/{path}
- versions:{instance}/{path}

Benefits:
✓ Single source of truth
✓ Consistent TTL management
✓ Unified invalidation
✓ Better memory management
```

---

## Key Architectural Patterns

### 1. Dependency Injection (NEW)

**Before (Singletons everywhere):**
```typescript
const service = getComponentService();
const cache = getComponentCacheManager();
```

**After (DI Container):**
```typescript
const container = setupContainer(context);
const service = container.get<ComponentService>('componentService');
```

**Benefits:**
- Easier testing (mock dependencies)
- Loose coupling
- Clear dependencies
- Better composition

---

### 2. Single Responsibility Principle

**Before:**
```
componentService.ts (1194 lines)
├─ Fetching components
├─ Parsing specs
├─ Managing versions
├─ Token handling
├─ URL parsing
└─ Cache management
```

**After:**
```
component/
├─ componentService.ts (200 lines)   ← Orchestration only
├─ componentFetcher.ts               ← HTTP operations
├─ versionManager.ts                 ← Version logic
└─ tokenManager.ts                   ← Token storage

parsers/
└─ specParser.ts                     ← Parsing logic

cache/
└─ unifiedCache.ts                   ← Cache management
```

**Benefits:**
- Easier to understand
- Easier to test
- Easier to modify
- Better separation of concerns

---

### 3. Request Deduplication (NEW)

**Problem:**
Multiple identical API requests sent simultaneously.

**Solution:**
```typescript
// Automatic deduplication in HttpClient
async fetchJson(url: string): Promise<any> {
  return this.deduplicator.fetch(url, () => {
    return this.makeRequest(url);
  });
}
```

**Benefits:**
- Reduces API calls
- Faster responses
- Better resource usage

---

### 4. Unified Cache Architecture (NEW)

**Before (4 separate caches):**
```typescript
sourceCache: Map<string, CacheEntry>
catalogCache: Map<string, any>
componentCache: Map<string, Component>
projectVersionsCache: Map<string, string[]>
```

**After (Single unified cache):**
```typescript
UnifiedCache: Map<string, CacheEntry<T>>
  ├─ 'component:gitlab.com/group/project/component@v1'
  ├─ 'catalog:gitlab.com/group/project'
  └─ 'versions:gitlab.com/group/project'
```

**Benefits:**
- Single source of truth
- Consistent behavior
- Easier to debug
- Better memory management
- Automatic persistence

---

### 5. Lazy Loading (NEW)

**Before:**
```typescript
// Fetch ALL versions upfront
for (const component of components) {
  await fetchVersions(component);
}
```

**After:**
```typescript
// Fetch versions only when needed
onComponentExpand(component) {
  if (!component.versionsFetched) {
    fetchVersions(component);
  }
}
```

**Benefits:**
- Faster initial load
- Better perceived performance
- Reduces unnecessary API calls

---

## Performance Optimizations

### 1. Parallel HTTP Requests

**Pattern:**
```typescript
// ✅ Good - Parallel with graceful degradation
const [projectResult, templatesResult, tagsResult] = await Promise.allSettled([
  fetchProject(),
  fetchTemplates(),
  fetchTags()
]);

// Handle partial failures gracefully
const project = projectResult.status === 'fulfilled' ? projectResult.value : null;
```

### 2. Request Priority Queue (NEW)

```typescript
enum RequestPriority {
  HIGH = 0,    // User-initiated
  NORMAL = 1,  // Background loading
  LOW = 2      // Prefetching
}

// User clicks = HIGH priority
await queue.enqueue(() => fetchComponent(), RequestPriority.HIGH);

// Background refresh = LOW priority
await queue.enqueue(() => refreshCache(), RequestPriority.LOW);
```

### 3. Performance Monitoring (NEW)

```typescript
const perf = getPerformanceMonitor();

await perf.track('fetchComponent', async () => {
  return await fetchComponentMetadata(url);
}, { url });

// Automatic warnings for slow operations (>1s)
// Detailed statistics available via command
```

---

## Testing Strategy

### Unit Tests (>80% coverage target)

```
tests/unit/
├── parsers/
│   └── specParser.test.ts         # Test parsing logic
├── services/
│   ├── cache/
│   │   └── unifiedCache.test.ts   # Test cache operations
│   └── component/
│       └── componentFetcher.test.ts
├── utils/
│   ├── httpClient.test.ts
│   └── requestDeduplicator.test.ts
└── templates/
    └── detachedComponent.test.ts
```

### Integration Tests

```
tests/integration/
├── componentFetching.test.ts      # End-to-end fetch flow
├── cacheFlow.test.ts              # Cache + fetch integration
└── providerIntegration.test.ts   # Provider + service integration
```

### Performance Tests

```
tests/performance/
├── cachePerformance.test.ts       # Cache operations <10ms
├── fetchPerformance.test.ts       # API calls timing
└── extensionActivation.test.ts   # Activation <500ms
```

---

## Migration Path

### Phase 1: Foundation (Week 1)
1. Create constants
2. Add type definitions
3. Extract HTML templates
4. Add request deduplicator

### Phase 2: Core Refactoring (Week 2)
1. Create GitLabSpecParser (consolidate parsing)
2. Implement UnifiedCache
3. Migrate to unified cache
4. Add lazy loading

### Phase 3: Service Split (Week 3)
1. Split componentService.ts
2. Split componentCacheManager.ts
3. Implement DI container
4. Add performance monitoring

### Phase 4: Polish (Week 4)
1. Write tests (>80% coverage)
2. Update documentation
3. Performance benchmarking
4. Bug fixes and refinements

---

## Best Practices

### File Size Limits
- Maximum 300 lines per file
- Split if approaching 250 lines
- Use barrel exports for related modules

### Function Complexity
- Maximum 50 lines per function
- Maximum 3-4 parameters
- Single responsibility
- Early returns preferred

### Error Handling
- Use custom error types
- Provide context in error messages
- Log errors with appropriate level
- Fail gracefully with fallbacks

### Performance
- Track operations >100ms
- Warn on operations >1s
- Cache aggressively with proper TTL
- Batch operations where possible

---

## Monitoring & Debugging

### Built-in Commands

```
GitLab CI: Show Cache Status
  → View cache statistics

GitLab CI: Debug Cache (Detailed)
  → Detailed cache information

GitLab CI: Show Performance Stats (NEW)
  → Performance metrics and slowest operations

GitLab CI: Export Performance Metrics (NEW)
  → Export metrics for analysis
```

### Logging Levels

```typescript
Logger.getInstance().setLevel('DEBUG'); // Development
Logger.getInstance().setLevel('INFO');  // Production default
Logger.getInstance().setLevel('WARN');  // Minimal logging
Logger.getInstance().setLevel('ERROR'); // Errors only
```

### Cache Inspection

```typescript
const cache = getUnifiedCache();
const stats = cache.getStats();

console.log(stats);
// {
//   totalEntries: 42,
//   byType: {
//     component: 30,
//     catalog: 10,
//     versions: 2
//   },
//   memoryEstimate: "2.5 MB"
// }
```

---

## Future Enhancements

### Potential Improvements (Post-v1)

1. **WebSocket Support**
   - Real-time component updates
   - Live collaboration features

2. **Component Recommendations**
   - AI-powered component suggestions
   - Usage pattern analysis

3. **Advanced Caching**
   - Predictive prefetching
   - Smart cache warming

4. **Enhanced UI**
   - Native tree view provider
   - Drag-and-drop component insertion

5. **Analytics**
   - Component usage statistics
   - Performance tracking dashboard

---

## References

- [VS Code Extension API](https://code.visualstudio.com/api)
- [GitLab CI/CD Components](https://docs.gitlab.com/ee/ci/components/)
- [TypeScript Best Practices](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)

---

**Document Version:** 1.0
**Last Updated:** 2026-02-09
**Status:** 🎯 Target Architecture
