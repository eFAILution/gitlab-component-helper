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
  private currentLevel: LogLevel = LogLevel.INFO;

  private constructor() {
    this.updateLogLevel();

    // Watch for configuration changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gitlabComponentHelper.logLevel')) {
        this.updateLogLevel();
      }
    });
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private updateLogLevel(): void {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const levelString = config.get<string>('logLevel', 'INFO');

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

    outputChannel.show(true); // Always show output when log level changes
    const levelName = LogLevel[this.currentLevel];
    const msg = `[Logger] Log level updated to: ${levelString} (normalized: ${normalizedLevel}, actual: ${levelName}, numeric: ${this.currentLevel})`;
    outputChannel.appendLine(msg);
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
