import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { GitLabComponentError, ErrorCode, NetworkError } from './types';

export interface ErrorHandlerOptions {
  showNotification?: boolean;
  logError?: boolean;
  throwError?: boolean;
  fallbackValue?: any;
  context?: string;
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private logger = Logger.getInstance();

  private constructor() {}

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Handle an error with consistent logging and user notification
   */
  async handle<T = void>(
    error: unknown,
    options: ErrorHandlerOptions = {}
  ): Promise<T | undefined> {
    const {
      showNotification = true,
      logError = true,
      throwError = false,
      fallbackValue,
      context
    } = options;

    const gitlabError = this.normalizeError(error, context);

    // Log error
    if (logError) {
      this.logError(gitlabError, context);
    }

    // Show notification to user
    if (showNotification) {
      await this.showErrorNotification(gitlabError);
    }

    // Re-throw if requested
    if (throwError) {
      throw gitlabError;
    }

    // Return fallback value
    return fallbackValue;
  }

  /**
   * Wrap an async operation with error handling
   */
  async wrap<T>(
    operation: () => Promise<T>,
    options: ErrorHandlerOptions = {}
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      return this.handle<T>(error, options);
    }
  }

  /**
   * Wrap a sync operation with error handling
   */
  wrapSync<T>(
    operation: () => T,
    options: ErrorHandlerOptions = {}
  ): T | undefined {
    try {
      return operation();
    } catch (error) {
      // Handle synchronously by not awaiting
      this.handle<T>(error, options);
      return options.fallbackValue;
    }
  }

  /**
   * Convert unknown error to GitLabComponentError
   */
  private normalizeError(error: unknown, context?: string): GitLabComponentError {
    if (error instanceof GitLabComponentError) {
      return error;
    }

    if (error instanceof Error) {
      // Check for specific error patterns
      if (this.isNetworkError(error)) {
        return new NetworkError(error.message, { cause: error });
      }

      if (this.isTimeoutError(error)) {
        return new GitLabComponentError(
          ErrorCode.TIMEOUT,
          error.message,
          { cause: error, recoverable: true }
        );
      }

      if (this.isYAMLError(error)) {
        return new GitLabComponentError(
          ErrorCode.INVALID_YAML,
          error.message,
          { cause: error, recoverable: false }
        );
      }

      // Generic error
      const message = context
        ? `${context}: ${error.message}`
        : error.message;

      return new GitLabComponentError(
        ErrorCode.UNKNOWN_ERROR,
        message,
        { cause: error, recoverable: false }
      );
    }

    // Unknown error type
    return new GitLabComponentError(
      ErrorCode.UNKNOWN_ERROR,
      String(error),
      { recoverable: false }
    );
  }

  /**
   * Log error with appropriate level
   */
  private logError(error: GitLabComponentError, context?: string): void {
    const prefix = context ? `[${context}]` : '';
    const message = `${prefix} ${error.code}: ${error.message}`;

    if (error.recoverable) {
      this.logger.warn(message, error.details);
    } else {
      this.logger.error(message, error.details);
    }

    // Log full stack trace at debug level
    if (error.stack) {
      this.logger.debug(error.stack);
    }
  }

  /**
   * Show error notification to user
   */
  private async showErrorNotification(error: GitLabComponentError): Promise<void> {
    const actions = this.getErrorActions(error);

    if (error.recoverable) {
      const selection = await vscode.window.showWarningMessage(
        error.userMessage,
        ...actions
      );
      await this.handleAction(selection, error);
    } else {
      const selection = await vscode.window.showErrorMessage(
        error.userMessage,
        ...actions
      );
      await this.handleAction(selection, error);
    }
  }

  /**
   * Get contextual actions for error
   */
  private getErrorActions(error: GitLabComponentError): string[] {
    const actions: string[] = [];

    switch (error.code) {
      case ErrorCode.UNAUTHORIZED:
      case ErrorCode.MISSING_TOKEN:
        actions.push('Configure Token', 'Open Settings');
        break;
      case ErrorCode.RATE_LIMIT:
        actions.push('Retry Later');
        break;
      case ErrorCode.NETWORK_ERROR:
      case ErrorCode.TIMEOUT:
        actions.push('Retry', 'Check Connection');
        break;
      case ErrorCode.COMPONENT_NOT_FOUND:
        actions.push('Browse Components');
        break;
      case ErrorCode.CACHE_CORRUPTION:
      case ErrorCode.CACHE_READ_ERROR:
        actions.push('Reset Cache');
        break;
      case ErrorCode.INVALID_CONFIG:
        actions.push('Open Settings');
        break;
      default:
        actions.push('View Logs');
    }

    return actions;
  }

  /**
   * Handle user action selection
   */
  private async handleAction(
    action: string | undefined,
    error: GitLabComponentError
  ): Promise<void> {
    if (!action) {
      return;
    }

    switch (action) {
      case 'Configure Token':
        await vscode.commands.executeCommand('gitlabComponentHelper.addProjectToken');
        break;
      case 'Open Settings':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'gitlabComponentHelper'
        );
        break;
      case 'Reset Cache':
        await vscode.commands.executeCommand('gitlab-component-helper.resetCache');
        break;
      case 'Browse Components':
        await vscode.commands.executeCommand('gitlab-component-helper.browseComponents');
        break;
      case 'View Logs':
        this.logger.showOutput();
        break;
      case 'Retry':
        // Caller should implement retry logic
        break;
    }
  }

  /**
   * Check if error is a network error
   */
  private isNetworkError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('econnreset') ||
      message.includes('http')
    );
  }

  /**
   * Check if error is a timeout error
   */
  private isTimeoutError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('timeout') || message.includes('etimedout');
  }

  /**
   * Check if error is a YAML parsing error
   */
  private isYAMLError(error: Error): boolean {
    return (
      error.name === 'YAMLException' ||
      error.name === 'YAMLParseError' ||
      error.message.includes('YAML')
    );
  }

  /**
   * Create error from HTTP status code
   */
  createHttpError(statusCode: number, message?: string): NetworkError {
    const defaultMessage = message || `HTTP ${statusCode} error`;
    return new NetworkError(defaultMessage, { statusCode });
  }

  /**
   * Check if error is recoverable
   */
  isRecoverable(error: unknown): boolean {
    if (error instanceof GitLabComponentError) {
      return error.recoverable;
    }
    return false;
  }

  /**
   * Format error for display
   */
  formatError(error: unknown): string {
    const gitlabError = this.normalizeError(error);
    return `${gitlabError.code}: ${gitlabError.userMessage}`;
  }
}

/**
 * Helper function to get error handler instance
 */
export function getErrorHandler(): ErrorHandler {
  return ErrorHandler.getInstance();
}

/**
 * Decorator for error handling
 */
export function handleErrors(options: ErrorHandlerOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const handler = getErrorHandler();
      return handler.wrap(
        () => originalMethod.apply(this, args),
        { ...options, context: `${target.constructor.name}.${propertyKey}` }
      );
    };

    return descriptor;
  };
}
