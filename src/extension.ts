import { registerAddProjectTokenCommand, getComponentService } from './services/component';
import * as vscode from 'vscode';
import { HoverProvider } from './providers/hoverProvider';
import { CompletionProvider } from './providers/completionProvider';
import { ComponentBrowserProvider } from './providers/componentBrowserProvider';
import { detectIncludeComponent } from './providers/componentDetector';
import { getComponentCacheManager, ComponentCacheManager } from './services/cache/componentCacheManager';
import { Logger } from './utils/logger';
import { ValidationProvider } from './providers/validationProvider';
import { parseYaml } from './utils/yamlParser';
import { DetachedComponentTemplate } from './templates';
import { getPerformanceMonitor } from './utils/performanceMonitor';

// Constants for timing delays
const PANEL_FOCUS_DELAY_MS = 100;

export function activate(context: vscode.ExtensionContext) {
  const logger = Logger.getInstance();
  logger.info('GitLab Component Helper is now active!', 'Extension');
  logger.info(`[Extension] VS Code version: ${vscode.version}`, 'Extension');
  logger.debug(`[Extension] Extension context: ${JSON.stringify({
    globalState: Object.keys(context.globalState.keys()),
    workspaceState: Object.keys(context.workspaceState.keys()),
    extensionPath: context.extensionPath,
    extensionUri: context.extensionUri.toString()
  }, null, 2)}`, 'Extension');

  try {
    logger.info('[Extension] Starting activation process...', 'Extension');
    logger.debug('[Extension] Registering commands...', 'Extension');

    // Log current user settings
    logger.debug('[Extension] Loading user settings...', 'Extension');
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const componentSources = config.get('componentSources', []);
    const cacheTime = config.get('cacheTime', 3600);
    const componentSource = config.get('componentSource', 'local');

    logger.debug(`[Extension] User settings loaded:`, 'Extension');
    logger.debug(`[Extension]   - Component sources: ${JSON.stringify(componentSources, null, 2)}`, 'Extension');
    logger.debug(`[Extension]   - Cache time: ${cacheTime} seconds`, 'Extension');
    logger.debug(`[Extension]   - Component source type: ${componentSource}`, 'Extension');

    // Initialize component cache manager (this will start loading components)
    logger.debug(`[Extension] About to import/initialize component cache manager...`, 'Extension');
    let cacheManager: ComponentCacheManager;
    try {
      cacheManager = getComponentCacheManager(context);
      logger.info(`[Extension] Component cache manager initialized successfully`, 'Extension');
    } catch (cacheError) {
      logger.error(`[Extension] ERROR initializing cache manager: ${cacheError}`, 'Extension');
      throw cacheError;
    }

    // Listen for configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('gitlabComponentHelper')) {
          logger.info(`[Extension] Configuration changed, reloading settings...`, 'Extension');
          const updatedConfig = vscode.workspace.getConfiguration('gitlabComponentHelper');
          const updatedSources = updatedConfig.get('componentSources', []);
          logger.debug(`[Extension] Updated component sources: ${JSON.stringify(updatedSources, null, 2)}`, 'Extension');
        }
      })
    );

    // Register hover provider for GitLab CI files (broad registration, providers will filter)
    logger.debug('[Extension] Registering hover provider...', 'Extension');
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        [
          { language: 'yaml' },
          { language: 'gitlab-ci' },
          { language: 'shellscript' }
        ],
        new HoverProvider()
      )
    );

    // Register completion provider for GitLab CI files (broad registration, providers will filter)
    logger.debug('[Extension] Registering completion provider...', 'Extension');
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        [
          { language: 'yaml' },
          { language: 'gitlab-ci' },
          { language: 'shellscript' }
        ],
        new CompletionProvider(),
        ':', ' ', '@'  // Add @ as a trigger character for version completions
      )
    );

    // Register command to add project/group token
    logger.debug('[Extension] Registering addProjectToken command...', 'Extension');
    const service = getComponentService();
    service.setSecretStorage(context.secrets);
    registerAddProjectTokenCommand(context, service);

    // Register component browser command
    logger.debug('[Extension] Registering browseComponents command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.browseComponents', async () => {
        // Get the active text editor
        const editor = vscode.window.activeTextEditor;
        let componentContext;

        if (editor) {
          // Try to find a component at the cursor position
          const document = editor.document;
          const position = editor.selection.active;

          // Use the existing detectIncludeComponent function
          const component = await detectIncludeComponent(document, position);

          if (component && component.context) {
            // Extract context from the component if it exists
            componentContext = component.context;
            logger.debug(`[Extension] Found component context: ${componentContext.gitlabInstance}/${componentContext.path}`, 'Extension');
          }
        }

        // Create and show the browser with the context
        const componentBrowser = new ComponentBrowserProvider(context, cacheManager);
        await componentBrowser.show(componentContext);
      })
    );

    // Register command to refresh component cache
    logger.debug('[Extension] Registering refreshComponents command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.refreshComponents', async () => {
        logger.info(`[Extension] Manual refresh requested`, 'Extension');
        await cacheManager.forceRefresh();
        vscode.window.showInformationMessage('GitLab components refreshed successfully!');
      })
    );

    // Register command to update cache (forces refresh of all data)
    logger.debug('[Extension] Registering updateCache command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.updateCache', async () => {
        logger.info(`[Extension] Update cache requested`, 'Extension');

        // Show progress indicator
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Updating GitLab Component Cache",
          cancellable: false
        }, async (progress) => {
          progress.report({ increment: 0, message: "Clearing cache and fetching fresh data..." });

          try {
            await cacheManager.updateCache();
            progress.report({ increment: 100, message: "Cache updated successfully!" });
            vscode.window.showInformationMessage('✅ GitLab component cache updated successfully!');
          } catch (error) {
            logger.error(`[Extension] Cache update failed: ${error}`, 'Extension');
            vscode.window.showErrorMessage(`❌ Failed to update cache: ${error}`);
          }
        });
      })
    );

    // Register command to reset cache (completely clears all cached data)
    logger.debug('[Extension] Registering resetCache command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.resetCache', async () => {
        logger.info(`[Extension] Reset cache requested`, 'Extension');

        // Ask for confirmation before resetting
        const confirmation = await vscode.window.showWarningMessage(
          'Are you sure you want to reset the cache? This will clear all cached components and force them to be re-downloaded.',
          { modal: true },
          'Reset Cache',
          'Cancel'
        );

        if (confirmation === 'Reset Cache') {
          // Show progress indicator
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Resetting GitLab Component Cache",
            cancellable: false
          }, async (progress) => {
            progress.report({ increment: 0, message: "Clearing all cached data..." });

            try {
              await cacheManager.resetCache();
              progress.report({ increment: 100, message: "Cache reset successfully!" });
              vscode.window.showInformationMessage('🗑️ GitLab component cache reset successfully! Cache will be rebuilt on next use.');
            } catch (error) {
              logger.error(`[Extension] Cache reset failed: ${error}`, 'Extension');
              vscode.window.showErrorMessage(`❌ Failed to reset cache: ${error}`);
            }
          });
        } else {
          logger.debug('[Extension] Cache reset cancelled by user', 'Extension');
        }
      })
    );

    // Register command to show cache status
    logger.debug('[Extension] Registering showCacheStatus command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.showCacheStatus', async () => {
        const cacheInfo = cacheManager.getCacheInfo();
        const sourceErrors = cacheManager.getSourceErrors();

        let statusMessage = `GitLab Component Helper - Cache Status\n\n`;
        statusMessage += `📍 Location: ${cacheInfo.location}\n`;
        statusMessage += `📦 Components: ${cacheInfo.size}\n`;
        statusMessage += `🕒 Last Updated: ${cacheInfo.lastUpdate}\n`;
        statusMessage += `💾 Persistence: ${cacheInfo.hasContext ? 'Enabled' : 'Disabled (memory only)'}\n`;

        if (sourceErrors.size > 0) {
          statusMessage += `\n⚠️ Source Errors:\n`;
          sourceErrors.forEach((error, source) => {
            statusMessage += `  • ${source}: ${error}\n`;
          });
        } else {
          statusMessage += `\n✅ All sources loaded successfully\n`;
        }

        statusMessage += `\nCache is stored in VS Code's global state and persists across sessions.`;

        vscode.window.showInformationMessage(statusMessage, { modal: true });
        logger.info(`[Extension] Cache status shown to user`, 'Extension');
      })
    );

    // Register command to show detailed cache debug info
    logger.debug('[Extension] Registering debugCache command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.debugCache', async () => {
        const components = await cacheManager.getComponents();
        const errors = cacheManager.getSourceErrors();

        logger.info(`[Extension] === CACHE DEBUG INFO ===`, 'Extension');
        logger.info(`[Extension] Total cached components: ${components.length}`, 'Extension');
        logger.info(`[Extension] Total source errors: ${errors.size}`, 'Extension');

        // Group components by source
        const componentsBySource = new Map<string, any[]>();
        components.forEach((comp: any) => {
          const key = comp.source;
          if (!componentsBySource.has(key)) {
            componentsBySource.set(key, []);
          }
          componentsBySource.get(key)!.push(comp);
        });

        logger.info(`[Extension] Components grouped by source:`, 'Extension');
        componentsBySource.forEach((comps: any[], source: string) => {
          logger.info(`[Extension]   ${source}: ${comps.length} components`, 'Extension');
          comps.forEach((comp: any) => {
            logger.debug(`[Extension]     - ${comp.name} (${comp.gitlabInstance}/${comp.sourcePath})`, 'Extension');
          });
        });

        logger.info(`[Extension] Source errors:`, 'Extension');
        errors.forEach((error: string, source: string) => {
          logger.warn(`[Extension]   ${source}: ${error}`, 'Extension');
        });

        logger.info(`[Extension] === END CACHE DEBUG ===`, 'Extension');
      })
    );

    // Register command to detach hover window as a dedicated panel
    logger.debug('[Extension] Registering detachHover command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.detachHover', async (component: any) => {
        logger.info(`[Extension] Detaching hover for component: ${component?.name}`, 'Extension');

        if (!component) {
          vscode.window.showErrorMessage('No component data available to detach');
          return;
        }

        // Store the current active editor before opening the panel
        const originalEditor = vscode.window.activeTextEditor;
        if (!originalEditor) {
          vscode.window.showErrorMessage('No active editor found to work with');
          return;
        }

        // Create a webview panel for the detached component details
        const panel = vscode.window.createWebviewPanel(
          'gitlabComponentDetails',
          `${component.name} - Details`,
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: []
          }
        );

        // Generate HTML content for the detached panel with interactive features
        panel.webview.html = await getDetachedComponentHtml(component);

        // Ensure the original editor remains focused after panel creation
        setTimeout(async () => {
          await vscode.window.showTextDocument(originalEditor.document, {
            viewColumn: originalEditor.viewColumn,
            preserveFocus: false
          });
        }, PANEL_FOCUS_DELAY_MS);

        // Handle messages from the detached webview
        panel.webview.onDidReceiveMessage(async (message) => {
          switch (message.command) {
            case 'insertComponent':
              try {
                // Ensure the original editor is active and focused
                await vscode.window.showTextDocument(originalEditor.document, originalEditor.viewColumn);

                // Wait a brief moment for the editor to fully activate
                await new Promise(resolve => setTimeout(resolve, PANEL_FOCUS_DELAY_MS));

                // Verify we have the correct active editor
                const currentEditor = vscode.window.activeTextEditor;
                if (!currentEditor || currentEditor.document.uri.toString() !== originalEditor.document.uri.toString()) {
                  vscode.window.showErrorMessage('Could not activate the original editor');
                  return;
                }

                const componentBrowser = new ComponentBrowserProvider(context, cacheManager);

                // Check if we have hover context (editing existing component)
                if (component._hoverContext) {
                  // Edit the existing component at the hover position
                  await componentBrowser.editExistingComponentFromDetached(
                    component,
                    component._hoverContext.documentUri,
                    component._hoverContext.position,
                    message.includeInputs || false,
                    message.selectedInputs || []
                  );
                } else {
                  // Insert new component at cursor position
                  await componentBrowser.insertComponentFromDetached(
                    component,
                    message.includeInputs || false,
                    message.selectedInputs || []
                  );
                }

                // Close the panel after successful insertion/edit
                panel.dispose();
              } catch (error) {
                logger.error(`[Extension] Error inserting component from detached view: ${error}`, 'Extension');
                vscode.window.showErrorMessage(`Error inserting component: ${error}`);
              }
              break;
          }
        });
      })
    );

    // Register command to test providers for debugging
    logger.debug('[Extension] Registering testProviders command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.testProviders', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor');
          return;
        }

        logger.info('[Extension] === PROVIDER TEST ===', 'Extension');
        logger.info(`[Extension] Current file: ${editor.document.fileName}`, 'Extension');
        logger.info(`[Extension] File language: ${editor.document.languageId}`, 'Extension');
        logger.info(`[Extension] Current position: Line ${editor.selection.active.line + 1}, Column ${editor.selection.active.character + 1}`, 'Extension');

        // Test hover provider manually
        const hoverProvider = new HoverProvider();
        try {
          const hover = await hoverProvider.provideHover(editor.document, editor.selection.active);
          logger.info(`[Extension] Hover provider result: ${hover ? 'Found hover content' : 'No hover content'}`, 'Extension');
          if (hover) {
            logger.debug(`[Extension] Hover content: ${hover.contents.map(c => typeof c === 'string' ? c : c.value).join('\n')}`, 'Extension');
          }
        } catch (error) {
          logger.error(`[Extension] Hover provider error: ${error}`, 'Extension');
        }

        // Test completion provider manually
        const completionProvider = new CompletionProvider();
        try {
          const completions = await completionProvider.provideCompletionItems(
            editor.document,
            editor.selection.active,
            new vscode.CancellationTokenSource().token,
            { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined }
          );
          logger.info(`[Extension] Completion provider result: ${completions ? (Array.isArray(completions) ? completions.length : completions.items.length) + ' items' : 'No completions'}`, 'Extension');
        } catch (error) {
          logger.error(`[Extension] Completion provider error: ${error}`, 'Extension');
        }

        logger.info('[Extension] === END PROVIDER TEST ===', 'Extension');
        vscode.window.showInformationMessage('Provider test completed. Check output panel for results.');
      })
    );

    // Initialize the validation provider
    new ValidationProvider(context);

    // Register command to show performance statistics
    logger.debug('[Extension] Registering showPerformanceStats command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.showPerformanceStats', async () => {
        const performanceMonitor = getPerformanceMonitor();
        const summary = performanceMonitor.getSummary();

        // Create output channel to show detailed performance stats
        const outputChannel = vscode.window.createOutputChannel('GitLab Component Helper - Performance');
        outputChannel.clear();
        outputChannel.appendLine(summary);
        outputChannel.show();

        // Also get detailed stats for slowest operations
        const slowestOps = performanceMonitor.getSlowestOperations(10);

        if (slowestOps.length > 0) {
          outputChannel.appendLine('\n=== Top 10 Slowest Operations ===\n');

          for (let i = 0; i < slowestOps.length; i++) {
            const stat = slowestOps[i];
            outputChannel.appendLine(`${i + 1}. ${stat.name}`);
            outputChannel.appendLine(`   Average: ${stat.avgDuration.toFixed(2)}ms`);
            outputChannel.appendLine(`   Max: ${stat.maxDuration}ms`);
            outputChannel.appendLine(`   P95: ${stat.p95Duration.toFixed(2)}ms`);
            outputChannel.appendLine(`   Count: ${stat.count}`);
            outputChannel.appendLine('');
          }
        }

        logger.info('[Extension] Performance statistics displayed', 'Extension');
        vscode.window.showInformationMessage('Performance statistics displayed in output channel');
      })
    );

    logger.info('[Extension] All commands registered successfully!', 'Extension');
    logger.info('[Extension] Extension activation completed successfully!', 'Extension');

  } catch (error) {
    const logger = Logger.getInstance();
    logger.error(`[Extension] ERROR during activation: ${error}`, 'Extension');
    logger.error(`[Extension] Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`, 'Extension');
    throw error; // Re-throw to ensure VS Code knows activation failed
  }
}

