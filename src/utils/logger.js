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
exports.Logger = exports.LogLevel = void 0;
const vscode = __importStar(require("vscode"));
const outputChannel_1 = require("./outputChannel");
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
class Logger {
    constructor() {
        this.currentLevel = LogLevel.ERROR;
        this.isInitialized = false;
        this.isDevelopmentMode = false;
        // Detect if we're in development mode (extension debugging)
        this.isDevelopmentMode = this.isInDevelopmentMode();
        this.updateLogLevel(false); // Don't show output channel during initialization
        // Watch for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gitlabComponentHelper.logLevel') ||
                e.affectsConfiguration('gitlabComponentHelper.autoShowOutput')) {
                this.updateLogLevel(!this.isDevelopmentMode); // Don't show output in dev mode
            }
        });
        this.isInitialized = true;
    }
    isInDevelopmentMode() {
        try {
            // Check if we're running in extension development mode
            // In development, the extension runs from source and has different characteristics
            const extensionPath = vscode.extensions.getExtension('efailution.gitlab-component-helper')?.extensionPath;
            return Boolean(
            // Check for common development indicators
            process.env.NODE_ENV === 'development' ||
                extensionPath?.includes('src') ||
                extensionPath?.includes('.vscode') ||
                // Extension development path typically includes the workspace folder
                extensionPath?.includes('gitlab-component-helper'));
        }
        catch {
            return false;
        }
    }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    updateLogLevel(showOutput = false) {
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const levelString = config.get('logLevel', 'ERROR');
        const autoShowOutput = config.get('autoShowOutput', false);
        // Make log level case-insensitive with explicit mapping
        const normalizedLevel = levelString.toUpperCase();
        let newLevel;
        switch (normalizedLevel) {
            case 'DEBUG':
                newLevel = LogLevel.DEBUG;
                break;
            case 'INFO':
                newLevel = LogLevel.INFO;
                break;
            case 'WARN':
                newLevel = LogLevel.WARN;
                break;
            case 'ERROR':
                newLevel = LogLevel.ERROR;
                break;
            default:
                newLevel = LogLevel.INFO;
                break;
        }
        this.currentLevel = newLevel;
        // Only show output when:
        // 1. Explicitly requested AND
        // 2. Not in development mode AND
        // 3. Auto show setting is enabled
        if (showOutput && !this.isDevelopmentMode && autoShowOutput) {
            outputChannel_1.outputChannel.show(true);
        }
        const levelName = LogLevel[this.currentLevel];
        const devMode = this.isDevelopmentMode ? ' [DEV MODE]' : '';
        const msg = `[Logger] Log level updated to: ${levelString} (normalized: ${normalizedLevel}, actual: ${levelName}, numeric: ${this.currentLevel})${devMode}`;
        outputChannel_1.outputChannel.appendLine(msg);
    }
    // Public method to explicitly show output channel (for commands that need it)
    showOutput() {
        outputChannel_1.outputChannel.show(true);
    }
    shouldLog(level) {
        return level >= this.currentLevel;
    }
    formatMessage(level, component, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] [${component}] ${message}`;
    }
    debug(message, component = 'ComponentService') {
        if (this.shouldLog(LogLevel.DEBUG)) {
            const formatted = this.formatMessage('DEBUG', component, message);
            outputChannel_1.outputChannel.appendLine(formatted);
        }
    }
    info(message, component = 'ComponentService') {
        if (this.shouldLog(LogLevel.INFO)) {
            const formatted = this.formatMessage('INFO', component, message);
            outputChannel_1.outputChannel.appendLine(formatted);
        }
    }
    warn(message, component = 'ComponentService') {
        if (this.shouldLog(LogLevel.WARN)) {
            const formatted = this.formatMessage('WARN', component, message);
            outputChannel_1.outputChannel.appendLine(formatted);
            console.warn(formatted);
        }
    }
    error(message, component = 'ComponentService') {
        if (this.shouldLog(LogLevel.ERROR)) {
            const formatted = this.formatMessage('ERROR', component, message);
            outputChannel_1.outputChannel.appendLine(formatted);
            console.error(formatted);
        }
    }
    // Performance timing utilities
    time(label) {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.time(`[ComponentService] ${label}`);
        }
    }
    timeEnd(label) {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.timeEnd(`[ComponentService] ${label}`);
        }
    }
    // Structured logging for performance metrics
    logPerformance(operation, duration, details) {
        if (this.shouldLog(LogLevel.INFO)) {
            const detailsStr = details ? ` | ${JSON.stringify(details)}` : '';
            this.info(`Performance: ${operation} completed in ${duration}ms${detailsStr}`, 'Performance');
        }
    }
}
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map