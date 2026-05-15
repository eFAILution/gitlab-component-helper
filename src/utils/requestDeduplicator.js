"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestDeduplicator = void 0;
exports.getRequestDeduplicator = getRequestDeduplicator;
exports.resetRequestDeduplicator = resetRequestDeduplicator;
class RequestDeduplicator {
    constructor() {
        this.pendingRequests = new Map();
    }
    /**
     * Fetch data with deduplication.
     * If a request with the same key is already pending, returns the existing promise.
     * Otherwise, executes the fetcher function and caches the promise.
     *
     * @param key Unique identifier for the request (e.g., URL + auth token)
     * @param fetcher Function that performs the actual fetch
     * @returns Promise that resolves to the fetched data
     */
    async fetch(key, fetcher) {
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
    clear() {
        this.pendingRequests.clear();
    }
    /**
     * Get statistics about pending requests.
     *
     * @returns Object containing pending request count and keys
     */
    getStats() {
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
    cleanupStale(maxAgeMs = 5 * 60 * 1000) {
        const now = Date.now();
        const staleKeys = [];
        this.pendingRequests.forEach((request, key) => {
            if (now - request.timestamp > maxAgeMs) {
                staleKeys.push(key);
            }
        });
        staleKeys.forEach(key => this.pendingRequests.delete(key));
    }
}
exports.RequestDeduplicator = RequestDeduplicator;
// Singleton instance
let instance = null;
/**
 * Get the singleton RequestDeduplicator instance.
 *
 * @returns The global RequestDeduplicator instance
 */
function getRequestDeduplicator() {
    if (!instance) {
        instance = new RequestDeduplicator();
    }
    return instance;
}
/**
 * Reset the singleton instance.
 * Primarily used for testing purposes.
 */
function resetRequestDeduplicator() {
    instance = null;
}
//# sourceMappingURL=requestDeduplicator.js.map