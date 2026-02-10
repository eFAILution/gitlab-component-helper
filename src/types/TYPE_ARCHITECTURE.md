# Type Architecture Overview

This document provides a visual overview of the type system architecture for the GitLab Component Helper extension.

## Type Hierarchy

```
src/types/
├── index.ts                 # Central export point
├── git-component.ts         # Core component types
├── gitlab-catalog.ts        # GitLab Catalog API types
├── cache.ts                 # Cache-related types
└── api.ts                   # GitLab API response types
```

## Type Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                    Component Types                          │
│  (git-component.ts)                                         │
├─────────────────────────────────────────────────────────────┤
│  • Component                                                │
│  • ComponentParameter                                       │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ used by
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Cache Types                              │
│  (cache.ts)                                                 │
├─────────────────────────────────────────────────────────────┤
│  • CacheEntry<T>                                            │
│  • ComponentCacheEntry          (stores Component)          │
│  • CatalogCacheEntry            (stores components array)   │
│  • CachedComponent              (extended Component)        │
│  • ProjectVersionsCacheEntry    (stores versions)           │
│  • PersistentCacheData          (global state storage)      │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ populated by
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Types                                │
│  (api.ts)                                                   │
├─────────────────────────────────────────────────────────────┤
│  • GitLabProjectInfo         (from /projects/:id)           │
│  • GitLabTreeItem            (from /repository/tree)        │
│  • GitLabTag                 (from /repository/tags)        │
│  • GitLabBranch              (from /repository/branches)    │
│  • ComponentSource           (from VS Code config)          │
│  • ComponentVariable         (parsed from templates)        │
│  • TemplateFetchResult       (template parsing result)      │
│  • HttpRequestOptions        (HTTP client config)           │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ used by
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 GitLab Catalog Types                        │
│  (gitlab-catalog.ts)                                        │
├─────────────────────────────────────────────────────────────┤
│  • GitLabCatalogData         (catalog API response)         │
│  • GitLabCatalogComponent    (catalog component)            │
│  • GitLabCatalogVariable     (catalog variable)             │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

```
┌──────────────────┐
│  VS Code Config  │
│  (settings.json) │
└────────┬─────────┘
         │ ComponentSource[]
         ▼
┌─────────────────────────────────────────────────┐
│         ComponentCacheManager                   │
│  - components: CachedComponent[]                │
│  - projectVersionsCache: Map<string, string[]>  │
│  - sourceErrors: Map<string, string>            │
└────────┬────────────────────────────────────────┘
         │
         │ fetch components
         ▼
┌─────────────────────────────────────────────────┐
│            ComponentService                     │
│  - catalogCache: Map<string, CatalogCacheEntry> │
│  - componentCache: Map<string, Component>       │
└────────┬────────────────────────────────────────┘
         │
         │ HTTP requests
         ▼
┌─────────────────────────────────────────────────┐
│              HttpClient                         │
│  - fetchJson<T>(): Promise<T>                   │
│  - fetchText(): Promise<string>                 │
└────────┬────────────────────────────────────────┘
         │
         │ API calls
         ▼
┌─────────────────────────────────────────────────┐
│           GitLab API                            │
│  /api/v4/projects/:id                           │
│  /api/v4/projects/:id/repository/tree           │
│  /api/v4/projects/:id/repository/tags           │
│  /api/v4/ci/catalog/:namespace                  │
└─────────────────────────────────────────────────┘
```

## Type Usage by File

### componentService.ts

**Before:**
```typescript
private catalogCache = new Map<string, any>();
async fetchCatalogData(...): Promise<any>
const projectInfo: any = await this.httpClient.fetchJson(url);
```

**After:**
```typescript
import { CatalogCacheEntry, GitLabProjectInfo, GitLabTreeItem } from '../types';

private catalogCache = new Map<string, CatalogCacheEntry>();
async fetchCatalogData(...): Promise<CatalogCacheEntry>
const projectInfo: GitLabProjectInfo = await this.httpClient.fetchJson(url);
```

### componentCacheManager.ts

**Before:**
```typescript
const cacheData = this.context.globalState.get<any>('componentCache');
```

**After:**
```typescript
import { PersistentCacheData, CachedComponent } from '../types';

const cacheData = this.context.globalState.get<PersistentCacheData>('componentCache');
```

### httpClient.ts

**Before:**
```typescript
async fetchJson(url: string): Promise<any>
```

**After:**
```typescript
async fetchJson<T = any>(url: string): Promise<T>
```

