# Type Definitions Reference

This document provides a comprehensive guide to the type definitions in the GitLab Component Helper extension and shows how to replace `any` types with proper TypeScript types.

## Table of Contents

1. [Cache Types](#cache-types)
2. [API Types](#api-types)
3. [Component Types](#component-types)
4. [Migration Guide](#migration-guide)

## Cache Types

Located in `src/types/cache.ts`

### CacheEntry<T>

Generic cache entry with timestamp for expiration tracking.

```typescript
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
```

**Usage:**
```typescript
const cache = new Map<string, CacheEntry<Component>>();
```

### CatalogCacheEntry

Cache entry for GitLab catalog data containing multiple components.

```typescript
interface CatalogCacheEntry {
  components: Array<{
    name: string;
    description?: string;
    variables?: ComponentVariable[];
    latest_version?: string;
  }>;
}
```

**Replaces:** `catalogCache: Map<string, any>`

**Usage:**
```typescript
private catalogCache = new Map<string, CatalogCacheEntry>();
```

### ComponentCacheEntry

Cache entry for individual component data.

**Replaces:** `componentCache: Map<string, any>`

**Usage:**
```typescript
private componentCache = new Map<string, ComponentCacheEntry>();
```

### ProjectVersionsCacheEntry

Cache entry for project versions (tags and branches).

```typescript
interface ProjectVersionsCacheEntry {
  versions: string[];
  timestamp: number;
}
```

### CachedComponent

Complete cached component with all metadata.

**Usage in ComponentCacheManager:**
```typescript
private components: CachedComponent[] = [];
```

### PersistentCacheData

Structure for cache data persisted to VS Code global state.

```typescript
interface PersistentCacheData {
  components: CachedComponent[];
  lastRefreshTime: number;
  projectVersionsCache: Array<[string, string[]]>;
  version: string;
}
```

## API Types

Located in `src/types/api.ts`

### GitLabProjectInfo

Complete project information from GitLab API.

**Replaces:** `projectInfo: any` in componentService.ts

**Usage:**
```typescript
const projectInfo: GitLabProjectInfo = await this.httpClient.fetchJson(projectApiUrl);
```

**Key Fields:**
- `id: number` - Project ID
- `name: string` - Project name
- `path_with_namespace: string` - Full path (group/project)
- `description: string` - Project description
- `default_branch: string` - Default branch name

### GitLabTreeItem

Repository tree item from GitLab API.

**Already defined in componentService.ts, should be moved to api.ts**

**Usage:**
```typescript
const templates: GitLabTreeItem[] = await this.httpClient.fetchJson(treeUrl);
const yamlFiles = templates.filter(file =>
  file.name.endsWith('.yml') || file.name.endsWith('.yaml')
);
```

### GitLabTag

Tag information from GitLab repository.

**Usage:**
```typescript
const tags: GitLabTag[] = await this.httpClient.fetchJson(tagsUrl);
const tagNames = tags.map(tag => tag.name);
```

### GitLabBranch

Branch information from GitLab repository.

**Usage:**
```typescript
const branches: GitLabBranch[] = await this.httpClient.fetchJson(branchesUrl);
const branchNames = branches.map(branch => branch.name);
```

### ComponentSource

Component source configuration from VS Code settings.

**Usage:**
```typescript
const sources: ComponentSource[] = config.get('componentSources', []);
```

### ComponentVariable

Component variable/parameter definition.

**Already exists as interface in componentService.ts**

**Usage:**
```typescript
const variables: ComponentVariable[] = [
  {
    name: 'environment',
    description: 'Target environment',
    required: true,
    type: 'string'
  }
];
```

### TemplateFetchResult

Result of fetching and parsing a template.

**Usage:**
```typescript
const templateResult: TemplateFetchResult = await this.fetchTemplate(
  apiBaseUrl,
  projectId,
  componentName,
  version
);
```

### TemplateContentResult

Result of fetching template content with validation.

**Usage:**
```typescript
const result: TemplateContentResult = await this.fetchTemplateContent(
  apiBaseUrl,
  projectId,
  fileName,
  ref
);

if (result.isValidComponent) {
  // Process the component
}
```

### ParsedComponentUrl

Parsed structure of a component URL.

**Usage:**
```typescript
const parsed: ParsedComponentUrl | null = this.parseCustomComponentUrl(url);
if (parsed) {
  const { gitlabInstance, path, name, version } = parsed;
}
```

### HttpRequestOptions

Options for HTTP requests.

**Usage:**
```typescript
const options: HttpRequestOptions = {
  headers: { 'PRIVATE-TOKEN': token },
  timeout: 10000,
  retryAttempts: 3
};
```

### CacheStats

Cache statistics for monitoring.

**Usage:**
```typescript
public getCacheStats(): CacheStats {
  return {
    catalogCacheSize: this.catalogCache.size,
    componentCacheSize: this.componentCache.size,
    sourceCacheSize: sourceCache.size,
    catalogKeys: Array.from(this.catalogCache.keys()),
    componentKeys: Array.from(this.componentCache.keys()),
    sourceKeys: Array.from(sourceCache.keys())
  };
}
```

## Component Types

Located in `src/types/git-component.ts` and `src/types/gitlab-catalog.ts`

### Component

Main component interface (already defined).

### GitLabCatalogComponent

Component from GitLab CI/CD Catalog API (already defined).

### GitLabCatalogData

Response from GitLab Catalog API (already defined).

## Migration Guide

### Before (Using `any`)

```typescript
// componentService.ts
private catalogCache = new Map<string, any>();
private componentCache = new Map<string, Component>();

async fetchCatalogData(gitlabInstance: string, projectPath: string): Promise<any> {
  const cacheKey = `catalog:${gitlabInstance}:${projectPath}`;

  if (this.catalogCache.has(cacheKey)) {
    return this.catalogCache.get(cacheKey);
  }

  // ... fetch logic
}

// componentCacheManager.ts
private projectVersionsCache: Map<string, string[]> = new Map();

const cacheData = this.context.globalState.get<any>('componentCache');
```

### After (Using Proper Types)

```typescript
// componentService.ts
import { CatalogCacheEntry, GitLabProjectInfo, GitLabTreeItem } from '../types';

private catalogCache = new Map<string, CatalogCacheEntry>();
private componentCache = new Map<string, Component>();

async fetchCatalogData(
  gitlabInstance: string,
  projectPath: string
): Promise<CatalogCacheEntry> {
  const cacheKey = `catalog:${gitlabInstance}:${projectPath}`;

  const cached = this.catalogCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // ... fetch logic
}

// In parallel fetching
const [projectInfo, templates] = await Promise.all([
  this.httpClient.fetchJson<GitLabProjectInfo>(projectApiUrl),
  this.httpClient.fetchJson<GitLabTreeItem[]>(templatesUrl)
]);

// componentCacheManager.ts
import { PersistentCacheData, ProjectVersionsCacheEntry } from '../types';

private projectVersionsCache = new Map<string, ProjectVersionsCacheEntry>();

const cacheData = this.context.globalState.get<PersistentCacheData>('componentCache');
if (cacheData && cacheData.components && Array.isArray(cacheData.components)) {
  this.components = cacheData.components;
  this.lastRefreshTime = cacheData.lastRefreshTime || 0;
}
```

## Type Usage Summary

### Files That Need Updates

1. **src/services/componentService.ts**
   - Replace `catalogCache: Map<string, any>` with `Map<string, CatalogCacheEntry>`
   - Replace `projectInfo: any` with `GitLabProjectInfo`
   - Replace `templates: any` with `GitLabTreeItem[]`
   - Add types to fetchJson/fetchText calls

2. **src/services/componentCacheManager.ts**
   - Replace `cacheData: any` with `PersistentCacheData`
   - Add type to globalState.get() calls
   - Use `ComponentSource` for source configuration

3. **src/utils/httpClient.ts**
   - Make fetchJson generic: `fetchJson<T>(url: string): Promise<T>`
   - Update return types from `any` to proper types

## Best Practices

1. **Always import from the index**:
   ```typescript
   import { GitLabProjectInfo, CachedComponent } from '../types';
   ```

2. **Use type parameters for generic functions**:
   ```typescript
   async fetchJson<T>(url: string): Promise<T>
   ```

3. **Avoid `any` for known structures**:
   - Use specific interfaces for API responses
   - Use union types for variable values
   - Use `unknown` if truly dynamic, then narrow with type guards

4. **Document complex types**:
   - Add JSDoc comments explaining usage
   - Include examples in comments
   - Note which API endpoints return which types

## Future Improvements

1. Add discriminated unions for different cache entry types
2. Create type guards for runtime type checking
3. Add Zod schemas for API response validation
4. Generate types from OpenAPI/Swagger specs
