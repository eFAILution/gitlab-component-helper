"use strict";
/**
 * Centralized error handling for GitLab Component Helper
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleErrors = exports.getErrorHandler = exports.ErrorHandler = exports.ConfigurationError = exports.ComponentError = exports.CacheError = exports.ParseError = exports.NetworkError = exports.GitLabComponentError = exports.ErrorCode = void 0;
var types_1 = require("./types");
Object.defineProperty(exports, "ErrorCode", { enumerable: true, get: function () { return types_1.ErrorCode; } });
Object.defineProperty(exports, "GitLabComponentError", { enumerable: true, get: function () { return types_1.GitLabComponentError; } });
Object.defineProperty(exports, "NetworkError", { enumerable: true, get: function () { return types_1.NetworkError; } });
Object.defineProperty(exports, "ParseError", { enumerable: true, get: function () { return types_1.ParseError; } });
Object.defineProperty(exports, "CacheError", { enumerable: true, get: function () { return types_1.CacheError; } });
Object.defineProperty(exports, "ComponentError", { enumerable: true, get: function () { return types_1.ComponentError; } });
Object.defineProperty(exports, "ConfigurationError", { enumerable: true, get: function () { return types_1.ConfigurationError; } });
var handler_1 = require("./handler");
Object.defineProperty(exports, "ErrorHandler", { enumerable: true, get: function () { return handler_1.ErrorHandler; } });
Object.defineProperty(exports, "getErrorHandler", { enumerable: true, get: function () { return handler_1.getErrorHandler; } });
Object.defineProperty(exports, "handleErrors", { enumerable: true, get: function () { return handler_1.handleErrors; } });
//# sourceMappingURL=index.js.map