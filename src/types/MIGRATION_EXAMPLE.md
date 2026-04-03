# Type Migration Examples

This document shows concrete examples of how to migrate from `any` types to proper TypeScript types.

## Example 1: ComponentService.catalogCache

### Before (Using `any`)

```typescript
export class ComponentService {
  private catalogCache = new Map<string, any>();

  async fetchCatalogData(
    gitlabInstance: string,
    projectPath: string
  ): Promise<any> {
    const cacheKey = `catalog:${gitlabInstance}:${projectPath}`;

    // Check cache first
    if (this.catalogCache.has(cacheKey)) {
      return this.catalogCache.get(cacheKey);
    }

    // Fetch fresh data
    const catalogData = await this.httpClient.fetchJson(catalogApiUrl);

    // Cache the result
    this.catalogCache.set(cacheKey, catalogData);

    return catalogData;
  }
}
```

### After (Using Proper Types)

```typescript
import { CatalogCacheEntry, GitLabProjectInfo, GitLabTreeItem } from '../types';

export class ComponentService {
  private catalogCache = new Map<string, CatalogCacheEntry>();

  async fetchCatalogData(
    gitlabInstance: string,
    projectPath: string
  ): Promise<CatalogCacheEntry> {
    const cacheKey = `catalog:${gitlabInstance}:${projectPath}`;

    // Check cache first (type-safe!)
    const cached = this.catalogCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch fresh data with proper types
    const catalogData: CatalogCacheEntry = await this.httpClient.fetchJson(
      catalogApiUrl
    );

    // Cache the result (type-checked!)
    this.catalogCache.set(cacheKey, catalogData);

    return catalogData;
  }
}
```

**Benefits:**
- TypeScript now knows `catalogData.components` exists
- Autocomplete works: `catalogData.components[0].` shows `name`, `description`, etc.
- Compile error if you try to access non-existent properties
- Refactoring tools can track all usages

## Example 2: Parallel API Fetching

### Before (Using `any`)

```typescript
const [projectInfo, templates] = await Promise.all([
  this.httpClient.fetchJson(projectApiUrl),
  this.httpClient.fetchJson(templatesUrl)
]);

// What type is projectInfo? What fields does it have?
// No way to know without looking at GitLab API docs!
const defaultBranch = projectInfo.default_branch; // Could be typo!
const yamlFiles = templates.filter((file: any) =>
  file.name.endsWith('.yml')
);
```

### After (Using Proper Types)

```typescript
import { GitLabProjectInfo, GitLabTreeItem } from '../types';

const [projectInfoResult, templatesResult] = await Promise.all([
  this.httpClient.fetchJson<GitLabProjectInfo>(projectApiUrl),
  this.httpClient.fetchJson<GitLabTreeItem[]>(templatesUrl)
]);

// TypeScript knows the exact structure!
const projectInfo: GitLabProjectInfo = projectInfoResult;
const templates: GitLabTreeItem[] = templatesResult;

// Autocomplete works, typos caught at compile time
const defaultBranch = projectInfo.default_branch; // ✓ Type-safe
const projectName = projectInfo.name;             // ✓ Type-safe

// Filter is type-safe
const yamlFiles = templates.filter(file =>
  file.name.endsWith('.yml') || file.name.endsWith('.yaml')
);

// TypeScript knows yamlFiles is GitLabTreeItem[]
yamlFiles.forEach(file => {
  console.log(file.path);  // ✓ Known to exist
  console.log(file.type);  // ✓ Known to be 'tree' | 'blob'
});
```

## Example 3: ComponentCacheManager Global State

### Before (Using `any`)

```typescript
export class ComponentCacheManager {
  private async loadCacheFromDisk(): Promise<void> {
    const cacheData = this.context.globalState.get<any>('componentCache');

    // What structure does cacheData have? Unknown!
    if (cacheData && cacheData.components) {
      this.components = cacheData.components;
      this.lastRefreshTime = cacheData.lastRefreshTime || 0;
      // Might crash if structure is wrong!
    }
  }

  private async saveCacheToDisk(): Promise<void> {
    const cacheData = {
      components: this.components,
      lastRefreshTime: this.lastRefreshTime,
      version: '1.0.0'
    };

    // No type safety here
    await this.context.globalState.update('componentCache', cacheData);
  }
}
```

### After (Using Proper Types)