## Cache Strategy

```
┌─────────────────────────────────────────────────┐
│            Memory Caches                        │
├─────────────────────────────────────────────────┤
│                                                 │
│  ComponentService                               │
│  ├─ catalogCache                                │
│  │  Key: "catalog:instance:path"               │
│  │  Value: CatalogCacheEntry                   │
│  │                                              │
│  └─ componentCache                              │
│     Key: component URL                          │
│     Value: Component                            │
│                                                 │
│  ComponentCacheManager                          │
│  ├─ components: CachedComponent[]              │
│  │  (All components from all sources)          │
│  │                                              │
│  └─ projectVersionsCache                        │
│     Key: "instance|path"                        │
│     Value: string[] (versions)                  │
│                                                 │
└─────────────────────────────────────────────────┘
                    │
                    │ persist
                    ▼
┌─────────────────────────────────────────────────┐
│        Persistent Storage                       │
│     (VS Code Global State)                      │
├─────────────────────────────────────────────────┤
│                                                 │
│  PersistentCacheData                            │
│  ├─ components: CachedComponent[]              │
│  ├─ lastRefreshTime: number                    │
│  ├─ projectVersionsCache: [string, string[]][] │
│  └─ version: string                            │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Type Guards (Recommended Addition)

To improve type safety, consider adding type guards:

```typescript
// src/types/guards.ts

export function isGitLabProjectInfo(obj: any): obj is GitLabProjectInfo {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'number' &&
    typeof obj.name === 'string' &&
    typeof obj.path_with_namespace === 'string'
  );
}

export function isCatalogCacheEntry(obj: any): obj is CatalogCacheEntry {
  return (
    typeof obj === 'object' &&
    Array.isArray(obj.components)
  );
}

export function isCachedComponent(obj: any): obj is CachedComponent {
  return (
    typeof obj === 'object' &&
    typeof obj.name === 'string' &&
    typeof obj.sourcePath === 'string' &&
    typeof obj.gitlabInstance === 'string'
  );
}
```

## API Response Examples

### GitLabProjectInfo Response

```json
{
  "id": 123,
  "name": "my-project",
  "path": "my-project",
  "path_with_namespace": "group/my-project",
  "description": "Project description",
  "default_branch": "main",
  "web_url": "https://gitlab.com/group/my-project",
  "namespace": {
    "id": 456,
    "name": "group",
    "path": "group",
    "kind": "group"
  }
}
```

### CatalogCacheEntry Structure

```json
{
  "components": [
    {
      "name": "deploy-component",
      "description": "Deploys the application",
      "variables": [
        {
          "name": "environment",
          "description": "Target environment",
          "required": true,
          "type": "string"
        }
      ],
      "latest_version": "v1.0.0"
    }
  ]
}
```

### PersistentCacheData Structure

```json
{
  "components": [
    {
      "name": "deploy-component",
      "description": "Deploys the application",
      "parameters": [...],
      "source": "Components Source",
      "sourcePath": "group/project",
      "gitlabInstance": "gitlab.com",
      "version": "v1.0.0",
      "url": "https://gitlab.com/group/project/deploy-component@v1.0.0",
      "availableVersions": ["v1.0.0", "v0.9.0", "main"]
    }
  ],
  "lastRefreshTime": 1707516000000,
  "projectVersionsCache": [
    ["gitlab.com|group/project", ["v1.0.0", "v0.9.0", "main"]]
  ],
  "version": "1.0.0"
}
```

## Migration Checklist

- [ ] Update componentService.ts imports
- [ ] Replace `catalogCache: Map<string, any>` with proper type
- [ ] Replace `componentCache` with proper type
- [ ] Add types to all fetchJson calls
- [ ] Update componentCacheManager.ts imports
- [ ] Replace globalState.get\<any\> calls
- [ ] Update httpClient.ts to use generics
- [ ] Add type parameters to all HTTP calls
- [ ] Consider adding type guards for runtime validation
- [ ] Update tests to use new types
- [ ] Run TypeScript compiler to catch any issues
- [ ] Test cache persistence with new types

## Benefits of Type Safety

1. **Compile-time Errors**: Catch bugs before runtime
2. **Better IDE Support**: Autocomplete, hover documentation, refactoring
3. **Self-documenting Code**: Types serve as inline documentation
4. **Easier Refactoring**: TypeScript tracks all usages
5. **Reduced Testing Burden**: Many errors caught by compiler
6. **Better Collaboration**: Clear contracts between modules
