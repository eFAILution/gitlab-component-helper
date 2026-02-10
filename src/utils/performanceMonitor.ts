import { Logger } from './logger';

/**
 * Performance monitoring utility for tracking slow operations.
 * Automatically warns about operations that exceed 1000ms threshold.
 */

const SLOW_OPERATION_THRESHOLD_MS = 1000;
const MAX_METRICS_HISTORY = 1000;

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

export class PerformanceMonitor {
  private logger = Logger.getInstance();
  private metrics: Map<string, OperationMetric[]> = new Map();

  /**
   * Track an async operation and record its performance metrics.
   * Automatically warns if operation exceeds slow threshold.
   */
  async track<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      this.recordMetric(name, duration, metadata);

      if (duration > SLOW_OPERATION_THRESHOLD_MS) {
        this.logger.warn(
          `[Performance] Slow operation detected: ${name} took ${duration}ms (threshold: ${SLOW_OPERATION_THRESHOLD_MS}ms)`,
          'PerformanceMonitor'
        );
        if (metadata) {
          this.logger.debug(
            `[Performance] Operation metadata: ${JSON.stringify(metadata)}`,
            'PerformanceMonitor'
          );
        }
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordMetric(name, duration, { ...metadata, error: true });
      throw error;
    }
  }

  /**
   * Track a synchronous operation and record its performance metrics.
   * Automatically warns if operation exceeds slow threshold.
   */
  trackSync<T>(
    name: string,
    fn: () => T,
    metadata?: Record<string, any>
  ): T {
    const startTime = Date.now();

    try {
      const result = fn();
      const duration = Date.now() - startTime;

      this.recordMetric(name, duration, metadata);

      if (duration > SLOW_OPERATION_THRESHOLD_MS) {
        this.logger.warn(
          `[Performance] Slow operation detected: ${name} took ${duration}ms (threshold: ${SLOW_OPERATION_THRESHOLD_MS}ms)`,
          'PerformanceMonitor'
        );
        if (metadata) {
          this.logger.debug(
            `[Performance] Operation metadata: ${JSON.stringify(metadata)}`,
            'PerformanceMonitor'
          );
        }
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordMetric(name, duration, { ...metadata, error: true });
      throw error;
    }
  }

  /**
   * Record a metric for an operation.
   */
  private recordMetric(
    name: string,
    duration: number,
    metadata?: Record<string, any>
  ): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metrics = this.metrics.get(name)!;
    metrics.push({
      name,
      duration,
      timestamp: Date.now(),
      metadata
    });

    // Keep only last MAX_METRICS_HISTORY entries to prevent memory issues
    if (metrics.length > MAX_METRICS_HISTORY) {
      metrics.shift();
    }
  }

  /**
   * Get statistics for a specific operation.
   */
  getStats(name: string): OperationStats | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
    const count = durations.length;
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const avgDuration = totalDuration / count;

    return {
      name,
      count,
      totalDuration,
      avgDuration,
      minDuration: durations[0],
      maxDuration: durations[count - 1],
      medianDuration: this.calculatePercentile(durations, 50),
      p95Duration: this.calculatePercentile(durations, 95),
      p99Duration: this.calculatePercentile(durations, 99),
      recentMetrics: metrics.slice(-10) // Last 10 metrics
    };
  }

  /**
   * Get all statistics for all tracked operations.
   */
  getAllStats(): OperationStats[] {
    const stats: OperationStats[] = [];

    for (const name of this.metrics.keys()) {
      const stat = this.getStats(name);
      if (stat) {
        stats.push(stat);
      }
    }

    return stats.sort((a, b) => b.avgDuration - a.avgDuration);
  }

  /**
   * Get the N slowest operations by average duration.
   */
  getSlowestOperations(limit: number = 10): OperationStats[] {
    const allStats = this.getAllStats();
    return allStats.slice(0, limit);
  }

  /**
   * Export all metrics for external analysis.
   */
  exportMetrics(): { operations: string[]; metrics: OperationMetric[] } {
    const allMetrics: OperationMetric[] = [];

    for (const metrics of this.metrics.values()) {
      allMetrics.push(...metrics);
    }

    return {
      operations: Array.from(this.metrics.keys()),
      metrics: allMetrics.sort((a, b) => a.timestamp - b.timestamp)
    };
  }

  /**
   * Clear all recorded metrics.
   */
  clear(): void {
    this.metrics.clear();
    this.logger.info('[Performance] Cleared all performance metrics', 'PerformanceMonitor');
  }

  /**
   * Calculate percentile from sorted array of values.
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) {
      return 0;
    }

    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  /**
   * Get a summary of performance metrics as a formatted string.
   */
  getSummary(): string {
    const stats = this.getAllStats();

    if (stats.length === 0) {
      return 'No performance metrics recorded yet.';
    }

    let summary = '=== Performance Metrics Summary ===\n\n';

    for (const stat of stats) {
      summary += `Operation: ${stat.name}\n`;
      summary += `  Count: ${stat.count}\n`;
      summary += `  Average: ${stat.avgDuration.toFixed(2)}ms\n`;
      summary += `  Min: ${stat.minDuration}ms\n`;
      summary += `  Max: ${stat.maxDuration}ms\n`;
      summary += `  Median: ${stat.medianDuration.toFixed(2)}ms\n`;
      summary += `  P95: ${stat.p95Duration.toFixed(2)}ms\n`;
      summary += `  P99: ${stat.p99Duration.toFixed(2)}ms\n`;

      if (stat.avgDuration > SLOW_OPERATION_THRESHOLD_MS) {
        summary += `  ⚠️  SLOW OPERATION (avg > ${SLOW_OPERATION_THRESHOLD_MS}ms)\n`;
      }

      summary += '\n';
    }

    return summary;
  }
}

// Singleton instance
let performanceMonitor: PerformanceMonitor | null = null;

/**
 * Get the singleton instance of PerformanceMonitor.
 */
export function getPerformanceMonitor(): PerformanceMonitor {
  if (!performanceMonitor) {
    performanceMonitor = new PerformanceMonitor();
  }
  return performanceMonitor;
}
