# Component Service Architecture

## Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                     ComponentService                        │
│                   (Main Orchestrator)                       │
│                                                             │
│  • Delegates to specialized services                        │
│  • Manages cache coordination                               │
│  • Singleton pattern via getComponentService()              │
└──────┬──────────┬──────────┬──────────┬───────────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐
  │ Token   │ │   URL    │ │ Version  │ │Component│
  │ Manager │ │  Parser  │ │ Manager  │ │ Fetcher │
  └─────────┘ └──────────┘ └────┬─────┘ └────┬────┘
                                 │            │
                                 └────┬───────┘
                                      │
                                      ▼
                            ┌──────────────────┐
                            │   HttpClient     │
                            │  (HTTP requests) │
                            └──────────────────┘
```

## Service Responsibilities

### 🎯 ComponentService (Orchestrator)
**Purpose:** Central coordinator for all component operations

**Responsibilities:**
- Delegates operations to specialized services
- Coordinates cache management
- Provides unified API to consumers
- Maintains singleton instance

**Dependencies:**
- TokenManager
- UrlParser  
- VersionManager
- ComponentFetcher
- HttpClient

---

### 🔐 TokenManager
**Purpose:** Manages GitLab authentication tokens

**Responsibilities:**
- Store tokens in VS Code SecretStorage
- Retrieve tokens by GitLab instance
- Provide token to other services

**Dependencies:**
- VS Code SecretStorage API

**Public API:**
```typescript
setSecretStorage(secretStorage: vscode.SecretStorage): void
getTokenForProject(gitlabInstance: string, projectPath: string): Promise<string | undefined>
setTokenForProject(gitlabInstance: string, projectPath: string, token: string): Promise<void>
getTokenForInstance(gitlabInstance: string): Promise<string | undefined>
```

---

### 🔗 UrlParser
**Purpose:** Parse and validate GitLab component URLs

**Responsibilities:**
- Extract components from URLs
- Parse version information
- Clean URL formats

**Dependencies:** None

**Public API:**
```typescript
parseCustomComponentUrl(url: string): ParsedComponentUrl | null
cleanGitLabInstance(gitlabInstance: string): string
```

**Output:**
```typescript
interface ParsedComponentUrl {
  gitlabInstance: string;  // e.g., "gitlab.com"
  path: string;            // e.g., "mygroup/myproject"
  name: string;            // e.g., "deploy-component"
  version?: string;        // e.g., "1.0.0" or "main"
}
```

---

### 📦 VersionManager
**Purpose:** Fetch and manage component versions

**Responsibilities:**
- Fetch tags from GitLab API
- Fetch branches from GitLab API
- Sort versions by semantic versioning
- Parallel fetch optimization

**Dependencies:**
- HttpClient
- TokenManager

**Public API:**
```typescript
fetchProjectVersions(gitlabInstance: string, projectPath: string): Promise<string[]>
fetchProjectTags(gitlabInstance: string, projectPath: string): Promise<GitLabTag[]>
sortVersionsByPriority(versions: string[]): string[]
```

**Version Priority:**
1. Semantic versions (descending: v2.0.0, v1.5.0, v1.0.0)
2. Other versions (alphabetical)
3. Branch names (main/master last)

---

### 🌐 ComponentFetcher
**Purpose:** Fetch component metadata from GitLab

**Responsibilities:**
- Fetch from GitLab CI/CD Catalog API
- Fallback to Repository API
- Parse component templates
- Batch process components
- Manage catalog cache

**Dependencies:**
- HttpClient
- TokenManager
- UrlParser

**Public API:**
```typescript
fetchComponentMetadata(url: string, context?: vscode.ExtensionContext): Promise<Component>
fetchCatalogData(
  gitlabInstance: string,
  projectPath: string,
  forceRefresh?: boolean,
  version?: string,
  context?: vscode.ExtensionContext
): Promise<any>
fetchProjectInfo(gitlabInstance: string, projectPath: string): Promise<any>
clearCache(): void
getCatalogCacheStats(): { size: number; keys: string[] }
```

**Fetch Strategy:**
1. Try GitLab CI/CD Catalog API first (faster, structured data)
2. Fall back to Repository API (parse templates manually)
3. Handle authentication errors (prompt for token)
4. Cache results for performance

---

## Data Flow

### Fetching a Component by URL

```
User Request
    │
    ▼
ComponentService.getComponentFromUrl(url)
    │
    ├──▶ UrlParser.parseCustomComponentUrl(url)
    │    └──▶ Returns: { gitlabInstance, path, name, version }
    │
    └──▶ ComponentFetcher.fetchComponentMetadata(url)
         │
         ├──▶ TokenManager.getTokenForProject(...)
         │    └──▶ Returns: token or undefined
         │
         ├──▶ Try GitLab Catalog API
         │    └──▶ HttpClient.fetchJson(catalogUrl, { token })
         │
         └──▶ Fallback: Repository API
              ├──▶ HttpClient.fetchJson(projectUrl, { token })
              └──▶ Parse template with GitLabSpecParser
                   └──▶ Returns: Component with parameters
