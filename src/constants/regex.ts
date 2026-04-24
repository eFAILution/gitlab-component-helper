/**
 * Regular expression patterns used throughout the extension.
 */

// Component Spec Parsing
export const SPEC_INPUTS_SECTION_REGEX = /spec:\s*\n\s*inputs:([\s\S]*?)(?=\n---|\ndescription:|\nvariables:|\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/;

// URL Pattern Matching
export const URL_PROTOCOL_REGEX = /^https?:\/\//i;
export const LEADING_TRAILING_SLASH_REGEX = /^\/+|\/+$/g;

// Git URL Patterns
export const GIT_HTTPS_URL_REGEX = /^https:\/\/([^\/]+)\/(.+)\.git$/;
export const GIT_SSH_URL_REGEX = /^git@([^:]+):(.+)\.git$/;

// Component URL Patterns
export const COMPONENT_URL_PATTERN_REGEX = /component:\s*[^\n]*/;

// Version Matching
export const SEMANTIC_VERSION_REGEX = /^v?(\d+)\.(\d+)\.(\d+)/;

// YAML Pattern Matching
export const YAML_INPUTS_SECTION_REGEX = /^\s*inputs:\s*$/m;
export const YAML_PARAMETER_LINE_REGEX = /^\s{2,}([a-zA-Z][a-zA-Z0-9_-]*)\s*:/;
export const YAML_NON_INDENTED_LINE_REGEX = /^\S/;

// Character Escaping
export const REGEX_SPECIAL_CHARS_ESCAPE = /[.*+?^${}()|[\]\\]/g;
