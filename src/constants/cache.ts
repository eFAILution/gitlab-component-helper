/**
 * Cache-related constants including storage keys and configuration.
 */

// Global State Storage Keys
export const CACHE_KEY_COMPONENTS = 'componentCache' as const;
export const CACHE_KEY_CACHED_COMPONENTS = 'gitlabComponentHelper.cachedComponents' as const;
export const CACHE_KEY_CACHE_TIMESTAMP = 'gitlabComponentHelper.cacheTimestamp' as const;

// Cache Location Messages
export const CACHE_LOCATION_GLOBAL_STATE = 'VS Code Global State (persistent across sessions)' as const;
export const CACHE_LOCATION_MEMORY_ONLY = 'Memory only (will be lost when VS Code closes)' as const;

// Cache Status Messages
export const CACHE_STATUS_NEVER_UPDATED = 'Never' as const;

// YAML Parser Cache
export const YAML_CACHE_SUBSTRING_LENGTH = 100 as const;

// Component Type Defaults
export const DEFAULT_COMPONENT_TYPE_PROJECT = 'project' as const;
export const DEFAULT_COMPONENT_TYPE_GROUP = 'group' as const;

// Source Names
export const SOURCE_LOCAL = 'Local' as const;
export const SOURCE_COMPONENTS_PREFIX = 'Components from' as const;

// Parameter Types
export const PARAMETER_TYPE_STRING = 'string' as const;
export const PARAMETER_TYPE_BOOLEAN = 'boolean' as const;

// Z-Index Values (for CSS)
export const Z_INDEX_HIGH = 1000 as const;
