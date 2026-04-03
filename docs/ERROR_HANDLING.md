# Error Handling Strategy

This document describes the comprehensive error handling system implemented in the GitLab Component Helper extension.

## Overview

The extension uses a centralized error handling system with custom error types, consistent logging, and user-friendly notifications. All errors are properly typed, logged, and surfaced to users with actionable feedback.

## Architecture

### Error Types

All errors extend from `GitLabComponentError` which provides:
- **Error Code**: Enum value identifying the error type
- **User Message**: User-friendly description
- **Recoverable Flag**: Whether the operation can be retried
- **Details**: Additional context for debugging
- **Cause Chain**: Original error if wrapped

```typescript
export class GitLabComponentError extends Error {
  code: ErrorCode;
  userMessage: string;
  recoverable: boolean;
  details?: any;
}
```

### Error Categories

#### 1. Network Errors (`NetworkError`)
Used for all HTTP-related failures:
- `NETWORK_ERROR`: General connection issues
- `TIMEOUT`: Request exceeded timeout
- `RATE_LIMIT`: GitLab API rate limit hit (429)
- `UNAUTHORIZED`: Auth failed (401/403)
- `NOT_FOUND`: Resource not found (404)
- `SERVER_ERROR`: GitLab server error (5xx)

**Example**:
```typescript
throw new NetworkError('Failed to fetch component', {
  statusCode: 404,
  cause: originalError
});
```

#### 2. Parse Errors (`ParseError`)
Used for YAML/JSON parsing failures:
- `INVALID_YAML`: Malformed YAML syntax
- `INVALID_SPEC`: Component spec doesn't meet requirements
- `PARSE_ERROR`: General parsing failure

**Example**:
```typescript
throw new ParseError('Invalid component specification', {
  yaml: yamlContent,
  cause: parseError
});
```

#### 3. Cache Errors (`CacheError`)
Used for cache operation failures:
- `CACHE_READ_ERROR`: Failed to read from cache
- `CACHE_WRITE_ERROR`: Failed to write to cache
- `CACHE_CORRUPTION`: Cache data is corrupted

**Example**:
```typescript
throw new CacheError('read', 'Cache corrupted', {
  key: cacheKey,
  cause: error
});
```

#### 4. Component Errors (`ComponentError`)
Used for component-specific issues:
- `COMPONENT_NOT_FOUND`: Component doesn't exist
- `INVALID_COMPONENT_PATH`: Malformed path
- `VERSION_NOT_FOUND`: Requested version doesn't exist

**Example**:
```typescript
throw new ComponentError('Component not found', {
  code: ErrorCode.COMPONENT_NOT_FOUND,
  componentPath: 'gitlab-org/component',
  version: 'v1.0.0'
});
```

#### 5. Configuration Errors (`ConfigurationError`)
Used for configuration issues:
- `MISSING_TOKEN`: GitLab token not configured
- `INVALID_CONFIG`: Extension settings invalid
- `INVALID_URL`: Malformed GitLab URL

**Example**:
```typescript
throw new ConfigurationError('Missing GitLab token', {
  setting: 'gitlabComponentHelper.gitlabToken'
});
```

## Error Handler

The `ErrorHandler` singleton provides centralized error processing:

### Key Features

1. **Error Normalization**: Converts any error to `GitLabComponentError`
2. **Consistent Logging**: Logs with appropriate level based on severity
3. **User Notifications**: Shows error messages with contextual actions
4. **Action Handling**: Executes user-selected error actions

### Usage Patterns

#### Wrap Async Operations
```typescript
const handler = getErrorHandler();

const result = await handler.wrap(
  async () => {
    return await fetchComponent(path);
  },
  {
    showNotification: true,
    logError: true,
    fallbackValue: null,
    context: 'fetchComponent'
  }
);
```

#### Handle Errors Explicitly
```typescript
try {
  await riskyOperation();
} catch (error) {
  await handler.handle(error, {
    showNotification: true,
    context: 'riskyOperation'
  });
}
```

#### Use Decorator (Class Methods)
```typescript
class MyService {
  @handleErrors({ showNotification: true, logError: true })
  async fetchData(): Promise<Data> {
    // Errors automatically handled
    return await this.httpClient.fetchJson(url);
  }
}
```

## User Experience

### Error Notifications

Based on error severity and recoverability:

**Recoverable Errors** (Warning):
- Shown as warning notification
- Includes "Retry" or similar action
- Example: Rate limit, temporary network issue

**Non-Recoverable Errors** (Error):
- Shown as error notification
- Includes "View Logs" or configuration actions
- Example: Invalid token, malformed spec

### Contextual Actions

Users see relevant actions based on error type:

| Error Code | Actions |
|-----------|---------|
| `UNAUTHORIZED`, `MISSING_TOKEN` | "Configure Token", "Open Settings" |
| `RATE_LIMIT` | "Retry Later" |
| `NETWORK_ERROR`, `TIMEOUT` | "Retry", "Check Connection" |
| `COMPONENT_NOT_FOUND` | "Browse Components" |
| `CACHE_CORRUPTION` | "Reset Cache" |
| `INVALID_CONFIG` | "Open Settings" |
| Others | "View Logs" |

### Example Flow

1. User action triggers component fetch
2. Network error occurs (timeout)
3. Error handler detects timeout
4. Creates `NetworkError` with `ErrorCode.TIMEOUT`
5. Logs warning with context
6. Shows notification: "Request timed out. The GitLab server may be slow or unreachable."
7. User sees actions: ["Retry", "Check Connection"]
8. User clicks "Retry"
9. Operation retries automatically

## Integration Guidelines

### For New Features

When adding new functionality:

