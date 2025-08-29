import * as vscode from 'vscode';
import { outputChannel } from './outputChannel';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static instance: Logger;
  private currentLevel: LogLevel = LogLevel.ERROR;
  private isInitialized: boolean = false;
  private isDevelopmentMode: boolean = false;

  private constructor() {
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
  }  private isInDevelopmentMode(): boolean {
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
        extensionPath?.includes('gitlab-component-helper')
      );
    } catch {
      return false;
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private updateLogLevel(showOutput: boolean = false): void {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const levelString = config.get<string>('logLevel', 'ERROR');
    const autoShowOutput = config.get<boolean>('autoShowOutput', false);

    // Make log level case-insensitive with explicit mapping
    const normalizedLevel = levelString.toUpperCase();
    let newLevel: LogLevel;

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
      outputChannel.show(true);
    }

    const levelName = LogLevel[this.currentLevel];
    const devMode = this.isDevelopmentMode ? ' [DEV MODE]' : '';
    const msg = `[Logger] Log level updated to: ${levelString} (normalized: ${normalizedLevel}, actual: ${levelName}, numeric: ${this.currentLevel})${devMode}`;
    outputChannel.appendLine(msg);
  }

  // Public method to explicitly show output channel (for commands that need it)
  public showOutput(): void {
    outputChannel.show(true);
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.currentLevel;
  }

  private formatMessage(level: string, component: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${component}] ${message}`;
  }

  debug(message: string, component: string = 'ComponentService'): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const formatted = this.formatMessage('DEBUG', component, message);
      outputChannel.appendLine(formatted);
    }
  }

  info(message: string, component: string = 'ComponentService'): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const formatted = this.formatMessage('INFO', component, message);
      outputChannel.appendLine(formatted);
    }
  }

  warn(message: string, component: string = 'ComponentService'): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const formatted = this.formatMessage('WARN', component, message);
      outputChannel.appendLine(formatted);
      console.warn(formatted);
    }
  }

  error(message: string, component: string = 'ComponentService'): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const formatted = this.formatMessage('ERROR', component, message);
      outputChannel.appendLine(formatted);
      console.error(formatted);
    }
  }

  // Performance timing utilities
  time(label: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.time(`[ComponentService] ${label}`);
    }
  }

  timeEnd(label: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.timeEnd(`[ComponentService] ${label}`);
    }
  }

  // Structured logging for performance metrics
  logPerformance(operation: string, duration: number, details?: Record<string, any>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const detailsStr = details ? ` | ${JSON.stringify(details)}` : '';
      this.info(`Performance: ${operation} completed in ${duration}ms${detailsStr}`, 'Performance');
    }
  }
}