```typescript
import { PersistentCacheData, CachedComponent } from '../types';

export class ComponentCacheManager {
  private async loadCacheFromDisk(): Promise<void> {
    const cacheData = this.context.globalState.get<PersistentCacheData>(
      'componentCache'
    );

    // TypeScript validates the structure
    if (cacheData && cacheData.components && Array.isArray(cacheData.components)) {
      this.components = cacheData.components;
      this.lastRefreshTime = cacheData.lastRefreshTime || 0;
      this.projectVersionsCache = new Map(cacheData.projectVersionsCache || []);
      // Type-safe: we know exactly what fields exist
    }
  }

  private async saveCacheToDisk(): Promise<void> {
    const cacheData: PersistentCacheData = {
      components: this.components,
      lastRefreshTime: this.lastRefreshTime,
      projectVersionsCache: Array.from(this.projectVersionsCache.entries()),
      version: '1.0.0'
    };

    // TypeScript ensures we're saving the correct structure
    await this.context.globalState.update('componentCache', cacheData);
  }
}
```

**Benefits:**
- Can't accidentally save wrong structure
- Can't read wrong fields
- Version migrations are easier
- Compile errors prevent runtime crashes

## Example 4: HttpClient Generic Methods

### Before (Using `any`)

```typescript
export class HttpClient {
  async fetchJson(url: string, options?: RequestOptions): Promise<any> {
    const data = await this.makeRequest(url, options);
    return JSON.parse(data);
  }
}

// Usage - no type safety
const project = await httpClient.fetchJson('/api/v4/projects/123');
console.log(project.anyFieldHere); // No error, crashes at runtime!
```

### After (Using Generics)

```typescript
export class HttpClient {
  async fetchJson<T = any>(
    url: string,
    options?: RequestOptions
  ): Promise<T> {
    const data = await this.makeRequest(url, options);
    return JSON.parse(data) as T;
  }
}

// Usage - type-safe
import { GitLabProjectInfo } from '../types';

const project = await httpClient.fetchJson<GitLabProjectInfo>(
  '/api/v4/projects/123'
);

console.log(project.name);              // ✓ Type-safe
console.log(project.default_branch);    // ✓ Type-safe
console.log(project.nonExistentField);  // ✗ Compile error!
```

## Example 5: Template Parsing

### Before (Using `any`)

```typescript
private async fetchTemplateContent(
  apiBaseUrl: string,
  projectId: string,
  fileName: string,
  ref: string
): Promise<any> {
  const content = await this.httpClient.fetchText(contentUrl);

  let extractedVariables: any[] = [];
  // ... parsing logic

  return {
    content,
    extractedVariables,
    // No idea what other fields might exist
  };
}

// Usage
const result = await this.fetchTemplateContent(...);
const variables = result.extractedVariables; // What type are these?
```

### After (Using Proper Types)

```typescript
import { TemplateContentResult, ComponentVariable } from '../types';

private async fetchTemplateContent(
  apiBaseUrl: string,
  projectId: string,
  fileName: string,
  ref: string
): Promise<TemplateContentResult | null> {
  const content = await this.httpClient.fetchText(contentUrl);

  let extractedVariables: ComponentVariable[] = [];
  // ... parsing logic

  return {
    content,
    extractedVariables,
    extractedDescription: '',
    isValidComponent: true
  };
}

// Usage - fully type-safe
const result = await this.fetchTemplateContent(...);

if (result && result.isValidComponent) {
  // TypeScript knows this is TemplateContentResult
  result.extractedVariables.forEach(variable => {
    console.log(variable.name);        // ✓ Known field
    console.log(variable.description); // ✓ Known field
    console.log(variable.required);    // ✓ Known field
  });
}
```

## Example 6: Component Source Configuration

### Before (Using Inline Types)

```typescript
const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
const sources = config.get<Array<{
  name: string;
  path: string;
  gitlabInstance?: string;
  type?: string; // What values are valid?
}>>('componentSources', []);

sources.forEach(source => {
  // Type is unclear
  if (source.type === 'group') {
    // ...
  }
});
```

### After (Using ComponentSource Type)

```typescript
import { ComponentSource } from '../types';

const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
const sources = config.get<ComponentSource[]>('componentSources', []);

sources.forEach(source => {
  // TypeScript knows type is 'project' | 'group' | undefined
  if (source.type === 'group') {
    // ✓ Type-safe
    await this.fetchComponentsFromGroup(
      source.gitlabInstance || 'gitlab.com',
      source.path,
      source.name
    );
  } else {
    // ✓ Type-safe
    await this.fetchComponentsFromProject(
      source.gitlabInstance || 'gitlab.com',
      source.path,
      source.name
    );
  }
});
```

## Example 7: Error Handling with Types

### Before

