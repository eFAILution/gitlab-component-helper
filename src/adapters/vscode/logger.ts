import * as vscode from 'vscode';
import { CONFIG_SECTION } from '../../core/config/defaults';
import type { LogSink } from '../../core/ports';
import type { Logger } from '../../utils/logger';

const OUTPUT_CHANNEL_NAME = 'GitLab Component Helper';
const EXTENSION_ID = 'efailution.gitlab-component-helper';

/** Log lines go to the extension's output channel; warnings and errors also go to the developer console. */
export function createOutputChannelSink(): LogSink {
  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  return {
    appendLine: (line, level) => {
      channel.appendLine(line);
      if (level === 'WARN') console.warn(line);
      if (level === 'ERROR') console.error(line);
    },
    show: (preserveFocus) => channel.show(preserveFocus),
  };
}

function isInDevelopmentMode(): boolean {
  try {
    // Check if we're running in extension development mode
    // In development, the extension runs from source and has different characteristics
    const extensionPath = vscode.extensions.getExtension(EXTENSION_ID)?.extensionPath;
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

/**
 * Load the logger's level from the workspace settings and keep it current as they change. Call after `setRuntime`.
 *
 * @returns The settings watcher, for `context.subscriptions`.
 */
export function attachLoggerToSettings(logger: Logger): vscode.Disposable {
  logger.setDevelopmentMode(isInDevelopmentMode());
  logger.reloadLogLevel(false); // Don't show output channel during initialization
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(`${CONFIG_SECTION}.logLevel`) ||
        e.affectsConfiguration(`${CONFIG_SECTION}.autoShowOutput`)) {
      logger.reloadLogLevel(true); // reloadLogLevel never shows output in dev mode
    }
  });
}
