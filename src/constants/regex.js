"use strict";
/**
 * Regular expression patterns used throughout the extension.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REGEX_SPECIAL_CHARS_ESCAPE = exports.YAML_NON_INDENTED_LINE_REGEX = exports.YAML_PARAMETER_LINE_REGEX = exports.YAML_INPUTS_SECTION_REGEX = exports.SEMANTIC_VERSION_REGEX = exports.COMPONENT_URL_PATTERN_REGEX = exports.GIT_SSH_URL_REGEX = exports.GIT_HTTPS_URL_REGEX = exports.LEADING_TRAILING_SLASH_REGEX = exports.URL_PROTOCOL_REGEX = exports.SPEC_INPUTS_SECTION_REGEX = void 0;
// Component Spec Parsing
exports.SPEC_INPUTS_SECTION_REGEX = /spec:\s*\n\s*inputs:([\s\S]*?)(?=\n---|\ndescription:|\nvariables:|\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/;
// URL Pattern Matching
exports.URL_PROTOCOL_REGEX = /^https?:\/\//i;
exports.LEADING_TRAILING_SLASH_REGEX = /^\/+|\/+$/g;
// Git URL Patterns
exports.GIT_HTTPS_URL_REGEX = /^https:\/\/([^/]+)\/(.+)\.git$/;
exports.GIT_SSH_URL_REGEX = /^git@([^:]+):(.+)\.git$/;
// Component URL Patterns
exports.COMPONENT_URL_PATTERN_REGEX = /component:\s*[^\n]*/;
// Version Matching
exports.SEMANTIC_VERSION_REGEX = /^v?(\d+)\.(\d+)\.(\d+)/;
// YAML Pattern Matching
exports.YAML_INPUTS_SECTION_REGEX = /^\s*inputs:\s*$/m;
exports.YAML_PARAMETER_LINE_REGEX = /^\s{2,}([a-zA-Z][a-zA-Z0-9_-]*)\s*:/;
exports.YAML_NON_INDENTED_LINE_REGEX = /^\S/;
// Character Escaping
exports.REGEX_SPECIAL_CHARS_ESCAPE = /[.*+?^${}()|[\]\\]/g;
//# sourceMappingURL=regex.js.map