/**
 * Helper function to generate HTML for detached component details.
 * Detects existing inputs and delegates to the template for rendering.
 */
async function getDetachedComponentHtml(component: any): Promise<string> {
  const existingInputs = await detectExistingInputs(component);
  return DetachedComponentTemplate.render(component, existingInputs);
}

/**
 * Detects existing input parameters for a component in the active editor.
 * Returns an array of input parameter names already present in the file.
 */
async function detectExistingInputs(component: any): Promise<string[]> {
  const parameters = component.parameters || [];
  const existingInputs: string[] = [];
  const editor = vscode.window.activeTextEditor;

  if (!editor || parameters.length === 0) {
    return existingInputs;
  }

  if (editor && parameters.length > 0) {
    try {
      const document = editor.document;
      const text = document.getText();

      // Parse the YAML to find component includes and their inputs
      const parsedYaml = parseYaml(text);
      if (parsedYaml && parsedYaml.include) {
        const includes = Array.isArray(parsedYaml.include) ? parsedYaml.include : [parsedYaml.include];

        for (const include of includes) {
          if (include.component && include.inputs) {
            // Check if this include is for the current component
            const componentUrl = include.component;
            if (componentUrl.includes(component.name)) {
              // Extract input parameter names from this component's inputs
              for (const inputName in include.inputs) {
                if (parameters.some((p: any) => p.name === inputName)) {
                  existingInputs.push(inputName);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      // Silently ignore parsing errors and fall back to regex-based detection
      try {
        const document = editor.document;
        const text = document.getText();

        // Simple regex-based detection of component inputs as fallback
        const componentUrlPattern = component.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const componentRegex = new RegExp(`component:\\s*[^\\n]*${componentUrlPattern}[^\\n]*`, 'g');
        const match = componentRegex.exec(text);

        if (match) {
          // Find the inputs section for this component
          const startIndex = match.index + match[0].length;
          const remainingText = text.substring(startIndex);

          // Look for inputs: section
          const inputsMatch = remainingText.match(/^\s*inputs:\s*$/m);
          if (inputsMatch) {
            const inputsStartIndex = startIndex + inputsMatch.index! + inputsMatch[0].length;
            const afterInputsText = text.substring(inputsStartIndex);

            // Extract input parameter names
            const inputLines = afterInputsText.split('\n');
            for (const line of inputLines) {
              // Stop at next job or section
              if (line.match(/^\S/) && !line.trim().startsWith('#')) {
                break;
              }

              // Match input parameter lines (indented with parameter name)
              const paramMatch = line.match(/^\s{2,}([a-zA-Z][a-zA-Z0-9_-]*)\s*:/);
              if (paramMatch) {
                const paramName = paramMatch[1];
                if (parameters.some((p: any) => p.name === paramName)) {
                  existingInputs.push(paramName);
                }
              }
            }
          }
        }
      } catch (fallbackError) {
        // Silently ignore errors
      }
    }
  }

  return existingInputs;
}

export function deactivate() {}
