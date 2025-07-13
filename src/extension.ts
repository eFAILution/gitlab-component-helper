import * as vscode from 'vscode';
import { HoverProvider } from './providers/hoverProvider';
import { CompletionProvider } from './providers/completionProvider';
import { ComponentBrowserProvider } from './providers/componentBrowserProvider';
import { detectIncludeComponent } from './providers/componentDetector';
import { getComponentCacheManager, ComponentCacheManager } from './services/componentCacheManager';
import { outputChannel } from './utils/outputChannel';
import { Logger } from './utils/logger';

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

        // Create a webview panel for the detached component details
        const panel = vscode.window.createWebviewPanel(
          'gitlabComponentDetails',
          `${component.name} - Details`,
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true
          }
        );

        // Generate HTML content for the detached panel
        panel.webview.html = getDetachedComponentHtml(component);
      })
    );

    // Register test command for debugging providers
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

    logger.info('[Extension] All commands registered successfully!', 'Extension');
    logger.info('[Extension] Extension activation completed successfully!', 'Extension');

  } catch (error) {
    const logger = Logger.getInstance();
    logger.error(`[Extension] ERROR during activation: ${error}`, 'Extension');
    logger.error(`[Extension] Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`, 'Extension');
    throw error; // Re-throw to ensure VS Code knows activation failed
  }
}

// Helper function to generate HTML for detached component details
function getDetachedComponentHtml(component: any): string {
  const parameters = component.parameters || [];
  const readme = component.readme || '';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${component.name} - Component Details</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-editor-foreground);
          background-color: var(--vscode-editor-background);
          padding: 20px;
          line-height: 1.6;
        }
        .header {
          border-bottom: 2px solid var(--vscode-panel-border);
          padding-bottom: 15px;
          margin-bottom: 20px;
        }
        h1 {
          margin: 0 0 10px 0;
          color: var(--vscode-editor-foreground);
        }
        .metadata {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          margin-bottom: 20px;
          font-size: 0.9em;
        }
        .metadata div {
          background-color: var(--vscode-panel-background);
          padding: 8px 12px;
          border-radius: 4px;
          border: 1px solid var(--vscode-panel-border);
        }
        .description {
          background-color: var(--vscode-textBlockQuote-background);
          border-left: 4px solid var(--vscode-textBlockQuote-border);
          padding: 15px;
          margin-bottom: 25px;
          border-radius: 0 4px 4px 0;
        }
        .section {
          margin-bottom: 30px;
        }
        .section h2 {
          color: var(--vscode-editor-foreground);
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 8px;
          margin-bottom: 15px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        th, td {
          padding: 12px 8px;
          text-align: left;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
          background-color: var(--vscode-panel-background);
          font-weight: bold;
        }
        tr:hover {
          background-color: var(--vscode-list-hoverBackground);
        }
        .required {
          color: var(--vscode-errorForeground);
          font-weight: bold;
        }
        .optional {
          color: var(--vscode-disabledForeground);
        }
        .default-value {
          background-color: var(--vscode-textCodeBlock-background);
          padding: 2px 6px;
          border-radius: 3px;
          font-family: monospace;
          font-size: 0.9em;
        }
        .readme {
          background-color: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 20px;
          max-height: 60vh;
          overflow-y: auto;
        }
        .readme pre {
          background-color: var(--vscode-textCodeBlock-background);
          padding: 12px;
          border-radius: 4px;
          overflow-x: auto;
        }
        .readme code {
          background-color: var(--vscode-textCodeBlock-background);
          padding: 2px 4px;
          border-radius: 3px;
          font-family: monospace;
        }
        .readme h1, .readme h2, .readme h3 {
          color: var(--vscode-editor-foreground);
          margin-top: 20px;
          margin-bottom: 10px;
        }
        .no-content {
          color: var(--vscode-disabledForeground);
          font-style: italic;
          text-align: center;
          padding: 20px;
        }
        a {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
        }
        a:hover {
          color: var(--vscode-textLink-activeForeground);
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${component.name}</h1>
        <div class="metadata">
          ${component.context ?
            `<div><strong>Source:</strong> <a href="https://${component.context.gitlabInstance}/${component.context.path}" target="_blank">${component.context.gitlabInstance}/${component.context.path}</a></div>` :
            component.source ? `<div><strong>Source:</strong> <a href="${component.source}" target="_blank">${component.source}</a></div>` : ''
          }
          ${component.version ? `<div><strong>Version:</strong> ${component.version}</div>` : ''}
          ${component.documentationUrl ? `<div><strong>Documentation:</strong> <a href="${component.documentationUrl}" target="_blank">View Online</a></div>` : ''}
        </div>
      </div>

      ${component.description ? `
        <div class="description">
          ${component.description}
        </div>
      ` : ''}

      <div class="section">
        <h2>Parameters</h2>
        ${parameters.length === 0 ?
          '<div class="no-content">No parameters documented for this component.</div>' :
          `<table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Required</th>
                <th>Type</th>
                <th>Default</th>
              </tr>
            </thead>
            <tbody>
              ${parameters.map((param: any) => `
                <tr>
                  <td><strong>${param.name}</strong></td>
                  <td>${param.description || `Parameter: ${param.name}`}</td>
                  <td><span class="${param.required ? 'required' : 'optional'}">${param.required ? 'Required' : 'Optional'}</span></td>
                  <td>${param.type || 'string'}</td>
                  <td>${param.default !== undefined ? `<span class="default-value">${param.default}</span>` : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`
        }
      </div>

      ${readme ? `
        <div class="section">
          <h2>📖 README</h2>
          <div class="readme">
            ${readme.replace(/\n/g, '<br>').replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')}
          </div>
        </div>
      ` : ''}
    </body>
    </html>
  `;
}

export function deactivate() {}