```typescript
try {
  const data = await this.httpClient.fetchJson(url);
  // What if data.statusCode exists? What if it doesn't?
  if (data.statusCode === 404) {
    // ...
  }
} catch (error: any) {
  // What properties does error have?
  if (error.statusCode === 401) {
    // Prompt for token
  }
}
```

### After

```typescript
import { GitLabProjectInfo } from '../types';

try {
  const data = await this.httpClient.fetchJson<GitLabProjectInfo>(url);
  // TypeScript knows data.statusCode doesn't exist on GitLabProjectInfo
  // (statusCode comes from HTTP errors, not the response body)
} catch (error: unknown) {
  // Narrow the type safely
  if (error instanceof Error && 'statusCode' in error) {
    const httpError = error as Error & { statusCode: number };
    if (httpError.statusCode === 401) {
      // Prompt for token
    }
  }
}
```

## Complete Migration Example

Here's a complete before/after for a method in componentService.ts:

### Before

```typescript
async fetchCatalogData(
  gitlabInstance: string,
  projectPath: string,
  forceRefresh: boolean = false
): Promise<any> {
  const cacheKey = `catalog:${gitlabInstance}:${projectPath}`;

  if (!forceRefresh && this.catalogCache.has(cacheKey)) {
    return this.catalogCache.get(cacheKey);
  }

  const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
  const projectInfo = await this.httpClient.fetchJson(
    `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`
  );

  const templates = await this.httpClient.fetchJson(
    `${apiBaseUrl}/projects/${projectInfo.id}/repository/tree?path=templates`
  );

  const yamlFiles = templates.filter((file: any) =>
    file.name.endsWith('.yml')
  );

  const components: any[] = [];
  for (const file of yamlFiles) {
    const result = await this.fetchTemplateContent(
      apiBaseUrl,
      projectInfo.id,
      file.name,
      'main'
    );

    if (result) {
      components.push({
        name: file.name.replace(/\.yml$/, ''),
        description: result.extractedDescription || '',
        variables: result.extractedVariables
      });
    }
  }

  const catalogData = { components };
  this.catalogCache.set(cacheKey, catalogData);

  return catalogData;
}
```

### After

```typescript
import {
  CatalogCacheEntry,
  GitLabProjectInfo,
  GitLabTreeItem,
  TemplateContentResult
} from '../types';

async fetchCatalogData(
  gitlabInstance: string,
  projectPath: string,
  forceRefresh: boolean = false
): Promise<CatalogCacheEntry> {
  const cacheKey = `catalog:${gitlabInstance}:${projectPath}`;

  // Type-safe cache retrieval
  if (!forceRefresh) {
    const cached = this.catalogCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const apiBaseUrl = `https://${gitlabInstance}/api/v4`;

  // Type-safe API calls
  const projectInfo = await this.httpClient.fetchJson<GitLabProjectInfo>(
    `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`
  );

  const templates = await this.httpClient.fetchJson<GitLabTreeItem[]>(
    `${apiBaseUrl}/projects/${projectInfo.id}/repository/tree?path=templates`
  );

  // Type-safe filtering
  const yamlFiles = templates.filter(file =>
    file.name.endsWith('.yml')
  );

  // Type-safe component building
  const components: CatalogCacheEntry['components'] = [];

  for (const file of yamlFiles) {
    const result: TemplateContentResult | null = await this.fetchTemplateContent(
      apiBaseUrl,
      String(projectInfo.id),
      file.name,
      'main'
    );

    if (result && result.isValidComponent) {
      components.push({
        name: file.name.replace(/\.yml$/, ''),
        description: result.extractedDescription || '',
        variables: result.extractedVariables
      });
    }
  }

  const catalogData: CatalogCacheEntry = { components };
  this.catalogCache.set(cacheKey, catalogData);

  return catalogData;
}
```

## Key Takeaways

1. **Import types from central location**: `import { Type } from '../types';`
2. **Use type parameters**: `fetchJson<GitLabProjectInfo>(url)`
3. **Declare types explicitly**: `const data: GitLabProjectInfo = ...`
4. **Use type guards**: Check types at runtime when needed
5. **Leverage autocomplete**: Let IDE guide you with available fields
6. **Trust the compiler**: Red squiggles prevent runtime errors
7. **Document with types**: Types are living documentation

## Testing the Migration

After migrating to proper types, run:

```bash
# Compile TypeScript to check for type errors
npm run compile

# Or watch mode for continuous feedback
npm run watch

# Run tests with type checking
npm test
```

TypeScript will catch any type mismatches immediately!
