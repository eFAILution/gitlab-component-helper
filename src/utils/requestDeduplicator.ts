/**
 * RequestDeduplicator
 *
 * Prevents duplicate simultaneous HTTP requests by reusing pending promises
 * for identical requests. This reduces unnecessary network traffic and improves
 * performance when multiple components request the same resource simultaneously.
 *
 * Features:
 * - Deduplicates requests based on unique cache keys
 * - Automatically cleans up after completion
 * - Provides statistics on pending requests
 * - Thread-safe promise reuse
 */

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

export class RequestDeduplicator {
  private pendingRequests: Map<string, PendingRequest<any>> = new Map();

  /**
   * Fetch data with deduplication.
   * If a request with the same key is already pending, returns the existing promise.
   * Otherwise, executes the fetcher function and caches the promise.
   *
   * @param key Unique identifier for the request (e.g., URL + auth token)
   * @param fetcher Function that performs the actual fetch
   * @returns Promise that resolves to the fetched data
   */
  async fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.pendingRequests.get(key);

    if (existing) {
      return existing.promise;
    }

    const promise = fetcher()
      .then((result) => {
        this.pendingRequests.delete(key);
        return result;
      })
      .catch((error) => {
        this.pendingRequests.delete(key);
        throw error;
      });

    this.pendingRequests.set(key, {
      promise,
      timestamp: Date.now()
    });

    return promise;
  }

  /**
   * Clear all pending requests.
   * Useful for cleanup or reset scenarios.
   */
  clear(): void {
    this.pendingRequests.clear();
  }

  /**
   * Get statistics about pending requests.
   *
   * @returns Object containing pending request count and keys
   */
  getStats(): { pendingCount: number; pendingKeys: string[] } {
    return {
      pendingCount: this.pendingRequests.size,
      pendingKeys: Array.from(this.pendingRequests.keys())
    };
  }

  /**
   * Clean up stale requests that have been pending for too long.
   * This is a safety mechanism to prevent memory leaks from stuck promises.
   *
   * @param maxAgeMs Maximum age in milliseconds (default: 5 minutes)
   */
  cleanupStale(maxAgeMs: number = 5 * 60 * 1000): void {
    const now = Date.now();
    const staleKeys: string[] = [];

    this.pendingRequests.forEach((request, key) => {
      if (now - request.timestamp > maxAgeMs) {
        staleKeys.push(key);
      }
    });

    staleKeys.forEach(key => this.pendingRequests.delete(key));
  }
}

// Singleton instance
let instance: RequestDeduplicator | null = null;

/**
 * Get the singleton RequestDeduplicator instance.
 *
 * @returns The global RequestDeduplicator instance
 */
export function getRequestDeduplicator(): RequestDeduplicator {
  if (!instance) {
    instance = new RequestDeduplicator();
  }
  return instance;
}

/**
 * Reset the singleton instance.
 * Primarily used for testing purposes.
 */
export function resetRequestDeduplicator(): void {
  instance = null;
}
