import { registerAddProjectTokenCommand, getComponentService } from './services/component';
import { safeUrlParse } from './utils/urlUtils';
import * as vscode from 'vscode';
import { HoverProvider } from './providers/hoverProvider';
import { CompletionProvider } from './providers/completionProvider';
import { ComponentBrowserProvider } from './providers/componentBrowserProvider';
import { PipelineVisualizerProvider } from './providers/pipelineVisualizerProvider';
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

    // Register command for pipeline visualizer
    logger.debug('[Extension] Registering visualizePipeline command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.visualizePipeline', async (componentContext?: any) => {
        const visualizer = new PipelineVisualizerProvider(context);
        const editor = vscode.window.activeTextEditor;

        if (componentContext) {
          await visualizer.show(componentContext);
        } else if (editor && (editor.document.languageId === 'yaml' || editor.document.languageId === 'gitlab-ci')) {
          await visualizer.show(undefined, editor.document);
        } else {
          vscode.window.showInformationMessage('No component selected or active GitLab CI file to visualize.');
        }
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
          `Component: ${component.name}`,
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: []
          }
        );

        // Use the same details HTML as the Component Browser
        const componentBrowser = new ComponentBrowserProvider(context, cacheManager);

        // Try to enrich the component details (raw YAML, header metadata) before rendering
        let activeComponent = component;
        try {
          const resolvedGitlabInstance = component?.gitlabInstance || component?.context?.gitlabInstance;
          const resolvedSourcePath = component?.sourcePath || component?.context?.path;
          const resolvedName = component?.name;

          if (resolvedGitlabInstance && resolvedSourcePath && resolvedName) {
            const targetVersion = component.version || 'main';

            // Prefer cache for version-specific fetch
            const cached = await cacheManager.fetchSpecificVersion(
              resolvedName,
              resolvedSourcePath,
              resolvedGitlabInstance,
              targetVersion
            );

            if (cached) {
              activeComponent = {
                ...cached,
                originalUrl: component.originalUrl,
                url: component.url,
                _hoverContext: component._hoverContext
              };
            } else {
              const componentService = getComponentService();
              const componentUrl = `https://${resolvedGitlabInstance}/${resolvedSourcePath}/${resolvedName}@${targetVersion}`;

              // Try catalog fragments (for YAML fragments without spec)
              try {
                const catalogData = await componentService.fetchCatalogData(
                  resolvedGitlabInstance,
                  resolvedSourcePath,
                  true,
                  targetVersion
                );
                const fragment = catalogData?.fragments?.find((frag: any) => frag.name === resolvedName);
                if (fragment) {
                  activeComponent = {
                    ...component,
                    name: fragment.name,
                    description: fragment.description || component.description,
                    summary: fragment.summary,
                    usage: fragment.usage,
                    notes: fragment.notes,
                    rawYaml: fragment.rawYaml,
                    gitlabInstance: resolvedGitlabInstance,
                    sourcePath: resolvedSourcePath,
                    version: targetVersion,
                    _hoverContext: component._hoverContext
                  };
                }
              } catch (catalogError) {
                logger.debug(`[Extension] Fragment catalog fetch failed: ${catalogError}`, 'Extension');
              }

              const fetched = await componentService.getComponentFromUrl(componentUrl);
              if (fetched) {
                activeComponent = {
                  ...fetched,
                  originalUrl: component.originalUrl,
                  url: component.url || fetched.url,
                  _hoverContext: component._hoverContext
                };
              }
            }
          }
        } catch (error) {
          logger.debug(`[Extension] Failed to enrich detached hover component: ${error}`, 'Extension');
        }

        panel.webview.html = componentBrowser.getComponentDetailsHtml(activeComponent);

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

                // Handle different insertion options
                const { version, includeInputs, selectedInputs } = message;

                // Update component version if specified
                if (version && version !== activeComponent.version) {
                  const updatedComponent = await cacheManager.fetchSpecificVersion(
                    activeComponent.name,
                    activeComponent.sourcePath,
                    activeComponent.gitlabInstance,
                    version
                  );
                  if (updatedComponent) {
                    if (activeComponent._hoverContext) {
                      await componentBrowser.editExistingComponentFromDetached(
                        updatedComponent,
                        activeComponent._hoverContext.documentUri,
                        activeComponent._hoverContext.position,
                        includeInputs || false,
                        selectedInputs || []
                      );
                    } else {
                      await componentBrowser.insertComponentFromDetached(
                        updatedComponent,
                        includeInputs || false,
                        selectedInputs || []
                      );
                    }
                  } else {
                    vscode.window.showErrorMessage(`Failed to fetch version ${version} of component ${activeComponent.name}`);
                  }
                } else {
                  if (activeComponent._hoverContext) {
                    await componentBrowser.editExistingComponentFromDetached(
                      activeComponent,
                      activeComponent._hoverContext.documentUri,
                      activeComponent._hoverContext.position,
                      includeInputs || false,
                      selectedInputs || []
                    );
                  } else {
                    await componentBrowser.insertComponentFromDetached(
                      activeComponent,
                      includeInputs || false,
                      selectedInputs || []
                    );
                  }
                }

                // Close the panel after successful insertion/edit
                panel.dispose();
              } catch (error) {
                logger.error(`[Extension] Error inserting component from detached view: ${error}`, 'Extension');
                vscode.window.showErrorMessage(`Error inserting component: ${error}`);
              }
              break;
            case 'fetchVersions':
              try {
                const versions = await cacheManager.fetchComponentVersions(activeComponent);
                panel.webview.postMessage({
                  command: 'versionsLoaded',
                  versions: versions,
                  currentVersion: activeComponent.version
                });
              } catch (error) {
                panel.webview.postMessage({
                  command: 'versionsError',
                  error: error instanceof Error ? error.message : String(error)
                });
              }
              break;
            case 'versionChanged':
              try {
                const { selectedVersion } = message;
                const updatedComponent = await cacheManager.fetchSpecificVersion(
                  activeComponent.name,
                  activeComponent.sourcePath,
                  activeComponent.gitlabInstance,
                  selectedVersion
                );
                if (updatedComponent) {
                  activeComponent = updatedComponent;
                  panel.webview.postMessage({
                    command: 'componentDetailsUpdated',
                    component: updatedComponent
                  });
                } else {
                  panel.webview.postMessage({
                    command: 'versionChangeError',
                    error: `Failed to fetch details for version ${selectedVersion}`
                  });
                }
              } catch (error) {
                panel.webview.postMessage({
                  command: 'versionChangeError',
                  error: error instanceof Error ? error.message : String(error)
                });
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

    // Register command to select active policy override
    logger.debug('[Extension] Registering selectPolicyOverride command...', 'Extension');
    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.selectPolicyOverride', async () => {
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const projectPath = config.get<string>('projectPath', '');
        const gitlabUrl = config.get<string>('gitlabUrl', 'https://gitlab.com');
        let gitlabInstance = 'gitlab.com';
        try {
          gitlabInstance = safeUrlParse(gitlabUrl).hostname;
        } catch {
          gitlabInstance = gitlabUrl.replace(/^https?:\/\//, '').split('/')[0];
        }

        if (!projectPath) {
          vscode.window.showErrorMessage('Please set the "gitlabComponentHelper.projectPath" setting for your workspace first.');
          return;
        }

        const service = getComponentService();
        const token = await service.getTokenForProject(gitlabInstance, projectPath);
        if (!token) {
          vscode.window.showErrorMessage('No GitLab token found. Please add a token for your project using "GitLab CI: Add Component Project/Group" first.');
          return;
        }

        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Fetching Pipeline Execution Policies..."
        }, async () => {
          let policies = await service.fetchPipelineExecutionPolicies(gitlabInstance, projectPath, token);

          if (policies.length === 0) {
            const pepOverride = config.get<string>('visualizer.pepProjectPathOverride');
            const localOverrides = config.get<string[]>('visualizer.alwaysInclude', []).filter(inc => require('path').isAbsolute(inc));

            let rawYaml: string | undefined;
            if (localOverrides.length > 0) {
              try {
                rawYaml = require('fs').readFileSync(localOverrides[0], 'utf-8');
                vscode.window.showInformationMessage('GraphQL policy list failed. Falling back to parsing local PEP override file.');
              } catch (e) {
                logger.error(`[Extension] Failed to read local PEP override ${localOverrides[0]}: ${e}`, 'Extension');
                vscode.window.showWarningMessage(`Failed to read local PEP override file: ${localOverrides[0]}`);
              }
            } else if (pepOverride) {
              try {
                rawYaml = await service.fetchRawFile(gitlabInstance, pepOverride, '.gitlab/security-policies/policy.yml', 'HEAD');
                vscode.window.showInformationMessage(`GraphQL policy list failed. Falling back to parsing policy.yml from override: ${pepOverride}`);
              } catch (e) {
                logger.error(`[Extension] Failed to fetch policy.yml from override project ${pepOverride}: ${e}`, 'Extension');
                vscode.window.showWarningMessage(`Failed to fetch policy.yml from override project '${pepOverride}'. Please check the path and your access tokens.`);
              }
            }

            if (rawYaml) {
              try {
                const parsed = parseYaml(rawYaml);
                if (parsed && parsed.pipeline_execution_policy && Array.isArray(parsed.pipeline_execution_policy)) {
                  policies = parsed.pipeline_execution_policy
                    .map((p: any) => p.name)
                    .filter(Boolean);
                }
              } catch (e) {
                logger.error(`[Extension] Failed to parse YAML for policy override: ${e}`, 'Extension');
                vscode.window.showWarningMessage('Failed to parse policy.yml. The file may contain invalid YAML syntax.');
              }
            }
          }

          const clearOption = { label: '$(clear-all) Clear Override / Show All', value: '' };
          const policyItems = policies.map(p => ({ label: `$(shield) ${p}`, value: p }));

          if (policyItems.length === 0) {
            vscode.window.showInformationMessage('No active Pipeline Execution Policies found. If you are using Instance/Group level policies, please set a Linked Policy Project Override first.');
            return;
          }

          const pick = await vscode.window.showQuickPick(
            [clearOption, ...policyItems],
            { placeHolder: 'Select a Pipeline Execution Policy to visualize', ignoreFocusOut: true }
          );

          if (pick !== undefined) {
            if (pick.value) {
              await safeUpdateConfig(config, 'visualizer.activePolicyOverride', pick.value, `Active Policy Override set to: ${pick.value}`);
            } else {
              await safeUpdateConfig(config, 'visualizer.activePolicyOverride', '', undefined, 'Active Policy Override cleared. All policies will be shown.');
            }
          }
        });
      })
    );

    logger.debug('[Extension] Registering PEP control commands...', 'Extension');

    // Helper function for safe configuration updates to bypass the VS Code binary file bug
    async function safeUpdateConfig(config: vscode.WorkspaceConfiguration, section: string, value: any, successMessage?: string, clearMessage?: string) {
      try {
        await config.update(section, value, vscode.ConfigurationTarget.Workspace);
        if (value) {
          if (successMessage) vscode.window.showInformationMessage(successMessage);
        } else {
          if (clearMessage) vscode.window.showInformationMessage(clearMessage);
        }
      } catch (err) {
        const action = await vscode.window.showWarningMessage(
          `Failed to save to Workspace Settings (usually located in .vscode/settings.json). Would you like to try saving to your Global User Settings instead?`,
          'Save Globally', 'Cancel'
        );
        if (action === 'Save Globally') {
          try {
            await config.update(section, value, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Saved successfully to Global User Settings!`);
          } catch (globalErr) {
            vscode.window.showErrorMessage(
              `Failed to save globally. Please open your User settings.json and manually ${value ? `set "gitlabComponentHelper.${section}" to "${value}"` : `delete "gitlabComponentHelper.${section}"`}.`
            );
          }
        } else {
          vscode.window.showErrorMessage(
            `Save cancelled. To do this manually, open your Workspace settings.json and ${value ? `set "gitlabComponentHelper.${section}" to "${value}"` : `delete "gitlabComponentHelper.${section}"`}.`
          );
        }
      }
    }

    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.setProjectPath', async () => {
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const currentPath = config.get<string>('projectPath', '');
        const newPath = await vscode.window.showInputBox({
          prompt: 'Enter your GitLab project path (e.g. group/project)',
          value: currentPath,
          ignoreFocusOut: true
        });

        if (newPath !== undefined && newPath !== currentPath) {
          await safeUpdateConfig(config, 'projectPath', newPath, `GitLab project path set to: ${newPath}`, 'GitLab project path cleared.');
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.setLinkedProjectOverride', async () => {
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const currentOverride = config.get<string>('visualizer.pepProjectPathOverride', '');
        const newOverride = await vscode.window.showInputBox({
          prompt: 'Enter the path to your Security Policy Project (e.g. compliance-group/policy-repo)',
          value: currentOverride,
          ignoreFocusOut: true
        });

        if (newOverride !== undefined && newOverride !== currentOverride) {
          await safeUpdateConfig(config, 'visualizer.pepProjectPathOverride', newOverride, `Linked Policy Project Override set to: ${newOverride}`, 'Linked Policy Project Override cleared.');
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.selectLocalPepOverride', async () => {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Select Local Policy',
          filters: { 'YAML': ['yml', 'yaml'] }
        });

        if (uris && uris.length > 0) {
          const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
          let alwaysInclude = config.get<string[]>('visualizer.alwaysInclude', []);

          // Remove existing absolute paths (which represent local file overrides)
          alwaysInclude = alwaysInclude.filter(inc => !require('path').isAbsolute(inc));

          alwaysInclude.push(uris[0].fsPath);
          await safeUpdateConfig(config, 'visualizer.alwaysInclude', alwaysInclude, `Local PEP override set to: ${uris[0].fsPath}`);
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.clearPepOverrides', async () => {
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        let updated = false;

        if (config.get<string>('visualizer.activePolicyOverride', '') !== '') {
          await safeUpdateConfig(config, 'visualizer.activePolicyOverride', '');
          updated = true;
        }

        let alwaysInclude = config.get<string[]>('visualizer.alwaysInclude', []);
        const originalLength = alwaysInclude.length;
        alwaysInclude = alwaysInclude.filter(inc => !require('path').isAbsolute(inc));

        if (alwaysInclude.length !== originalLength) {
          await safeUpdateConfig(config, 'visualizer.alwaysInclude', alwaysInclude);
          updated = true;
        }

        if (updated) {
          vscode.window.showInformationMessage('All PEP overrides cleared.');
        } else {
          vscode.window.showInformationMessage('No active PEP overrides to clear.');
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('gitlab-component-helper.generateTroubleshootingReport', async () => {
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');

        let report = `# GitLab Component Helper - Troubleshooting Report\n\n`;
        report += `## Environment\n`;
        report += `- **VS Code Version:** ${vscode.version}\n`;
        report += `- **OS:** ${process.platform} ${process.arch}\n`;
        report += `- **Date:** ${new Date().toISOString()}\n\n`;

        report += `## Extension Settings\n`;
        report += `> *Note: Secrets and tokens are explicitly excluded from this report.*\n\n`;
        report += `- **gitlabUrl:** \`${config.get<string>('gitlabUrl', '')}\`\n`;
        report += `- **projectPath:** \`${config.get<string>('projectPath', '')}\`\n`;
        report += `- **pepProjectPathOverride:** \`${config.get<string>('visualizer.pepProjectPathOverride', '')}\`\n`;
        report += `- **alwaysInclude:** \`${JSON.stringify(config.get<string[]>('visualizer.alwaysInclude', []))}\`\n`;
        report += `- **activePolicyOverride:** \`${config.get<string>('visualizer.activePolicyOverride', '')}\`\n`;
        report += `- **logLevel:** \`${config.get<string>('logLevel', 'INFO')}\`\n\n`;

        report += `## Debug Trace\n`;
        report += `> *This is a rolling buffer of the last 1000 background events.*\n\n`;
        report += `\`\`\`log\n`;

        const logs = Logger.getInstance().getTroubleshootingLogs();
        if (logs.length === 0) {
          report += `(No background logs collected yet. Try running your command again before generating the report.)\n`;
        } else {
          report += logs.join('\n') + '\n';
        }
        report += `\`\`\`\n`;

        const document = await vscode.workspace.openTextDocument({
          content: report,
          language: 'markdown'
        });
        await vscode.window.showTextDocument(document);

        vscode.window.showInformationMessage('Troubleshooting report generated! Please review it and share it with the maintainers.');
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

export function deactivate() { }
