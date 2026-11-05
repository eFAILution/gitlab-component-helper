import { CONFIG_DEFAULTS } from '../core/config/defaults';
import { getRuntime } from '../core/runtime';
import type { LogLevelName } from '../core/ports';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

// Matches the precision `console.timeEnd` used before timings went through the log sink.
const TIMER_DECIMALS = 3;

export class Logger {
  private static instance: Logger;
  private currentLevel: LogLevel = LogLevel.ERROR;
  private isLevelLoaded: boolean = false;
  private isDevelopmentMode: boolean = false;
  private readonly timers = new Map<string, number>();

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Flag an extension development host: the level line gets a `[DEV MODE]` tag and the output never auto-shows.
   */
  setDevelopmentMode(enabled: boolean): void {
    this.isDevelopmentMode = enabled;
  }

  /**
   * Re-read `logLevel` and `autoShowOutput` from the runtime config. Hosts call this after installing their runtime
   * and whenever either setting changes. The first log call loads the level if no host has.
   *
   * @param showOutput Reveal the log afterwards, if `autoShowOutput` is on and this isn't a development host.
   */
  reloadLogLevel(showOutput: boolean = false): void {
    const { config, log } = getRuntime();
    const levelString = config.get<string>('logLevel', CONFIG_DEFAULTS.logLevel);
    const autoShowOutput = config.get<boolean>('autoShowOutput', CONFIG_DEFAULTS.autoShowOutput);
    this.isLevelLoaded = true;

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
      log.show?.(true);
    }

    const levelName = LogLevel[this.currentLevel];
    const devMode = this.isDevelopmentMode ? ' [DEV MODE]' : '';
    const msg = `[Logger] Log level updated to: ${levelString} (normalized: ${normalizedLevel}, actual: ${levelName}, numeric: ${this.currentLevel})${devMode}`;
    log.appendLine(msg);
  }

  // Public method to explicitly show output channel (for commands that need it)
  public showOutput(): void {
    getRuntime().log.show?.(true);
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.isLevelLoaded) {
      this.reloadLogLevel(false);
    }
    return level >= this.currentLevel;
  }

  private formatMessage(level: string, component: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${component}] ${message}`;
  }

  private write(level: LogLevelName, component: string, message: string): void {
    getRuntime().log.appendLine(this.formatMessage(level, component, message), level);
  }

  debug(message: string, component: string = 'ComponentService'): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.write('DEBUG', component, message);
    }
  }

  info(message: string, component: string = 'ComponentService'): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.write('INFO', component, message);
    }
  }

  warn(message: string, component: string = 'ComponentService'): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.write('WARN', component, message);
    }
  }

  error(message: string, component: string = 'ComponentService'): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.write('ERROR', component, message);
    }
  }

  // Performance timing utilities. These used to print via console.time on stdout, which the MCP server reserves
  // for protocol messages, so they now log at DEBUG through the sink.
  time(label: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.timers.set(label, performance.now());
    }
  }

  timeEnd(label: string): void {
    const start = this.timers.get(label);
    this.timers.delete(label);
    if (start === undefined) return;
    this.debug(`${label}: ${(performance.now() - start).toFixed(TIMER_DECIMALS)}ms`, 'ComponentService');
  }

  // Structured logging for performance metrics
  logPerformance(operation: string, duration: number, details?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const detailsStr = details ? ` | ${JSON.stringify(details)}` : '';
      this.info(`Performance: ${operation} completed in ${duration}ms${detailsStr}`, 'Performance');
    }
  }
}