```

### Fetching Versions

```
User Request
    │
    ▼
ComponentService.fetchProjectVersions(gitlabInstance, projectPath)
    │
    └──▶ VersionManager.fetchProjectVersions(...)
         │
         ├──▶ TokenManager.getTokenForProject(...)
         │
         ├──▶ Parallel Fetch:
         │    ├──▶ HttpClient.fetchJson(tags endpoint)
         │    └──▶ HttpClient.fetchJson(branches endpoint)
         │
         └──▶ VersionManager.sortVersionsByPriority([...tags, ...branches])
              └──▶ Returns: sorted version list
```

### Fetching Catalog Data

```
User Request
    │
    ▼
ComponentService.fetchCatalogData(gitlabInstance, projectPath)
    │
    └──▶ ComponentFetcher.fetchCatalogData(...)
         │
         ├──▶ Check cache (if not forceRefresh)
         │    └──▶ Return cached data if available
         │
         ├──▶ TokenManager.getTokenForProject(...)
         │
         ├──▶ Parallel Fetch:
         │    ├──▶ HttpClient.fetchJson(project info)
         │    └──▶ HttpClient.fetchJson(templates tree)
         │
         ├──▶ Batch Process Templates:
         │    └──▶ HttpClient.processBatch(yamlFiles, batchSize=5)
         │         └──▶ For each: fetchTemplateContent()
         │              └──▶ GitLabSpecParser.parse(content)
         │
         └──▶ Cache result and return
```

## Import Structure

All modules export through barrel export pattern:

```typescript
// src/services/component/index.ts
export { ComponentService, getComponentService, ComponentSource } from './componentService';
export { TokenManager } from './tokenManager';
export { UrlParser, ParsedComponentUrl } from './urlParser';
export { VersionManager } from './versionManager';
export { ComponentFetcher } from './componentFetcher';
export { registerAddProjectTokenCommand } from './commands';
```

### Usage in Consumers

```typescript
// Before (monolithic)
import { getComponentService } from '../services/componentService';

// After (modular)
import { getComponentService } from '../services/component';
```

## Performance Optimizations

### 1. Parallel Fetching
- **VersionManager:** Fetches tags and branches in parallel
- **ComponentFetcher:** Fetches project info and templates in parallel

### 2. Batch Processing
- **ComponentFetcher:** Processes templates in configurable batches (default: 5)
- Prevents API rate limiting
- Improves responsiveness

### 3. Caching
- **ComponentFetcher:** Maintains catalog cache by project/version
- **ComponentService:** Coordinates component cache
- Cache invalidation via `updateCache()` and `resetCache()`

### 4. Graceful Degradation
- Catalog API fails → Repository API fallback
- Authentication fails → Prompt user for token
- Template fetch fails → Skip component, continue processing

## Error Handling Strategy

### Authentication Errors (401/403)
```
Request fails with 401/403
    │
    ▼
Prompt user for token via VS Code UI
    │
    ├──▶ User enters token
    │    └──▶ TokenManager.setTokenForProject()
    │         └──▶ Retry request with token
    │
    └──▶ User cancels
         └──▶ Throw error, show message
```

### Network Errors
- Log error with Logger
- Return fallback data (empty arrays, default values)
- Show user-friendly error messages via VS Code notifications

### Parse Errors
- Log error with Logger
- Skip invalid templates
- Continue processing valid components
- Return partial results

## Testing Strategy (Future)

### Unit Tests
Each service can be tested independently:

```typescript
// TokenManager tests
describe('TokenManager', () => {
  it('should store and retrieve tokens');
  it('should return undefined when no token exists');
});

// UrlParser tests
describe('UrlParser', () => {
  it('should parse valid component URLs');
  it('should handle URLs with versions');
  it('should return null for invalid URLs');
});

// VersionManager tests
describe('VersionManager', () => {
  it('should sort semantic versions correctly');
  it('should place main/master branches last');
  it('should handle parallel fetch failures gracefully');
});
```

### Integration Tests
Test service interactions:

```typescript
describe('ComponentService Integration', () => {
  it('should fetch component using all services');
  it('should handle authentication flow');
  it('should use cached data when available');
});
```

## Configuration

### VS Code Settings
```json
{
  "gitlabComponentHelper.componentSources": [
    {
      "name": "My Components",
      "path": "mygroup/myproject",
      "gitlabInstance": "gitlab.com",
      "type": "project"
    }
  ],
  "gitlabComponentHelper.batchSize": 5,
  "gitlabComponentHelper.cacheTime": 3600
}
```

### Secret Storage
Tokens stored securely in VS Code SecretStorage:
- Key format: `gitlab-token-{gitlabInstance}`
- Example: `gitlab-token-gitlab.com`
- Encrypted by VS Code

## Migration Notes

The refactoring is **backward compatible**:

- ✅ All public APIs preserved
- ✅ Singleton pattern maintained
- ✅ Import paths updated (but same exports)
- ✅ No breaking changes to consumers
- ✅ Old file archived as `.old` for reference

Consumers see no difference in behavior, only cleaner internal structure.