1. **Identify failure modes**: What can go wrong?
2. **Choose error type**: Network, Parse, Cache, Component, Configuration?
3. **Determine recoverability**: Can user retry?
4. **Provide context**: What details help debugging?
5. **Use error handler**: Wrap operations appropriately

### Example Integration

```typescript
import { getErrorHandler, ComponentError, ErrorCode } from '../errors';

class ComponentFetcher {
  private errorHandler = getErrorHandler();

  async fetchComponent(path: string): Promise<Component> {
    return this.errorHandler.wrap(
      async () => {
        // Validate input
        if (!this.isValidPath(path)) {
          throw new ComponentError('Invalid component path', {
            code: ErrorCode.INVALID_COMPONENT_PATH,
            componentPath: path
          });
        }

        // Fetch from API
        const data = await this.httpClient.fetchJson(url);

        // Validate response
        if (!data.component) {
          throw new ComponentError('Component not found', {
            code: ErrorCode.COMPONENT_NOT_FOUND,
            componentPath: path
          });
        }

        return data.component;
      },
      {
        showNotification: true,
        context: 'ComponentFetcher.fetchComponent'
      }
    );
  }
}
```

## Error Recovery

### Automatic Retry

The HTTP client automatically retries for:
- Server errors (5xx)
- Rate limits (429)
- Network timeouts

Uses exponential backoff with jitter:
```typescript
delay = baseDelay * 2^attempt + random(0, 1000)
```

### Manual Retry

Users can manually retry operations via:
- "Retry" action in error notification
- Refresh commands (e.g., "Refresh Components Cache")
- Re-executing the original command

### Graceful Degradation

Services use graceful degradation patterns:

```typescript
// Parallel operations with partial success
const results = await Promise.allSettled(operations);

for (const result of results) {
  if (result.status === 'fulfilled') {
    successfulComponents.push(result.value);
  } else {
    this.errorHandler.handle(result.reason, {
      showNotification: false, // Don't spam user
      logError: true
    });
  }
}
```

## Logging

### Log Levels

Errors are logged with appropriate levels:

- **DEBUG**: Error stack traces, detailed context
- **WARN**: Recoverable errors, retry attempts
- **ERROR**: Non-recoverable errors, operation failures

### Log Format

```
[Context] ERROR_CODE: message { details }
```

Example:
```
[ComponentFetcher.fetchComponent] COMPONENT_NOT_FOUND: Component not found { componentPath: 'gitlab-org/test', version: 'v1.0.0' }
```

### Viewing Logs

Users can view logs via:
1. "View Logs" action in error notifications
2. Command: "Developer: Show Logs"
3. Output channel: "GitLab Component Helper"

## Testing Error Handling

### Unit Tests

Test error types and handler:

```typescript
describe('ErrorHandler', () => {
  it('should normalize network errors', async () => {
    const error = new Error('ECONNREFUSED');
    const handler = getErrorHandler();

    const normalized = handler.normalizeError(error);

    expect(normalized).toBeInstanceOf(NetworkError);
    expect(normalized.code).toBe(ErrorCode.NETWORK_ERROR);
  });

  it('should provide correct user message', () => {
    const error = new NetworkError('Failed', { statusCode: 401 });

    expect(error.userMessage).toContain('Authentication failed');
  });
});
```

### Integration Tests

Test error handling in context:

```typescript
describe('ComponentService', () => {
  it('should handle 404 gracefully', async () => {
    mockHttpClient.fetchJson.mockRejectedValue(
      new NetworkError('Not found', { statusCode: 404 })
    );

    const result = await componentService.fetchComponent('invalid');

    expect(result).toBeNull();
    expect(mockNotifications.showError).toHaveBeenCalled();
  });
});
```

## Best Practices

### 1. Always Use Error Handler

❌ **Bad**:
```typescript
try {
  await operation();
} catch (error) {
  console.error(error);
  vscode.window.showErrorMessage('Failed');
}
```

✅ **Good**:
```typescript
const handler = getErrorHandler();
await handler.wrap(
  () => operation(),
  { showNotification: true, context: 'operation' }
);
```

### 2. Provide Context

❌ **Bad**:
```typescript
throw new Error('Failed');
```

✅ **Good**:
```typescript
throw new ComponentError('Failed to fetch component', {
  code: ErrorCode.COMPONENT_NOT_FOUND,
  componentPath: path,
  version: version
});
```

### 3. Don't Swallow Errors

❌ **Bad**:
```typescript
try {
  await operation();
} catch {
  // Silent failure
}
```

✅ **Good**:
```typescript
try {
  await operation();
} catch (error) {
  await handler.handle(error, { logError: true });
}
```

### 4. Use Appropriate Error Types

❌ **Bad**:
```typescript
throw new Error('Network error');
```

✅ **Good**:
```typescript
throw new NetworkError('Failed to connect', {
  statusCode: 503,
  cause: originalError
});
```

### 5. Check Recoverability

```typescript
const error = await handler.wrap(() => operation());

if (error && handler.isRecoverable(error)) {
  // Offer retry option
  await retryOperation();
}
```

## Future Enhancements

Planned improvements to error handling:

1. **Error Analytics**: Track error frequency and patterns
2. **Smart Retry**: Adjust retry strategy based on error type
3. **Offline Mode**: Queue operations when offline
4. **Error Reporting**: Optional anonymous error reporting
5. **Recovery Suggestions**: ML-based recovery hints

## Resources

- Error Types: [src/errors/types.ts](../src/errors/types.ts)
- Error Handler: [src/errors/handler.ts](../src/errors/handler.ts)
- Usage Examples: [src/utils/httpClient.ts](../src/utils/httpClient.ts)
