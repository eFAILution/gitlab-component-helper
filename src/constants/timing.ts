/**
 * Timing-related constants for delays, timeouts, and intervals.
 * All values are in milliseconds unless otherwise specified.
 */

// UI Delays
export const PANEL_FOCUS_DELAY_MS = 100 as const;

// HTTP Timeouts
export const DEFAULT_HTTP_TIMEOUT_MS = 10000 as const;
export const DEFAULT_RETRY_BASE_DELAY_MS = 1000 as const;
export const RETRY_JITTER_MS = 1000 as const;

// Cache Times (in seconds - converted to ms in usage)
export const DEFAULT_CACHE_TIME_SECONDS = 3600 as const; // 1 hour
export const DEFAULT_VERSION_CACHE_TIME_SECONDS = 86400 as const; // 24 hours
export const VERSION_REFRESH_MULTIPLIER = 4 as const; // 4x component cache time

// Retry Configuration
export const DEFAULT_RETRY_ATTEMPTS = 3 as const;

// API Pagination
export const API_PER_PAGE_LIMIT = 100 as const;

// Batch Processing
export const DEFAULT_BATCH_SIZE = 5 as const;

// Progress Increments
export const PROGRESS_COMPLETE = 100 as const;

// Port Numbers
export const DEFAULT_HTTP_PORT = 80 as const;
export const DEFAULT_HTTPS_PORT = 443 as const;

// Version Priority Scores
export const VERSION_PRIORITY_MAIN = 1000 as const;
export const VERSION_PRIORITY_MASTER = 900 as const;
export const VERSION_PRIORITY_LATEST = 1000 as const;
export const VERSION_PRIORITY_MAIN_ALT = 900 as const;
export const VERSION_PRIORITY_MASTER_ALT = 800 as const;

// Semantic Versioning Multipliers
export const SEMVER_MAJOR_MULTIPLIER = 1000000 as const;
export const SEMVER_MINOR_MULTIPLIER = 1000 as const;
