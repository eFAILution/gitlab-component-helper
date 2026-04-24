# Performance Monitor

## Overview

The PerformanceMonitor utility tracks slow operations throughout the GitLab Component Helper extension, automatically warning about operations that exceed the 1000ms threshold.

## Features

### Automatic Slow Operation Detection
- Tracks execution time for all monitored operations
- Automatically warns in logs when operations exceed 1000ms
- Includes metadata for debugging slow operations

### Statistics Collection
- **Count**: Total number of executions
- **Average**: Mean execution time
- **Min/Max**: Fastest and slowest execution times
- **Median**: Middle value of execution times
- **P95/P99**: 95th and 99th percentile execution times

### Memory Management
- Keeps only last 1000 metrics per operation to prevent memory issues
- Provides cache clear functionality

## Architecture

### Singleton Pattern
```typescript
import { getPerformanceMonitor } from './utils/performanceMonitor';

const perfMonitor = getPerformanceMonitor();
```

### Tracked Operations

#### ComponentService
- `fetchComponentMetadata` - Fetching component metadata from GitLab
- `fetchCatalogData` - Fetching catalog data from GitLab projects

#### ComponentCacheManager
- `refreshComponents` - Refreshing all component cache
- `fetchComponentVersions` - Fetching available versions for components

#### HttpClient
- `httpClient.fetchJson` - JSON HTTP requests
- `httpClient.fetchText` - Text HTTP requests

## Usage

### View Performance Statistics

Run the command from VS Code Command Palette:
```
GitLab CI: Show Performance Statistics
```

This will display:
- Summary of all tracked operations
- Count, average, min, max, median, P95, P99 durations
- Warnings for slow operations (avg > 1000ms)
- Top 10 slowest operations by average duration

### Programmatic Access

```typescript
import { getPerformanceMonitor } from './utils/performanceMonitor';

const perfMonitor = getPerformanceMonitor();

// Track async operation
await perfMonitor.track(
  'myOperation',
  async () => {
    return await someAsyncWork();
  },
  { metadata: 'optional' }
);

// Track sync operation
const result = perfMonitor.trackSync(
  'mySyncOperation',
  () => {
    return someWork();
  }
);

// Get statistics
const stats = perfMonitor.getStats('myOperation');
console.log(`Average: ${stats.avgDuration}ms`);

// Get slowest operations
const slowest = perfMonitor.getSlowestOperations(5);

// Export all metrics
const allMetrics = perfMonitor.exportMetrics();

// Clear all metrics
perfMonitor.clear();
```

## Implementation Details

### Constants
- `SLOW_OPERATION_THRESHOLD_MS = 1000` - Threshold for slow operation warnings
- `MAX_METRICS_HISTORY = 1000` - Maximum metrics kept per operation

### Data Structures

```typescript
interface OperationMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface OperationStats {
  name: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  medianDuration: number;
  p95Duration: number;
  p99Duration: number;
  recentMetrics: OperationMetric[];
}
```

## Integration Points

### ComponentService
```typescript
private async fetchComponentMetadata(url: string, context?: vscode.ExtensionContext): Promise<Component> {
  return this.performanceMonitor.track(
    'fetchComponentMetadata',
    async () => {
      return this.fetchComponentMetadataInternal(url, context);
    },
    { url }
  );
}
```

### ComponentCacheManager
```typescript
public async refreshComponents(): Promise<void> {
  return this.performanceMonitor.track(
    'refreshComponents',
    async () => {
      return this.refreshComponentsInternal();
    }
  );
}
```

### HttpClient
```typescript
async fetchJson(url: string, options: RequestOptions = {}): Promise<any> {
  return this.performanceMonitor.track(
    'httpClient.fetchJson',
    async () => {
      return this.fetchJsonInternal(url, options);
    },
    { url: new URL(url).hostname + new URL(url).pathname }
  );
}
```

## Benefits

1. **Proactive Performance Monitoring**: Automatically identifies slow operations without manual timing code
2. **Historical Analysis**: Tracks performance trends over time with percentile statistics
3. **Debugging Aid**: Provides metadata with slow operations to help diagnose issues
4. **Memory Safe**: Automatically limits history to prevent memory leaks
5. **Zero Configuration**: Works out of the box with singleton pattern

## Future Enhancements

Potential improvements:
- Export metrics to external monitoring systems
- Configurable slow operation threshold
- Performance regression detection
- Automatic performance reports
- Integration with VS Code telemetry

## Example Output

```
=== Performance Metrics Summary ===

Operation: fetchCatalogData
  Count: 15
  Average: 856.32ms
  Min: 234ms
  Max: 2103ms
  Median: 798.00ms
  P95: 1876.50ms
  P99: 2051.90ms

Operation: httpClient.fetchJson
  Count: 127
  Average: 156.78ms
  Min: 45ms
  Max: 1567ms
  Median: 134.00ms
  P95: 423.45ms
  P99: 987.23ms

Operation: refreshComponents
  Count: 3
  Average: 3421.67ms
  Min: 2834ms
  Max: 4567ms
  Median: 2965.00ms
  P95: 4406.50ms
  P99: 4534.90ms
  ⚠️  SLOW OPERATION (avg > 1000ms)

=== Top 10 Slowest Operations ===

1. refreshComponents
   Average: 3421.67ms
   Max: 4567ms
   P95: 4406.50ms
   Count: 3

2. fetchCatalogData
   Average: 856.32ms
   Max: 2103ms
   P95: 1876.50ms
   Count: 15

3. httpClient.fetchJson
   Average: 156.78ms
   Max: 1567ms
   P95: 423.45ms
   Count: 127
```

## Related Files

- `/src/utils/performanceMonitor.ts` - Main implementation
- `/src/services/componentService.ts` - Integration for component operations
- `/src/services/componentCacheManager.ts` - Integration for cache operations
- `/src/utils/httpClient.ts` - Integration for HTTP operations
- `/src/extension.ts` - Command registration
- `/package.json` - Command contribution

## Testing

To test the performance monitor:

1. Open VS Code with the extension
2. Trigger component operations (browse, refresh, etc.)
3. Run command: `GitLab CI: Show Performance Statistics`
4. Check output channel for detailed metrics
5. Look for slow operation warnings in extension logs
