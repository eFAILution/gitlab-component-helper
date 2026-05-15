"use strict";
/**
 * Cache-related constants including storage keys and configuration.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Z_INDEX_HIGH = exports.PARAMETER_TYPE_BOOLEAN = exports.PARAMETER_TYPE_STRING = exports.SOURCE_COMPONENTS_PREFIX = exports.SOURCE_LOCAL = exports.DEFAULT_COMPONENT_TYPE_GROUP = exports.DEFAULT_COMPONENT_TYPE_PROJECT = exports.YAML_CACHE_SUBSTRING_LENGTH = exports.CACHE_STATUS_NEVER_UPDATED = exports.CACHE_LOCATION_MEMORY_ONLY = exports.CACHE_LOCATION_GLOBAL_STATE = exports.CACHE_KEY_CACHE_TIMESTAMP = exports.CACHE_KEY_CACHED_COMPONENTS = exports.CACHE_KEY_COMPONENTS = void 0;
// Global State Storage Keys
exports.CACHE_KEY_COMPONENTS = 'componentCache';
exports.CACHE_KEY_CACHED_COMPONENTS = 'gitlabComponentHelper.cachedComponents';
exports.CACHE_KEY_CACHE_TIMESTAMP = 'gitlabComponentHelper.cacheTimestamp';
// Cache Location Messages
exports.CACHE_LOCATION_GLOBAL_STATE = 'VS Code Global State (persistent across sessions)';
exports.CACHE_LOCATION_MEMORY_ONLY = 'Memory only (will be lost when VS Code closes)';
// Cache Status Messages
exports.CACHE_STATUS_NEVER_UPDATED = 'Never';
// YAML Parser Cache
exports.YAML_CACHE_SUBSTRING_LENGTH = 100;
// Component Type Defaults
exports.DEFAULT_COMPONENT_TYPE_PROJECT = 'project';
exports.DEFAULT_COMPONENT_TYPE_GROUP = 'group';
// Source Names
exports.SOURCE_LOCAL = 'Local';
exports.SOURCE_COMPONENTS_PREFIX = 'Components from';
// Parameter Types
exports.PARAMETER_TYPE_STRING = 'string';
exports.PARAMETER_TYPE_BOOLEAN = 'boolean';
// Z-Index Values (for CSS)
exports.Z_INDEX_HIGH = 1000;
//# sourceMappingURL=cache.js.map