/**
 * Custom error types for GitLab Component Helper
 */

export enum ErrorCode {
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT',
  UNAUTHORIZED = 'UNAUTHORIZED',
  NOT_FOUND = 'NOT_FOUND',
  SERVER_ERROR = 'SERVER_ERROR',

  // Parse errors
  INVALID_YAML = 'INVALID_YAML',
  INVALID_SPEC = 'INVALID_SPEC',
  PARSE_ERROR = 'PARSE_ERROR',

  // Cache errors
  CACHE_READ_ERROR = 'CACHE_READ_ERROR',
  CACHE_WRITE_ERROR = 'CACHE_WRITE_ERROR',
  CACHE_CORRUPTION = 'CACHE_CORRUPTION',

  // Component errors
  COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND',
  INVALID_COMPONENT_PATH = 'INVALID_COMPONENT_PATH',
  VERSION_NOT_FOUND = 'VERSION_NOT_FOUND',

  // Configuration errors
  MISSING_TOKEN = 'MISSING_TOKEN',
  INVALID_CONFIG = 'INVALID_CONFIG',
  INVALID_URL = 'INVALID_URL',

  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  OPERATION_CANCELLED = 'OPERATION_CANCELLED'
}

export class GitLabComponentError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: any;
  public readonly recoverable: boolean;
  public readonly userMessage: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      details?: any;
      recoverable?: boolean;
      userMessage?: string;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = 'GitLabComponentError';
    this.code = code;
    this.details = options.details;
    this.recoverable = options.recoverable ?? false;
    this.userMessage = options.userMessage || this.getDefaultUserMessage(code);

    if (options.cause) {
      this.stack = `${this.stack}\nCaused by: ${options.cause.stack}`;
    }
  }

  private getDefaultUserMessage(code: ErrorCode): string {
    switch (code) {
      case ErrorCode.NETWORK_ERROR:
        return 'Network connection failed. Please check your internet connection.';
      case ErrorCode.TIMEOUT:
        return 'Request timed out. The GitLab server may be slow or unreachable.';
      case ErrorCode.RATE_LIMIT:
        return 'Rate limit exceeded. Please wait a moment before trying again.';
      case ErrorCode.UNAUTHORIZED:
        return 'Authentication failed. Please check your GitLab token.';
      case ErrorCode.NOT_FOUND:
        return 'Resource not found. The component or project may not exist.';
      case ErrorCode.SERVER_ERROR:
        return 'GitLab server error. Please try again later.';
      case ErrorCode.INVALID_YAML:
        return 'Invalid YAML syntax in component specification.';
      case ErrorCode.INVALID_SPEC:
        return 'Component specification is invalid or incomplete.';
      case ErrorCode.PARSE_ERROR:
        return 'Failed to parse component data.';
      case ErrorCode.CACHE_READ_ERROR:
        return 'Failed to read from cache. Cache will be rebuilt.';
      case ErrorCode.CACHE_WRITE_ERROR:
        return 'Failed to write to cache. Changes may not persist.';
      case ErrorCode.COMPONENT_NOT_FOUND:
        return 'Component not found in the specified location.';
      case ErrorCode.INVALID_COMPONENT_PATH:
        return 'Invalid component path format.';
      case ErrorCode.VERSION_NOT_FOUND:
        return 'Specified version not found for this component.';
      case ErrorCode.MISSING_TOKEN:
        return 'GitLab token not configured. Please add your token in settings.';
      case ErrorCode.INVALID_CONFIG:
        return 'Extension configuration is invalid. Please check your settings.';
      case ErrorCode.OPERATION_CANCELLED:
        return 'Operation was cancelled.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      recoverable: this.recoverable,
      details: this.details
    };
  }
}

export class NetworkError extends GitLabComponentError {
  constructor(message: string, options: { statusCode?: number; cause?: Error } = {}) {
    const code = options.statusCode
      ? NetworkError.codeFromStatus(options.statusCode)
      : ErrorCode.NETWORK_ERROR;

    super(code, message, {
      details: { statusCode: options.statusCode },
      recoverable: code !== ErrorCode.UNAUTHORIZED,
      cause: options.cause
    });
  }

  private static codeFromStatus(statusCode: number): ErrorCode {
    if (statusCode === 401 || statusCode === 403) {
      return ErrorCode.UNAUTHORIZED;
    }
    if (statusCode === 404) {
      return ErrorCode.NOT_FOUND;
    }
    if (statusCode === 429) {
      return ErrorCode.RATE_LIMIT;
    }
    if (statusCode >= 500) {
      return ErrorCode.SERVER_ERROR;
    }
    return ErrorCode.NETWORK_ERROR;
  }
}

export class ParseError extends GitLabComponentError {
  constructor(message: string, options: { cause?: Error; yaml?: string } = {}) {
    super(ErrorCode.PARSE_ERROR, message, {
      details: { yaml: options.yaml },
      recoverable: false,
      cause: options.cause
    });
  }
}

export class CacheError extends GitLabComponentError {
  constructor(
    operation: 'read' | 'write',
    message: string,
    options: { cause?: Error; key?: string } = {}
  ) {
    const code = operation === 'read'
      ? ErrorCode.CACHE_READ_ERROR
      : ErrorCode.CACHE_WRITE_ERROR;

    super(code, message, {
      details: { operation, key: options.key },
      recoverable: true,
      cause: options.cause
    });
  }
}

export class ComponentError extends GitLabComponentError {
  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      componentPath?: string;
      version?: string;
      cause?: Error;
    } = {}
  ) {
    super(
      options.code || ErrorCode.COMPONENT_NOT_FOUND,
      message,
      {
        details: {
          componentPath: options.componentPath,
          version: options.version
        },
        recoverable: options.code !== ErrorCode.INVALID_COMPONENT_PATH,
        cause: options.cause
      }
    );
  }
}

export class ConfigurationError extends GitLabComponentError {
  constructor(message: string, options: { setting?: string; cause?: Error } = {}) {
    super(ErrorCode.INVALID_CONFIG, message, {
      details: { setting: options.setting },
      recoverable: false,
      cause: options.cause
    });
  }
}
