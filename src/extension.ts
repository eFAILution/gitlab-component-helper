import * as vscode from 'vscode';
import { HoverProvider } from './providers/hoverProvider';
import { CompletionProvider } from './providers/completionProvider';
import { ComponentBrowserProvider } from './providers/componentBrowserProvider';
import { detectIncludeComponent } from './providers/componentDetector';
import { getComponentCacheManager, ComponentCacheManager } from './services/componentCacheManager';
import { outputChannel } from './utils/outputChannel';

export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('GitLab Component Helper is now active!');
  outputChannel.appendLine(`[Extension] VS Code version: ${vscode.version}`);
  outputChannel.appendLine(`[Extension] Extension context: ${JSON.stringify({
    globalState: Object.keys(context.globalState.keys()),
    workspaceState: Object.keys(context.workspaceState.keys()),
    extensionPath: context.extensionPath,
    extensionUri: context.extensionUri.toString()
  }, null, 2)}`);

  try {
    outputChannel.appendLine('[Extension] Starting activation process...');
    outputChannel.appendLine('[Extension] Registering commands...');

    // Log current user settings
    outputChannel.appendLine('[Extension] Loading user settings...');
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const componentSources = config.get('componentSources', []);
    const cacheTime = config.get('cacheTime', 3600);
    const componentSource = config.get('componentSource', 'local');

    outputChannel.appendLine(`[Extension] User settings loaded:`);
    outputChannel.appendLine(`[Extension]   - Component sources: ${JSON.stringify(componentSources, null, 2)}`);
    outputChannel.appendLine(`[Extension]   - Cache time: ${cacheTime} seconds`);
    outputChannel.appendLine(`[Extension]   - Component source type: ${componentSource}`);

    // Initialize component cache manager (this will start loading components)
    outputChannel.appendLine(`[Extension] About to import/initialize component cache manager...`);
    let cacheManager: ComponentCacheManager;
    try {
      cacheManager = getComponentCacheManager(context);
      outputChannel.appendLine(`[Extension] Component cache manager initialized successfully`);
    } catch (cacheError) {
      outputChannel.appendLine(`[Extension] ERROR initializing cache manager: ${cacheError}`);
      throw cacheError;
    }

    outputChannel.show();    // Listen for configuration changes
    outputChannel.appendLine('[Extension] Registering configuration change listener...');
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('gitlabComponentHelper')) {
          outputChannel.appendLine(`[Extension] Configuration changed, reloading settings...`);
          const updatedConfig = vscode.workspace.getConfiguration('gitlabComponentHelper');
          const updatedSources = updatedConfig.get('componentSources', []);
          outputChannel.appendLine(`[Extension] Updated component sources: ${JSON.stringify(updatedSources, null, 2)}`);
        }
      })
    );

    // Register hover provider for GitLab CI files (broad registration, providers will filter)
    outputChannel.appendLine('[Extension] Registering hover provider...');
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
    outputChannel.appendLine('[Extension] Registering completion provider...');
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
    outputChannel.appendLine('[Extension] Registering browseComponents command...');
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
            outputChannel.appendLine(`[Extension] Found component context: ${componentContext.gitlabInstance}/${componentContext.path}`);
          }
        }

        // Create and show the browser with the context
        const componentBrowser = new ComponentBrowserProvider(context, cacheManager, outputChannel);
        await componentBrowser.show(componentContext);
      })
    );

  // Register command to refresh component cache
  outputChannel.appendLine('[Extension] Registering refreshComponents command...');
  context.subscriptions.push(
    vscode.commands.registerCommand('gitlab-component-helper.refreshComponents', async () => {
      outputChannel.appendLine(`[Extension] Manual refresh requested`);
      await cacheManager.forceRefresh();
      vscode.window.showInformationMessage('GitLab components refreshed successfully!');
    })
  );

  // Register command to show cache status
  outputChannel.appendLine('[Extension] Registering showCacheStatus command...');
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
      outputChannel.appendLine(`[Extension] Cache status shown to user`);
    })
  );

  // Register command to show detailed cache debug info
  outputChannel.appendLine('[Extension] Registering debugCache command...');
  context.subscriptions.push(
    vscode.commands.registerCommand('gitlab-component-helper.debugCache', async () => {
      const components = await cacheManager.getComponents();
      const errors = cacheManager.getSourceErrors();

      outputChannel.appendLine(`[Extension] === CACHE DEBUG INFO ===`);
      outputChannel.appendLine(`[Extension] Total cached components: ${components.length}`);
      outputChannel.appendLine(`[Extension] Total source errors: ${errors.size}`);

      // Group components by source
      const componentsBySource = new Map<string, any[]>();
      components.forEach((comp: any) => {
        const key = comp.source;
        if (!componentsBySource.has(key)) {
          componentsBySource.set(key, []);
        }
        componentsBySource.get(key)!.push(comp);
      });

      outputChannel.appendLine(`[Extension] Components grouped by source:`);
      componentsBySource.forEach((comps: any[], source: string) => {
        outputChannel.appendLine(`[Extension]   ${source}: ${comps.length} components`);
        comps.forEach((comp: any) => {
          outputChannel.appendLine(`[Extension]     - ${comp.name} (${comp.gitlabInstance}/${comp.sourcePath})`);
        });
      });

      outputChannel.appendLine(`[Extension] Source errors:`);
      errors.forEach((error: string, source: string) => {
        outputChannel.appendLine(`[Extension]   ${source}: ${error}`);
      });

      outputChannel.appendLine(`[Extension] === END CACHE DEBUG ===`);
      outputChannel.show();
    })
  );

  // Register command to detach hover window as a dedicated panel
  outputChannel.appendLine('[Extension] Registering detachHover command...');
  context.subscriptions.push(
    vscode.commands.registerCommand('gitlab-component-helper.detachHover', async (component: any) => {
      outputChannel.appendLine(`[Extension] Detaching hover for component: ${component?.name}`);

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
  outputChannel.appendLine('[Extension] Registering testProviders command...');
  context.subscriptions.push(
    vscode.commands.registerCommand('gitlab-component-helper.testProviders', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      outputChannel.appendLine('[Extension] === PROVIDER TEST ===');
      outputChannel.appendLine(`[Extension] Current file: ${editor.document.fileName}`);
      outputChannel.appendLine(`[Extension] File language: ${editor.document.languageId}`);
      outputChannel.appendLine(`[Extension] Current position: Line ${editor.selection.active.line + 1}, Column ${editor.selection.active.character + 1}`);

      // Test hover provider manually
      const hoverProvider = new HoverProvider();
      try {
        const hover = await hoverProvider.provideHover(editor.document, editor.selection.active);
        outputChannel.appendLine(`[Extension] Hover provider result: ${hover ? 'Found hover content' : 'No hover content'}`);
        if (hover) {
          outputChannel.appendLine(`[Extension] Hover content: ${hover.contents.map(c => typeof c === 'string' ? c : c.value).join('\n')}`);
        }
      } catch (error) {
        outputChannel.appendLine(`[Extension] Hover provider error: ${error}`);
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
        outputChannel.appendLine(`[Extension] Completion provider result: ${completions ? (Array.isArray(completions) ? completions.length : completions.items.length) + ' items' : 'No completions'}`);
      } catch (error) {
        outputChannel.appendLine(`[Extension] Completion provider error: ${error}`);
      }

      outputChannel.appendLine('[Extension] === END PROVIDER TEST ===');
      outputChannel.show();
      vscode.window.showInformationMessage('Provider test completed. Check output panel for results.');
    })
  );

    outputChannel.appendLine('[Extension] All commands registered successfully!');
    outputChannel.appendLine('[Extension] Extension activation completed successfully!');

  } catch (error) {
    outputChannel.appendLine(`[Extension] ERROR during activation: ${error}`);
    outputChannel.appendLine(`[Extension] Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`);
    outputChannel.show();
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
