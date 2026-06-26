/**
 * Centralized error handling for GitLab Component Helper
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

export {
  ErrorHandler,
  ErrorHandlerOptions,
  getErrorHandler,
  handleErrors
} from './handler';
