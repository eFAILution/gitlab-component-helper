# Type Migration Checklist

This checklist tracks the migration from `any` types to proper TypeScript types.

## ✅ Completed

- [x] Create comprehensive type definitions
  - [x] cache.ts - Cache-related types
  - [x] api.ts - GitLab API response types
  - [x] index.ts - Central export point
- [x] Create documentation
  - [x] README.md - Overview and quick start
  - [x] TYPE_REFERENCE.md - Comprehensive reference
  - [x] TYPE_ARCHITECTURE.md - Visual architecture
  - [x] MIGRATION_EXAMPLE.md - Step-by-step examples
  - [x] MIGRATION_CHECKLIST.md - This file

## 📋 TODO: componentService.ts

Current `any` usages that need replacement:

### High Priority

- [ ] **Line 180**: `private catalogCache = new Map<string, any>()`
  - Replace with: `private catalogCache = new Map<string, CatalogCacheEntry>()`
  - Impact: Core caching functionality

- [ ] **Line 343**: `let projectInfo: any, templateResult: any`
  - Replace with: `let projectInfo: PromiseSettledResult<GitLabProjectInfo>, templateResult: PromiseSettledResult<TemplateFetchResult | null>`
  - Impact: Parallel fetching type safety

- [ ] **Line 570**: `public async fetchJson(url: string, options?: any): Promise<any>`
  - Replace with: `public async fetchJson<T = any>(url: string, options?: HttpRequestOptions): Promise<T>`
  - Impact: All API calls

- [ ] **Line 703**: `let projectInfo: any, templates: any`
  - Replace with: `let projectInfo: PromiseSettledResult<GitLabProjectInfo>, templates: PromiseSettledResult<GitLabTreeItem[]>`
  - Impact: Catalog data fetching

### Medium Priority

- [ ] **Line 73**: `const componentSources: any[] = config.get('componentSources', [])`
  - Replace with: `const componentSources: ComponentSource[] = config.get('componentSources', [])`

- [ ] **Line 426**: `fetchTemplate(..., fetchOptions?: any): Promise<{ content: string; parameters: any[] } | null>`
  - Replace with: `fetchTemplate(..., fetchOptions?: HttpRequestOptions): Promise<TemplateFetchResult | null>`

- [ ] **Line 811**: `fetchTemplateContent(..., fetchOptions?: any): Promise<{...}>`
  - Replace with: `fetchTemplateContent(..., fetchOptions?: HttpRequestOptions): Promise<TemplateContentResult | null>`

- [ ] **Line 1078**: `Promise<Array<{name: string, commit: any}>>`
  - Replace with: `Promise<GitLabTag[]>`

### Low Priority (Internal Variables)

- [ ] **Line 464, 863**: `let currentInput: any = null`
  - Replace with: `let currentInput: Partial<ComponentVariable> | null = null`

- [ ] **Line 349, 710**: `catch (err: any)`
  - Replace with: `catch (err: unknown)` and proper type narrowing

- [ ] **Line 791**: `filter((c: any) => c !== null)`
  - Remove explicit `any`, TypeScript will infer

- [ ] **Line 1006, 1016**: `.map((tag: any) => tag.name)`, `.map((branch: any) => branch.name)`
  - Remove explicit `any`, use proper types from GitLabTag[], GitLabBranch[]

## 📋 TODO: componentCacheManager.ts

Current `any` usages that need replacement:

### High Priority

- [ ] **Line 695**: `const cacheData = this.context.globalState.get<any>('componentCache')`
  - Replace with: `const cacheData = this.context.globalState.get<PersistentCacheData>('componentCache')`
  - Impact: Cache persistence

### Medium Priority

- [ ] **Line 13, 90**: `default?: any` in parameter definitions
  - Replace with: `default?: string | number | boolean | null`
  - Impact: Parameter type safety

### Low Priority

- [ ] **Line 426**: `catalogData.components.find((c: any) => ...)`
  - Remove explicit `any`, TypeScript will infer from CatalogCacheEntry

- [ ] **Line 436, 484**: `.map((v: any) => ...)`
  - Remove explicit `any`, TypeScript will infer

- [ ] **Line 478**: `catalogData.components.map((c: any) => ...)`
  - Remove explicit `any`, TypeScript will infer

- [ ] **Line 540**: `batch.map(async (project: any) => ...)`
  - Replace with: `batch.map(async (project: GitLabProjectInfo) => ...)`

## 📋 TODO: httpClient.ts

