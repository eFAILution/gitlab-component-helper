/**
 * Centralized error types for GitLab Component Helper.
 *
 * This barrel must stay importable from plain Node (unit tests, the MCP server). Do not re-export
 * `./handler` here: it imports `vscode` at module load. Extension code imports it directly.
 */

export {
  ErrorCode,
  GitLabComponentError,
  NetworkError,
  ParseError,
  CacheError,
  ComponentError,
  ConfigurationError
} from './types';

export {
  extractStatusCode,
  isAuthError
} from './guards';
