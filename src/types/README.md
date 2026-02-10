# Type Definitions for GitLab Component Helper

This directory contains all TypeScript type definitions for the GitLab Component Helper VS Code extension.

## 📁 Files

- **index.ts** - Central export point for all types
- **git-component.ts** - Core component types (Component, ComponentParameter)
- **gitlab-catalog.ts** - GitLab CI/CD Catalog API types
- **cache.ts** - Cache-related types (CacheEntry, CachedComponent, etc.)
- **api.ts** - GitLab API response types (ProjectInfo, TreeItem, Tag, Branch, etc.)

## 📚 Documentation

- **TYPE_REFERENCE.md** - Comprehensive type reference with usage examples
- **TYPE_ARCHITECTURE.md** - Visual overview of type system architecture
- **MIGRATION_EXAMPLE.md** - Step-by-step migration from `any` to proper types
- **README.md** - This file

## 🚀 Quick Start

### Importing Types

Always import from the central index file:

```typescript
import {
  Component,
  GitLabProjectInfo,
  CatalogCacheEntry,
  CachedComponent
} from '../types';
```

### Common Patterns

#### 1. Cache with Proper Types

```typescript
import { CatalogCacheEntry } from '../types';

private catalogCache = new Map<string, CatalogCacheEntry>();
```

#### 2. API Calls with Type Parameters

```typescript
import { GitLabProjectInfo } from '../types';

const project = await httpClient.fetchJson<GitLabProjectInfo>(projectUrl);
```

#### 3. Component Storage

```typescript
import { CachedComponent } from '../types';

private components: CachedComponent[] = [];
```

## 📋 Type Categories

### Component Types
```typescript
Component              // Core component structure
ComponentParameter     // Component input parameter
```

### GitLab Catalog Types
```typescript
GitLabCatalogData      // Full catalog API response
GitLabCatalogComponent // Individual catalog component
GitLabCatalogVariable  // Catalog component variable
```

### Cache Types
```typescript
CacheEntry<T>              // Generic cache entry with timestamp
CatalogCacheEntry          // Catalog data cache
ComponentCacheEntry        // Single component cache
CachedComponent            // Fully cached component with metadata
ProjectVersionsCacheEntry  // Project versions cache
PersistentCacheData        // Global state storage format
```

### API Types
```typescript
GitLabProjectInfo      // Project information from API
GitLabTreeItem         // Repository tree item
GitLabTag              // Git tag information
GitLabBranch           // Git branch information
ComponentSource        // Component source configuration
ComponentVariable      // Template variable definition
TemplateFetchResult    // Template parsing result
HttpRequestOptions     // HTTP client options
```

## 🔄 Migration Status

### ✅ Completed
- Created comprehensive type definitions
- Added documentation and examples
- Organized types by domain

### 📝 TODO (Next Steps)
- [ ] Update componentService.ts to use new types
- [ ] Update componentCacheManager.ts to use new types
- [ ] Update httpClient.ts to use generics
- [ ] Add type guards for runtime validation
- [ ] Update tests to use new types
- [ ] Run TypeScript compiler to validate
- [ ] Remove all remaining `any` types

## 🎯 Benefits

### Before (with `any`)
```typescript
const data = cache.get('key');  // What type is this?
console.log(data.anyField);     // No error, crashes at runtime!
```

### After (with proper types)
```typescript
const data = cache.get<CatalogCacheEntry>('key');
console.log(data.components);        // ✓ Type-safe
console.log(data.nonExistentField);  // ✗ Compile error!
```

**Key Benefits:**
- 🐛 Catch bugs at compile time
- 🔍 Better IDE autocomplete
- 📖 Self-documenting code
- 🔧 Easier refactoring
- ✨ Better developer experience

## 📖 Where to Start

1. **Understanding the types**: Read `TYPE_REFERENCE.md`
2. **See the big picture**: Read `TYPE_ARCHITECTURE.md`
3. **Learn by example**: Read `MIGRATION_EXAMPLE.md`
4. **Start migrating**: Update imports and add type parameters

## 🏗️ Architecture Overview

```
Types
  ├── Component Types (git-component.ts)
  │   └── Core component structures
  │
  ├── GitLab Catalog Types (gitlab-catalog.ts)
  │   └── CI/CD Catalog API responses
  │
  ├── Cache Types (cache.ts)
  │   └── In-memory and persistent caching
  │
  └── API Types (api.ts)
      └── GitLab REST API responses

Used By
  ├── ComponentService
  │   ├── catalogCache: Map<string, CatalogCacheEntry>
  │   └── componentCache: Map<string, Component>
  │
  ├── ComponentCacheManager
  │   ├── components: CachedComponent[]
  │   └── projectVersionsCache: Map<string, ProjectVersionsCacheEntry>
  │
  └── HttpClient
      └── fetchJson<T>(): Promise<T>
```

## 🔗 References

- [TypeScript Handbook - Interfaces](https://www.typescriptlang.org/docs/handbook/interfaces.html)
- [TypeScript Handbook - Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [GitLab API Documentation](https://docs.gitlab.com/ee/api/)
- [VS Code Extension API - Secrets Storage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)

## 💡 Tips

1. **Always use the index**: Import from `'../types'`, not individual files
2. **Use generics**: `fetchJson<GitLabProjectInfo>(url)` for type safety
3. **Check the docs**: Read TYPE_REFERENCE.md for detailed examples
4. **Trust the compiler**: Red squiggles are your friends
5. **Start small**: Migrate one file at a time

## 🤝 Contributing

When adding new types:

1. Add the type to the appropriate file (cache.ts, api.ts, etc.)
2. Export from that file
3. Document with JSDoc comments
4. Add usage examples to TYPE_REFERENCE.md
5. Update this README if adding a new category

## ❓ Questions?

- See `TYPE_REFERENCE.md` for comprehensive documentation
- See `MIGRATION_EXAMPLE.md` for step-by-step migration guide
- See `TYPE_ARCHITECTURE.md` for visual diagrams and architecture

---

**Created:** 2026-02-09
**Last Updated:** 2026-02-09
**Version:** 1.0.0