Current `any` usages that need replacement:

### High Priority

- [ ] **Line 35**: `async fetchJson(url: string, options: RequestOptions = {}): Promise<any>`
  - Replace with: `async fetchJson<T = any>(url: string, options: RequestOptions = {}): Promise<T>`
  - Impact: Type safety for all API calls

### Low Priority

- [ ] **Line 66, 112**: `catch (error: any)`
  - Replace with: `catch (error: unknown)` and proper type narrowing

## 🔧 Implementation Steps

### Step 1: Update Type Definitions (✅ DONE)
```bash
# Files created:
src/types/cache.ts
src/types/api.ts
src/types/index.ts
src/types/README.md
src/types/TYPE_REFERENCE.md
src/types/TYPE_ARCHITECTURE.md
src/types/MIGRATION_EXAMPLE.md
src/types/MIGRATION_CHECKLIST.md
```

### Step 2: Update httpClient.ts
```typescript
// Before
async fetchJson(url: string, options?: any): Promise<any>

// After
async fetchJson<T = any>(url: string, options?: HttpRequestOptions): Promise<T>
```

### Step 3: Update componentService.ts
```typescript
// Add imports
import {
  CatalogCacheEntry,
  ComponentCacheEntry,
  GitLabProjectInfo,
  GitLabTreeItem,
  GitLabTag,
  GitLabBranch,
  ComponentSource,
  TemplateFetchResult,
  TemplateContentResult,
  HttpRequestOptions
} from '../types';

// Update cache declarations
private catalogCache = new Map<string, CatalogCacheEntry>();
private componentCache = new Map<string, Component>();

// Update method signatures
async fetchJson<T = any>(url: string, options?: HttpRequestOptions): Promise<T>
```

### Step 4: Update componentCacheManager.ts
```typescript
// Add imports
import {
  CachedComponent,
  PersistentCacheData,
  ComponentSource,
  GitLabProjectInfo
} from '../types';

// Update global state access
const cacheData = this.context.globalState.get<PersistentCacheData>('componentCache');
```

### Step 5: Compile and Test
```bash
# Run TypeScript compiler
npm run compile

# Fix any type errors
# (TypeScript will show exact locations and issues)

# Run tests
npm test

# Check for remaining 'any' types
grep -rn ": any" src/services/ src/utils/
```

## 📊 Progress Tracking

### Files to Update
- [ ] src/utils/httpClient.ts (3 `any` usages)
- [ ] src/services/componentService.ts (17 `any` usages)
- [ ] src/services/componentCacheManager.ts (10 `any` usages)

### Estimated Time
- httpClient.ts: ~30 minutes
- componentService.ts: ~2 hours
- componentCacheManager.ts: ~1 hour
- Testing and fixes: ~1 hour
- **Total: ~4-5 hours**

## 🎯 Success Criteria

- [ ] Zero `any` types in production code (except where truly necessary)
- [ ] All TypeScript compilation errors resolved
- [ ] All tests passing
- [ ] IDE autocomplete working for all API responses
- [ ] No runtime type errors in common workflows
- [ ] Documentation updated with new types

## 🔍 Validation Commands

```bash
# Find remaining 'any' types
find src -name "*.ts" -not -path "*/node_modules/*" -exec grep -l ": any" {} \;

# Count remaining 'any' usages
grep -r ": any" src/ --include="*.ts" | wc -l

# Check TypeScript compilation
npm run compile

# Run tests
npm test

# Type coverage (if using type-coverage package)
npx type-coverage
```

## 📝 Notes

- Some `any` types are acceptable (e.g., `default?: any` for truly dynamic values)
- Use `unknown` instead of `any` when type is truly unknown and needs narrowing
- Always add JSDoc comments when introducing new types
- Update tests to use new types as well

## 🚀 Quick Wins

Start with these for immediate impact:

1. ✅ httpClient.ts - Make fetchJson generic (affects everything)
2. catalogCache type in componentService.ts (most frequently used)
3. Global state type in componentCacheManager.ts (persistence safety)

## 🎓 Learning Resources

- See `MIGRATION_EXAMPLE.md` for detailed before/after examples
- See `TYPE_REFERENCE.md` for comprehensive type documentation
- See `TYPE_ARCHITECTURE.md` for visual understanding
- See `README.md` for quick start guide

---

**Status:** In Progress
**Last Updated:** 2026-02-09
**Completed:** 1/4 phases (Type definitions ✅)
