"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorHandler = void 0;
exports.getErrorHandler = getErrorHandler;
exports.handleErrors = handleErrors;
const vscode = __importStar(require("vscode"));
const logger_1 = require("../utils/logger");
const types_1 = require("./types");
class ErrorHandler {
    constructor() {
        this.logger = logger_1.Logger.getInstance();
    }
    static getInstance() {
        if (!ErrorHandler.instance) {
            ErrorHandler.instance = new ErrorHandler();
        }
        return ErrorHandler.instance;
    }
    /**
     * Handle an error with consistent logging and user notification
     */
    async handle(error, options = {}) {
        const { showNotification = true, logError = true, throwError = false, fallbackValue, context } = options;
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
    async wrap(operation, options = {}) {
        try {
            return await operation();
        }
        catch (error) {
            return this.handle(error, options);
        }
    }
    /**
     * Wrap a sync operation with error handling
     */
    wrapSync(operation, options = {}) {
        try {
            return operation();
        }
        catch (error) {
            // Handle synchronously by not awaiting
            this.handle(error, options);
            return options.fallbackValue;
        }
    }
    /**
     * Convert unknown error to GitLabComponentError
     */
    normalizeError(error, context) {
        if (error instanceof types_1.GitLabComponentError) {
            return error;
        }
        if (error instanceof Error) {
            // Check for specific error patterns
            if (this.isNetworkError(error)) {
                return new types_1.NetworkError(error.message, { cause: error });
            }
            if (this.isTimeoutError(error)) {
                return new types_1.GitLabComponentError(types_1.ErrorCode.TIMEOUT, error.message, { cause: error, recoverable: true });
            }
            if (this.isYAMLError(error)) {
                return new types_1.GitLabComponentError(types_1.ErrorCode.INVALID_YAML, error.message, { cause: error, recoverable: false });
            }
            // Generic error
            const message = context
                ? `${context}: ${error.message}`
                : error.message;
            return new types_1.GitLabComponentError(types_1.ErrorCode.UNKNOWN_ERROR, message, { cause: error, recoverable: false });
        }
        // Unknown error type
        return new types_1.GitLabComponentError(types_1.ErrorCode.UNKNOWN_ERROR, String(error), { recoverable: false });
    }
    /**
     * Log error with appropriate level
     */
    logError(error, context) {
        const prefix = context ? `[${context}]` : '';
        const message = `${prefix} ${error.code}: ${error.message}`;
        if (error.recoverable) {
            this.logger.warn(message, error.details);
        }
        else {
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
    async showErrorNotification(error) {
        const actions = this.getErrorActions(error);
        if (error.recoverable) {
            const selection = await vscode.window.showWarningMessage(error.userMessage, ...actions);
            await this.handleAction(selection, error);
        }
        else {
            const selection = await vscode.window.showErrorMessage(error.userMessage, ...actions);
            await this.handleAction(selection, error);
        }
    }
    /**
     * Get contextual actions for error
     */
    getErrorActions(error) {
        const actions = [];
        switch (error.code) {
            case types_1.ErrorCode.UNAUTHORIZED:
            case types_1.ErrorCode.MISSING_TOKEN:
                actions.push('Configure Token', 'Open Settings');
                break;
            case types_1.ErrorCode.RATE_LIMIT:
                actions.push('Retry Later');
                break;
            case types_1.ErrorCode.NETWORK_ERROR:
            case types_1.ErrorCode.TIMEOUT:
                actions.push('Retry', 'Check Connection');
                break;
            case types_1.ErrorCode.COMPONENT_NOT_FOUND:
                actions.push('Browse Components');
                break;
            case types_1.ErrorCode.CACHE_CORRUPTION:
            case types_1.ErrorCode.CACHE_READ_ERROR:
                actions.push('Reset Cache');
                break;
            case types_1.ErrorCode.INVALID_CONFIG:
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
    async handleAction(action, error) {
        if (!action) {
            return;
        }
        switch (action) {
            case 'Configure Token':
                await vscode.commands.executeCommand('gitlabComponentHelper.addProjectToken');
                break;
            case 'Open Settings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'gitlabComponentHelper');
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
    isNetworkError(error) {
        const message = error.message.toLowerCase();
        return (message.includes('network') ||
            message.includes('econnrefused') ||
            message.includes('enotfound') ||
            message.includes('econnreset') ||
            message.includes('http'));
    }
    /**
     * Check if error is a timeout error
     */
    isTimeoutError(error) {
        const message = error.message.toLowerCase();
        return message.includes('timeout') || message.includes('etimedout');
    }
    /**
     * Check if error is a YAML parsing error
     */
    isYAMLError(error) {
        return (error.name === 'YAMLException' ||
            error.name === 'YAMLParseError' ||
            error.message.includes('YAML'));
    }
    /**
     * Create error from HTTP status code
     */
    createHttpError(statusCode, message) {
        const defaultMessage = message || `HTTP ${statusCode} error`;
        return new types_1.NetworkError(defaultMessage, { statusCode });
    }
    /**
     * Check if error is recoverable
     */
    isRecoverable(error) {
        if (error instanceof types_1.GitLabComponentError) {
            return error.recoverable;
        }
        return false;
    }
    /**
     * Format error for display
     */
    formatError(error) {
        const gitlabError = this.normalizeError(error);
        return `${gitlabError.code}: ${gitlabError.userMessage}`;
    }
}
exports.ErrorHandler = ErrorHandler;
/**
 * Helper function to get error handler instance
 */
function getErrorHandler() {
    return ErrorHandler.getInstance();
}
/**
 * Decorator for error handling
 */
function handleErrors(options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args) {
            const handler = getErrorHandler();
            return handler.wrap(() => originalMethod.apply(this, args), { ...options, context: `${target.constructor.name}.${propertyKey}` });
        };
        return descriptor;
    };
}
//# sourceMappingURL=handler.js.map