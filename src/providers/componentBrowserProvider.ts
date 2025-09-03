import * as vscode from 'vscode';
import { getComponentService } from '../services/componentService';
import { ComponentCacheManager } from '../services/componentCacheManager';
import { GitLabCatalogComponent, GitLabCatalogVariable } from '../types/gitlab-catalog';
import { Component, ComponentParameter } from './componentDetector';
import { containsGitLabVariables, expandGitLabVariables } from '../utils/gitlabVariables';
import { Logger } from '../utils/logger';

// Constants for timing delays
const EDITOR_ACTIVATION_DELAY_MS = 50;

export class ComponentBrowserProvider {
  private panel: vscode.WebviewPanel | undefined;
  private originalEditor: vscode.TextEditor | undefined;
  private logger = Logger.getInstance();

  constructor(private context: vscode.ExtensionContext, private cacheManager: ComponentCacheManager) {
    // Remove this.outputChannel assignment, now using logger
  }

  public async show(componentContext?: { gitlabInstance?: string; path?: string }) {
    // Store the active editor when opening the component browser
    this.originalEditor = vscode.window.activeTextEditor;

    // Log the context for debugging
    if (componentContext) {
      this.logger.debug(`Browser received context: ${componentContext.gitlabInstance}/${componentContext.path}`, 'ComponentBrowser');
    }

    // If panel already exists, show it
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    // Create and show the webview panel
    this.panel = vscode.window.createWebviewPanel(
      'gitlabComponentBrowser',
      'GitLab CI/CD Components',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media')
        ]
      }
    );

    // Set initial HTML content with loading message
    this.panel.webview.html = this.getLoadingHtml();

    // Handle panel disposal
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // Load and display components
    await this.loadComponents(false, componentContext);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'insertComponent':
            await this.insertComponent(message.component);
            return;
          case 'refreshComponents':
            await this.loadComponents(true);
            return;
          case 'updateCache':
            await this.updateCache();
            return;
          case 'resetCache':
            await this.resetCache();
            return;
          case 'viewComponentDetails':
            await this.showComponentDetails(message.component);
            return;
          case 'showCacheStatus':
            await this.showCacheStatus();
            return;
          case 'openSettings':
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'gitlabComponentHelper.componentSources'
            );
            return;
          case 'fetchVersion':
            await this.fetchAndCacheVersion(message.componentName, message.sourcePath, message.gitlabInstance, message.version);
            return;
          case 'setDefaultVersion':
            await this.setDefaultVersion(message.componentName, message.version, message.projectId);
            return;
          case 'setAlwaysUseLatest':
            await this.setAlwaysUseLatest(message.componentName, message.projectId);
            return;
          case 'setDefaultVersion':
            await this.setDefaultVersion(message.componentName, message.version, message.projectId);
            return;
          case 'setAlwaysUseLatest':
            await this.setAlwaysUseLatest(message.componentName, message.projectId);
            return;
        }
      },
      undefined,
      this.context.subscriptions
    );
  }

  private async loadComponents(forceRefresh: boolean = false, componentContext?: { gitlabInstance?: string; path?: string }) {
    if (!this.panel) {
      return;
    }

    try {
      // Show loading state
      this.panel.webview.html = this.getLoadingHtml();

      this.logger.debug(`[ComponentBrowser] Loading components, forceRefresh: ${forceRefresh}`, 'ComponentBrowser');

      // Log the context again at load time
      if (componentContext) {
        this.logger.debug(`[ComponentBrowser] Loading components with context: ${componentContext.gitlabInstance}/${componentContext.path}`, 'ComponentBrowser');
      }

      // If force refresh requested, refresh the cache
      if (forceRefresh) {
        this.logger.debug('[ComponentBrowser] Force refreshing cache...', 'ComponentBrowser');
        await this.cacheManager.forceRefresh();
      }

      // Get all components from cache
      const cachedComponents = await this.cacheManager.getComponents();
      const sourceErrors = this.cacheManager.getSourceErrors();

      // Fetch versions for components that don't have them yet
      this.logger.debug('[ComponentBrowser] Fetching available versions for components...', 'ComponentBrowser');
      for (const component of cachedComponents) {
        if (!component.availableVersions || component.availableVersions.length === 0) {
          try {
            await this.cacheManager.fetchComponentVersions(component);
          } catch (error) {
            this.logger.warn(`[ComponentBrowser] Error fetching versions for ${component.name}: ${error}`, 'ComponentBrowser');
          }
        }
      }

      // Transform cached components to component groups format
      const allComponents = this.transformCachedComponentsToGroups(cachedComponents);
      const cacheErrors = Object.fromEntries(sourceErrors);

      this.logger.debug(`[ComponentBrowser] Retrieved ${allComponents.length} component groups from cache`, 'ComponentBrowser');
      this.logger.debug(`[ComponentBrowser] Cache has ${Object.keys(cacheErrors).length} source errors`, 'ComponentBrowser');

      // Debug: log what components we actually have
      allComponents.forEach((source: any, index: number) => {
        this.logger.debug(`[ComponentBrowser] Source ${index + 1}: ${source.source} (${source.totalComponents} total components)`, 'ComponentBrowser');
        source.projects.forEach((project: any) => {
          this.logger.debug(`[ComponentBrowser]   Project: ${project.name} (${project.components.length} components)`, 'ComponentBrowser');
          project.components.forEach((comp: any) => {
            this.logger.debug(`[ComponentBrowser]     - ${comp.name}`, 'ComponentBrowser');
          });
        });
      });

      // Debug: log what errors we have
      Object.entries(cacheErrors).forEach(([source, error]) => {
        this.logger.warn(`[ComponentBrowser] Error for ${source}: ${error}`, 'ComponentBrowser');
      });

      // Get component sources from settings to potentially add context source
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      let sources = config.get<Array<{
        name: string;
        path: string;
        gitlabInstance?: string;
      }>>('componentSources', []);

      // If we have context, ensure that source is included
      if (componentContext && componentContext.gitlabInstance && componentContext.path) {
        const contextInstance = componentContext.gitlabInstance;
        const contextPath = componentContext.path;

        // Check if the context source is already in the cache
        const contextSourceExists = allComponents.some(
          (group: any) => group.gitlabInstance === contextInstance && group.sourcePath === contextPath
        );

        // If not in cache, try to add it dynamically
        if (!contextSourceExists) {
          this.logger.debug(`[ComponentBrowser] Adding context source: ${contextInstance}/${contextPath}`, 'ComponentBrowser');
          try {
            const componentService = getComponentService();
            const catalogData = await componentService.fetchCatalogData(
              contextInstance,
              contextPath,
              true // force fresh fetch for context
            );

            if (catalogData && catalogData.components && catalogData.components.length > 0) {
              const components = catalogData.components.map((c: GitLabCatalogComponent) => ({
                name: c.name,
                description: c.description || `Component from ${contextPath}`,
                parameters: (c.variables || []).map((v: GitLabCatalogVariable) => ({
                  name: v.name,
                  description: v.description || `Parameter: ${v.name}`,
                  required: v.required || false,
                  type: v.type || 'string',
                  default: v.default
                })),
                source: `Components from ${contextPath}`,
                sourcePath: contextPath,
                gitlabInstance: contextInstance,
                version: c.latest_version || 'latest',
                documentationUrl: c.documentation_url
              }));

              // Add to the components list with proper hierarchical structure
              allComponents.unshift({
                source: `Components from ${contextPath}`,
                type: 'source',
                isExpanded: true,
                totalComponents: components.length,
                projects: [{
                  name: contextPath.split('/').pop() || contextPath,
                  path: contextPath,
                  gitlabInstance: contextInstance,
                  type: 'project',
                  isExpanded: true, // Auto-expand context projects
                  components: components.map((comp: any) => ({
                    ...comp,
                    versions: [{
                      version: comp.version,
                      description: comp.description,
                      parameters: comp.parameters,
                      documentationUrl: comp.documentationUrl,
                      source: comp.source,
                      sourcePath: comp.sourcePath,
                      gitlabInstance: comp.gitlabInstance
                    }],
                    versionCount: 1,
                    defaultVersion: comp.version
                  }))
                }]
              });

              this.logger.debug(`[ComponentBrowser] Successfully added ${components.length} components from context source`, 'ComponentBrowser');
            }
          } catch (error) {
            this.logger.warn(`[ComponentBrowser] Failed to load context source: ${error}`, 'ComponentBrowser');
            // Don't fail the whole browser for context source issues
          }
        }
      }

      // If no sources configured and no components in cache, show guidance
      if (sources.length === 0 && allComponents.length === 0) {
        this.panel.webview.html = this.getNoSourcesHtml();
        return;
      }

      // If no components found but we have cache errors, show errors
      if (allComponents.length === 0 && Object.keys(cacheErrors).length > 0) {
        const errorMessages = Object.entries(cacheErrors).map(([source, error]) =>
          `${source}: ${error}`
        );
        this.panel.webview.html = this.getErrorsHtml(errorMessages);
        return;
      }

      // Render the component browser with the components and any errors
      // Only show errors for sources that have no components AND have errors
      const filteredErrors: Record<string, string> = {};

      // Get list of sources that have components
      const sourcesWithComponents = new Set(allComponents.map((group: any) => group.source));

      // Only include errors for sources that don't have any components
      Object.entries(cacheErrors).forEach(([source, error]) => {
        if (!sourcesWithComponents.has(source)) {
          filteredErrors[source] = error;
        } else {
          this.logger.debug(`[ComponentBrowser] Suppressing error for ${source} since it has components`, 'ComponentBrowser');
        }
      });

      this.logger.debug(`[ComponentBrowser] Filtered errors: ${Object.keys(filteredErrors).length} of ${Object.keys(cacheErrors).length}`, 'ComponentBrowser');

      this.panel.webview.html = this.getComponentBrowserHtml(allComponents, filteredErrors);
    } catch (error) {
      this.logger.error(`[ComponentBrowser] Error in loadComponents: ${error}`, 'ComponentBrowser');
      if (this.panel) {
        this.panel.webview.html = this.getErrorHtml(error);
      }
    }
  }

  private async insertComponent(component: any, includeInputs: boolean = false, selectedInputs?: string[]) {
    // Get the active text editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No active editor to insert component into");
      return;
    }

    // Make sure the editor is visible and has focus
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false
    });

    // Brief wait to ensure editor is fully activated
    await new Promise(resolve => setTimeout(resolve, EDITOR_ACTIVATION_DELAY_MS));

    // Use the GitLab instance from the component or default to gitlab.com
    const gitlabInstance = component.gitlabInstance || 'gitlab.com';

    // Create the component reference
    // Check if we should preserve GitLab variables in the URL
    let componentUrl: string;

    // If the component has a preserved URL with variables, use that
    if (component.originalUrl && containsGitLabVariables(component.originalUrl)) {
      componentUrl = component.originalUrl;
      // Update version if different
      if (component.version && !component.originalUrl.includes('@')) {
        componentUrl += `@${component.version}`;
      } else if (component.version && component.originalUrl.includes('@')) {
        componentUrl = component.originalUrl.replace(/@[^@]*$/, `@${component.version}`);
      }
    } else {
      // Create standard URL
      componentUrl = `https://${gitlabInstance}/${component.sourcePath}/${component.name}@${component.version}`;
    }

    let insertion = `  - component: ${componentUrl}`;

    // Add inputs if requested and component has parameters
    if (includeInputs && component.parameters && component.parameters.length > 0) {
      insertion += '\n    inputs:';

      // Determine which parameters to include
      let parametersToInclude = component.parameters;
      if (selectedInputs && selectedInputs.length > 0) {
        // Only include specifically selected inputs
        parametersToInclude = component.parameters.filter((param: any) => selectedInputs.includes(param.name));
      }

      for (const param of parametersToInclude) {
        let defaultValue = param.default;

        // Format default value based on type
        if (defaultValue !== undefined) {
          if (typeof defaultValue === 'string') {
            // Check if it contains GitLab variables and preserve them
            if (containsGitLabVariables(defaultValue)) {
              defaultValue = `"${defaultValue}"`; // Keep variables as-is in quotes
            } else {
              defaultValue = `"${defaultValue}"`;
            }
          } else if (typeof defaultValue === 'boolean') {
            defaultValue = defaultValue.toString();
          } else if (typeof defaultValue === 'number') {
            defaultValue = defaultValue.toString();
          } else {
            defaultValue = JSON.stringify(defaultValue);
          }
        } else {
          // Provide placeholder based on type and required status
          if (param.required) {
            switch (param.type) {
              case 'boolean':
                defaultValue = 'true';
                break;
              case 'number':
                defaultValue = '0';
                break;
              default:
                defaultValue = '"TODO: set value"';
            }
          } else {
            switch (param.type) {
              case 'boolean':
                defaultValue = 'false';
                break;
              case 'number':
                defaultValue = '0';
                break;
              default:
                defaultValue = '""';
            }
          }
        }

        const comment = param.required ? ' # required' : ' # optional';
        insertion += `\n      ${param.name}: ${defaultValue}${comment}`;
      }
    }

    // Insert at cursor position
    editor.edit(editBuilder => {
      editBuilder.insert(editor.selection.active, insertion);
    });

    // Create appropriate success message
    let message = `Inserted component: ${component.name}`;
    if (includeInputs && component.parameters && component.parameters.length > 0) {
      if (selectedInputs && selectedInputs.length > 0) {
        message += ` with ${selectedInputs.length} selected input parameter${selectedInputs.length === 1 ? '' : 's'}`;
      } else {
        message += ` with ${component.parameters.length} input parameter${component.parameters.length === 1 ? '' : 's'}`;
      }
    }

    vscode.window.showInformationMessage(message);
  }

  // Public method to insert component from detached view (called from extension.ts)
  public async insertComponentFromDetached(component: any, includeInputs: boolean = false, selectedInputs?: string[]) {
    return this.insertComponent(component, includeInputs, selectedInputs);
  }

  private async showComponentDetails(component: any) {
    // Create a new webview panel for component details
    const detailsPanel = vscode.window.createWebviewPanel(
      'gitlabComponentDetails',
      `Component: ${component.name}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true
      }
    );

    // Show component details
    detailsPanel.webview.html = this.getComponentDetailsHtml(component);

    // Handle messages from the details panel
    detailsPanel.webview.onDidReceiveMessage(
      async message => {
        if (message.command === 'insertComponent') {
          // Handle different insertion options
          const { version, includeInputs, selectedInputs } = message;

          // Update component version if specified
          if (version && version !== component.version) {
            const updatedComponent = await this.cacheManager.fetchSpecificVersion(
              component.name,
              component.sourcePath,
              component.gitlabInstance,
              version
            );
            if (updatedComponent) {
              await this.insertComponent(updatedComponent, includeInputs, selectedInputs);
            } else {
              vscode.window.showErrorMessage(`Failed to fetch version ${version} of component ${component.name}`);
            }
          } else {
            await this.insertComponent(component, includeInputs, selectedInputs);
          }
        } else if (message.command === 'fetchVersions') {
          // Fetch available versions for the component
          try {
            const versions = await this.cacheManager.fetchComponentVersions(component);
            detailsPanel.webview.postMessage({
              command: 'versionsLoaded',
              versions: versions,
              currentVersion: component.version
            });
          } catch (error) {
            detailsPanel.webview.postMessage({
              command: 'versionsError',
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } else if (message.command === 'versionChanged') {
          // Fetch details for the selected version and update the display
          const { selectedVersion } = message;
          try {
            this.logger.debug(`[ComponentBrowser] Version changed to ${selectedVersion}, fetching details...`, 'ComponentBrowser');

            const updatedComponent = await this.cacheManager.fetchSpecificVersion(
              component.name,
              component.sourcePath,
              component.gitlabInstance,
              selectedVersion
            );
            if (updatedComponent) {
              // Send the updated component details to the webview
              detailsPanel.webview.postMessage({
                command: 'componentDetailsUpdated',
                component: updatedComponent
              });
            } else {
              detailsPanel.webview.postMessage({
                command: 'versionChangeError',
                error: `Failed to fetch details for version ${selectedVersion}`
              });
            }
          } catch (error) {
            this.logger.error(`[ComponentBrowser] Error fetching version details: ${error}`, 'ComponentBrowser');
            detailsPanel.webview.postMessage({
              command: 'versionChangeError',
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    );
  }

  private getLoadingHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GitLab CI/CD Components</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            background-color: var(--vscode-editor-background);
          }
          .loading {
            text-align: center;
            padding: 40px;
          }
          .spinner {
            border: 4px solid rgba(0, 0, 0, 0.1);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border-left-color: var(--vscode-button-background);
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="loading">
          <div class="spinner"></div>
          <p>Loading GitLab CI/CD components...</p>
        </div>
      </body>
      </html>
    `;
  }

  private getComponentBrowserHtml(componentGroups: any[], cacheErrors: Record<string, string> = {}): string {
    const hasErrors = Object.keys(cacheErrors).length > 0;

    // Prepare version data as a safe JSON string
    const versionData = componentGroups.reduce((acc: any, source: any) => {
      if (source.projects && Array.isArray(source.projects)) {
        source.projects.forEach((project: any) => {
          if (project.components && Array.isArray(project.components)) {
            project.components.forEach((component: any) => {
              if (!acc[component.name]) {
                acc[component.name] = {};
              }
              if (component.versions && Array.isArray(component.versions)) {
                component.versions.forEach((version: any) => {
                  acc[component.name][version.version] = version;
                });
              }
            });
          }
        });
      }
      return acc;
    }, {});

    const versionDataJson = JSON.stringify(versionData);

    // Build error section HTML
    const errorSectionHtml = hasErrors ? `
      <div class="error-section">
        <div class="error-header">⚠️ Cache Errors</div>
        ${Object.entries(cacheErrors).map(([source, error], index) => `
          <div class="error-item">
            <div class="error-source">${source}</div>
            <button class="error-toggle" onclick="toggleError('error-${index}')">Show Details</button>
            <div class="error-details" id="error-${index}" style="display: none;">${error}</div>
          </div>
        `).join('')}
      </div>
    ` : '';

    // Build components HTML
    const componentsHtml = componentGroups.length === 0 ?
      '<p class="no-components">No components found. Click "Refresh" to load components from your configured sources.</p>' :
      componentGroups.map((source: any) => {
        const sourceId = source.source.replace(/[^a-zA-Z0-9]/g, '_');
        const projectsHtml = (source.projects && Array.isArray(source.projects) ? source.projects : []).map((project: any) => {
          const projectId = `${sourceId}_${project.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
          const components = project.components && Array.isArray(project.components) ? project.components : [];
          const componentsHtml = components.length === 0 ?
            '<p class="no-components">No components found in this project</p>' :
            components.map((component: any) => `
              <div class="component-card" data-name="${component.name}" data-description="${component.description}" data-component-name="${component.name}" data-project-id="${projectId}" data-source-path="${component.sourcePath}" data-gitlab-instance="${component.gitlabInstance}">
                <div class="component-header">
                  <span class="component-title">
                    ${component.name}
                    ${component.versionCount > 1 ? `<span class="version-badge">${component.versionCount} versions</span>` : ''}
                  </span>
                  <div class="component-actions">
                    ${component.availableVersions && component.availableVersions.length > 1 ? `
                      <select class="version-dropdown" onchange="updateComponentVersion('${component.name}', this.value, '${projectId}')" oncontextmenu="showContextMenu(event, '${component.name}', this.value, '${projectId}')">
                        ${component.availableVersions.map((version: string) => `
                          <option value="${version}" ${version === component.defaultVersion ? 'selected' : ''}>${version}</option>
                        `).join('')}
                      </select>
                    ` : `<span class="single-version">${component.defaultVersion}</span>`}
                    <button onclick="viewDetailsById('${component.name}', '${component.defaultVersion}', '${projectId}')">Details</button>
                    <button onclick="insertComponentById('${component.name}', '${component.defaultVersion}', '${projectId}')">Insert</button>
                  </div>
                </div>
                <div class="component-description" id="desc-${component.name}-${projectId}">${component.description}</div>
                ${component.availableVersions && component.availableVersions.length > 1 ? `
                  <div class="version-info" id="version-info-${component.name}-${projectId}">
                    <small>Default version: ${component.defaultVersion}</small>
                  </div>
                ` : ''}
              </div>
            `).join('');

          return `
            <div class="project-group">
              <div class="project-header" onclick="toggleProject('${projectId}')">
                <span class="project-icon" id="project-icon-${projectId}">${project.isExpanded ? '▼' : '▶'}</span>
                <span class="project-title">${project.name} (${components.length})</span>
                <span class="project-path">${project.gitlabInstance}/${project.path}</span>
              </div>
              <div class="project-content" id="project-content-${projectId}" style="display: ${project.isExpanded ? 'block' : 'none'}">
                ${componentsHtml}
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="source-group">
            <div class="source-header" onclick="toggleSource('${sourceId}')">
              <span class="source-icon" id="source-icon-${sourceId}">${source.isExpanded ? '▼' : '▶'}</span>
              <span class="source-title">${source.source} (${source.projects?.length || 0} projects, ${source.totalComponents || 0} components)</span>
            </div>
            <div class="source-content" id="source-content-${sourceId}" style="display: ${source.isExpanded ? 'block' : 'none'}">
              ${projectsHtml}
            </div>
          </div>
        `;
      }).join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GitLab CI/CD Components</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            background-color: var(--vscode-editor-background);
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          .search-container {
            flex: 1;
            max-width: 400px;
            margin-right: 20px;
          }
          .search-container input {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 2px;
          }
          .cache-controls {
            display: flex;
            gap: 8px;
          }
          .refresh-btn, .update-cache-btn, .reset-cache-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
            transition: background-color 0.2s;
          }
          .refresh-btn:hover, .update-cache-btn:hover, .reset-cache-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          .update-cache-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          .update-cache-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
          }
          .reset-cache-btn {
            background-color: var(--vscode-editorError-background);
            color: var(--vscode-errorForeground);
            border: 1px solid var(--vscode-editorError-border);
          }
          .reset-cache-btn:hover {
            background-color: var(--vscode-editorError-foreground);
            color: var(--vscode-editorError-background);
          }
          .error-section {
            background-color: var(--vscode-editorError-background);
            border: 1px solid var(--vscode-editorError-border);
            border-radius: 5px;
            margin-bottom: 20px;
            padding: 15px;
          }
          .error-header {
            font-weight: bold;
            margin-bottom: 10px;
            color: var(--vscode-errorForeground);
          }
          .error-item {
            margin-bottom: 10px;
            padding: 10px;
            background-color: rgba(255, 0, 0, 0.1);
            border-radius: 3px;
          }
          .error-source {
            font-weight: bold;
            color: var(--vscode-errorForeground);
          }
          .error-toggle {
            background: none;
            border: none;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: underline;
            font-size: 0.9em;
          }
          .error-details {
            margin-top: 10px;
            padding: 10px;
            background-color: rgba(0, 0, 0, 0.1);
            border-radius: 3px;
            font-family: monospace;
            white-space: pre-wrap;
            font-size: 0.9em;
          }
          .source-group {
            margin-bottom: 20px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
          }
          .source-header {
            background-color: var(--vscode-panel-background);
            padding: 10px 15px;
            cursor: pointer;
            display: flex;
            align-items: center;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          .source-header:hover {
            background-color: var(--vscode-list-hoverBackground);
          }
          .source-icon {
            margin-right: 10px;
            font-family: monospace;
            font-weight: bold;
          }
          .source-title {
            font-weight: bold;
            flex: 1;
          }
          .source-content {
            padding: 0;
          }
          .project-group {
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          .project-group:last-child {
            border-bottom: none;
          }
          .project-header {
            background-color: var(--vscode-editor-background);
            padding: 8px 15px 8px 30px;
            cursor: pointer;
            display: flex;
            align-items: center;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          .project-header:hover {
            background-color: var(--vscode-list-hoverBackground);
          }
          .project-icon {
            margin-right: 8px;
            font-family: monospace;
            font-weight: bold;
            font-size: 0.9em;
          }
          .project-title {
            font-weight: bold;
            flex: 1;
            font-size: 0.95em;
          }
          .project-path {
            color: var(--vscode-disabledForeground);
            font-size: 0.85em;
            font-family: monospace;
          }
          .project-content {
            padding: 0;
            background-color: var(--vscode-editor-background);
          }
          .component-card {
            padding: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            margin-left: 45px;
          }
          .component-card:last-child {
            border-bottom: none;
          }
          .component-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          }
          .component-title {
            font-weight: bold;
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .version-badge {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 0.75em;
            padding: 2px 6px;
            border-radius: 10px;
            font-weight: normal;
          }
          .component-actions {
            display: flex;
            gap: 8px;
            align-items: center;
          }
          .version-dropdown {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 4px 8px;
            border-radius: 2px;
            font-size: 0.9em;
          }
          .single-version {
            color: var(--vscode-disabledForeground);
            font-size: 0.9em;
            font-family: monospace;
          }
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 0.85em;
          }
          button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          .component-description {
            color: var(--vscode-disabledForeground);
            font-size: 0.9em;
            margin-bottom: 8px;
          }
          .version-info {
            color: var(--vscode-disabledForeground);
            font-size: 0.8em;
          }
          .no-components {
            padding: 20px;
            text-align: center;
            color: var(--vscode-disabledForeground);
            font-style: italic;
          }
          .context-menu {
            position: absolute;
            background-color: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 3px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            min-width: 150px;
            display: none;
          }
          .context-menu-item {
            padding: 8px 12px;
            cursor: pointer;
            color: var(--vscode-menu-foreground);
            border-bottom: 1px solid var(--vscode-menu-separatorBackground);
          }
          .context-menu-item:last-child {
            border-bottom: none;
          }
          .context-menu-item:hover {
            background-color: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
          }
          .context-menu-item.disabled {
            color: var(--vscode-disabledForeground);
            cursor: not-allowed;
          }
          .context-menu-item.disabled:hover {
            background-color: transparent;
            color: var(--vscode-disabledForeground);
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="search-container">
            <input type="text" id="search" placeholder="Search components..." oninput="filterComponents()">
          </div>
          <div class="cache-controls">
            <button class="refresh-btn" onclick="refreshComponents()" title="Refresh components (reload current data)">🔄 Refresh</button>
            <button class="update-cache-btn" onclick="updateCache()" title="Update cache (force fetch fresh data from all sources)">📥 Update Cache</button>
            <button class="reset-cache-btn" onclick="resetCache()" title="Reset cache (clear all cached data)">🗑️ Reset Cache</button>
          </div>
        </div>

        ${errorSectionHtml}

        <div class="components-container">
          ${componentsHtml}
        </div>

        <!-- Context Menu -->
        <div id="contextMenu" class="context-menu">
          <div class="context-menu-item" onclick="setAsDefaultVersion()">Set as Default Version</div>
          <div class="context-menu-item" onclick="alwaysUseLatest()">Always Use Latest</div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          // Inject component version data for client-side version switching
          window.componentVersionData = ${versionDataJson};

          // Context menu variables
          let contextMenuTarget = null;
          let contextMenuData = null;

          function toggleError(errorId) {
            const errorDiv = document.getElementById(errorId);
            if (errorDiv.style.display === 'none' || errorDiv.style.display === '') {
              errorDiv.style.display = 'block';
            } else {
              errorDiv.style.display = 'none';
            }
          }

          function toggleSource(sourceId) {
            const content = document.getElementById('source-content-' + sourceId);
            const icon = document.getElementById('source-icon-' + sourceId);

            if (content.style.display === 'none') {
              content.style.display = 'block';
              icon.textContent = '▼';
            } else {
              content.style.display = 'none';
              icon.textContent = '▶';
            }
          }

          function toggleProject(projectId) {
            const content = document.getElementById('project-content-' + projectId);
            const icon = document.getElementById('project-icon-' + projectId);

            if (content.style.display === 'none') {
              content.style.display = 'block';
              icon.textContent = '▼';
            } else {
              content.style.display = 'none';
              icon.textContent = '▶';
            }
          }

          function updateComponentVersion(componentName, selectedVersion, projectId) {
            const componentData = window.componentVersionData[componentName];
            if (!componentData || !componentData[selectedVersion]) {
              console.warn('Version data not found for', componentName, selectedVersion);

              // Try to fetch this version dynamically
              const componentCard = document.querySelector('[data-component-name="' + componentName + '"][data-project-id="' + projectId + '"]');
              if (componentCard) {
                const sourcePath = componentCard.getAttribute('data-source-path');
                const gitlabInstance = componentCard.getAttribute('data-gitlab-instance');

                if (sourcePath && gitlabInstance) {
                  // Show loading state
                  const versionInfoElement = document.getElementById('version-info-' + componentName + '-' + projectId);
                  if (versionInfoElement) {
                    versionInfoElement.innerHTML = '<small>Loading version ' + selectedVersion + '...</small>';
                  }

                  // Request the version from the backend
                  vscode.postMessage({
                    command: 'fetchVersion',
                    componentName: componentName,
                    sourcePath: sourcePath,
                    gitlabInstance: gitlabInstance,
                    version: selectedVersion
                  });
                }
              }
              return;
            }

            const versionData = componentData[selectedVersion];

            // Update the description
            const descElement = document.getElementById('desc-' + componentName + '-' + projectId);
            if (descElement) {
              descElement.textContent = versionData.description;
            }

            // Update version info
            const versionInfoElement = document.getElementById('version-info-' + componentName + '-' + projectId);
            if (versionInfoElement) {
              versionInfoElement.innerHTML = '<small>Selected version: ' + selectedVersion + '</small>';
            }

            // Update the Insert button to use the selected version
            const insertButton = document.querySelector('[data-component-name="' + componentName + '"][data-project-id="' + projectId + '"] button[onclick*="insertComponent"]');
            if (insertButton) {
              insertButton.setAttribute('onclick', 'insertComponentById("' + componentName + '", "' + selectedVersion + '", "' + projectId + '")');
            }

            // Update the Details button to use the selected version
            const detailsButton = document.querySelector('[data-component-name="' + componentName + '"][data-project-id="' + projectId + '"] button[onclick*="viewDetails"]');
            if (detailsButton) {
              detailsButton.setAttribute('onclick', 'viewDetailsById("' + componentName + '", "' + selectedVersion + '", "' + projectId + '")');
            }
          }

          function refreshComponents() {
            vscode.postMessage({ command: 'refreshComponents' });
          }

          function updateCache() {
            vscode.postMessage({ command: 'updateCache' });
          }

          function resetCache() {
            vscode.postMessage({ command: 'resetCache' });
          }

          function insertComponent(component) {
            vscode.postMessage({ command: 'insertComponent', component });
          }

          function viewDetails(component) {
            vscode.postMessage({ command: 'viewComponentDetails', component });
          }

          function viewDetailsById(componentName, version, projectId) {
            const componentData = window.componentVersionData[componentName];
            if (componentData && componentData[version]) {
              const component = {
                ...componentData[version],
                name: componentName,
                version: version
              };
              vscode.postMessage({ command: 'viewComponentDetails', component });
            }
          }

          function insertComponentById(componentName, version, projectId) {
            const componentData = window.componentVersionData[componentName];
            if (componentData && componentData[version]) {
              const versionData = componentData[version];
              const component = {
                name: componentName,
                sourcePath: versionData.sourcePath,
                version: version,
                gitlabInstance: versionData.gitlabInstance || 'gitlab.com'
              };
              vscode.postMessage({ command: 'insertComponent', component });
            }
          }

          function filterComponents() {
            const searchText = document.getElementById('search').value.toLowerCase();
            const cards = document.getElementsByClassName('component-card');
            let hasVisibleComponents = false;

            // Track which projects and sources should be visible
            const visibleProjects = new Set();
            const visibleSources = new Set();

            for (let card of cards) {
              const name = card.getAttribute('data-name').toLowerCase();
              const description = card.getAttribute('data-description').toLowerCase();

              if (name.includes(searchText) || description.includes(searchText)) {
                card.style.display = '';
                hasVisibleComponents = true;

                // Find the parent project and source
                let projectContent = card.closest('.project-content');
                let sourceContent = card.closest('.source-content');

                if (projectContent) {
                  const projectId = projectContent.id.replace('project-content-', '');
                  visibleProjects.add(projectId);
                }

                if (sourceContent) {
                  const sourceId = sourceContent.id.replace('source-content-', '');
                  visibleSources.add(sourceId);
                }
              } else {
                card.style.display = 'none';
              }
            }

            // Show/hide projects based on whether they have visible components
            const projects = document.getElementsByClassName('project-group');
            for (let project of projects) {
              const projectContent = project.querySelector('.project-content');
              if (projectContent) {
                const projectId = projectContent.id.replace('project-content-', '');
                const hasVisibleCards = visibleProjects.has(projectId);

                if (hasVisibleCards || searchText === '') {
                  project.style.display = '';
                  // Auto-expand if searching and has results
                  if (searchText !== '' && hasVisibleCards) {
                    projectContent.style.display = 'block';
                    const icon = document.getElementById('project-icon-' + projectId);
                    if (icon) icon.textContent = '▼';
                  }
                } else {
                  project.style.display = 'none';
                }
              }
            }

            // Show/hide sources based on whether they have visible projects
            const sources = document.getElementsByClassName('source-group');
            for (let source of sources) {
              const sourceContent = source.querySelector('.source-content');
              if (sourceContent) {
                const sourceId = sourceContent.id.replace('source-content-', '');
                const hasVisibleProjects = visibleSources.has(sourceId);

                if (hasVisibleProjects || searchText === '') {
                  source.style.display = '';
                  // Auto-expand if searching and has results
                  if (searchText !== '' && hasVisibleProjects) {
                    sourceContent.style.display = 'block';
                    const icon = document.getElementById('source-icon-' + sourceId);
                    if (icon) icon.textContent = '▼';
                  }
                } else {
                  source.style.display = 'none';
                }
              }
            }
          }

          // Context menu functions
          function showContextMenu(event, componentName, version, projectId) {
            event.preventDefault();
            event.stopPropagation();

            const contextMenu = document.getElementById('contextMenu');
            contextMenuTarget = event.target;
            contextMenuData = { componentName, version, projectId };

            contextMenu.style.display = 'block';
            contextMenu.style.left = event.pageX + 'px';
            contextMenu.style.top = event.pageY + 'px';
          }

          function hideContextMenu() {
            const contextMenu = document.getElementById('contextMenu');
            contextMenu.style.display = 'none';
            contextMenuTarget = null;
            contextMenuData = null;
          }

          function setAsDefaultVersion() {
            if (contextMenuData) {
              vscode.postMessage({
                command: 'setDefaultVersion',
                componentName: contextMenuData.componentName,
                version: contextMenuData.version,
                projectId: contextMenuData.projectId
              });
            }
            hideContextMenu();
          }

          function alwaysUseLatest() {
            if (contextMenuData) {
              vscode.postMessage({
                command: 'setAlwaysUseLatest',
                componentName: contextMenuData.componentName,
                projectId: contextMenuData.projectId
              });
            }
            hideContextMenu();
          }

          // Hide context menu when clicking elsewhere
          document.addEventListener('click', function(event) {
            if (!event.target.closest('.context-menu')) {
              hideContextMenu();
            }
          });

          // Handle messages from the extension
          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
              case 'versionFetched':
                // Update the component data with the newly fetched version
                if (!window.componentVersionData[message.componentName]) {
                  window.componentVersionData[message.componentName] = {};
                }
                window.componentVersionData[message.componentName][message.version] = message.component;

                // Update the UI for this version
                const projectId = findProjectIdForComponent(message.componentName);
                if (projectId) {
                  updateComponentVersion(message.componentName, message.version, projectId);
                }
                break;
            }
          });

          function findProjectIdForComponent(componentName) {
            const componentCard = document.querySelector('[data-component-name="' + componentName + '"]');
            return componentCard ? componentCard.getAttribute('data-project-id') : null;
          }

          // ...existing code...
        </script>
      </body>
      </html>
    `;
  }

  private getComponentDetailsHtml(component: any): string {
    const parameters = component.parameters || [];
    const availableVersions = component.availableVersions || [component.version || 'main'];

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Component: ${component.name}</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            background-color: var(--vscode-editor-background);
          }
          h1 {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
          }
          .description {
            margin-bottom: 20px;
          }
          .metadata {
            background-color: var(--vscode-panel-background);
            padding: 10px;
            border-radius: 5px;
            margin-bottom: 20px;
          }
          .metadata div {
            margin-bottom: 5px;
          }
          .version-control {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          .version-control select {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 2px;
            padding: 4px 8px;
            min-width: 120px;
          }
          .version-loading {
            font-size: 0.9em;
            color: var(--vscode-disabledForeground);
          }
          .parameters {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
          }
          .parameter {
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .parameter:last-child {
            border-bottom: none;
          }
          .parameter-content {
            flex: 1;
            margin-right: 15px;
          }
          .parameter-checkbox {
            display: flex;
            align-items: center;
            gap: 5px;
            margin-top: 5px;
          }
          .parameter-name {
            font-weight: bold;
          }
          .parameter-required {
            color: var(--vscode-errorForeground);
            font-size: 0.9em;
          }
          .parameter-optional {
            color: var(--vscode-disabledForeground);
            font-size: 0.9em;
          }
          .parameter-default {
            font-family: monospace;
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
          }
          .parameters-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
          }
          .select-all-group {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.9em;
          }
          .insert-options {
            margin-top: 20px;
            padding: 15px;
            background-color: var(--vscode-panel-background);
            border-radius: 5px;
          }
          .insert-options h3 {
            margin-top: 0;
            margin-bottom: 15px;
          }
          .checkbox-group {
            margin-bottom: 15px;
          }
          .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
          }
          .checkbox-group input[type="checkbox"] {
            margin: 0;
          }
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 2px;
            cursor: pointer;
          }
          button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
          }
        </style>
      </head>
      <body>
        <h1 id="componentName">${component.name}</h1>

        <div class="description" id="componentDescription">
          ${component.description}
        </div>

        <div class="metadata">
          <div><strong>Source:</strong> <span id="componentSource">${component.source}</span></div>
          <div><strong>GitLab Instance:</strong> <span id="componentInstance">${component.gitlabInstance || 'gitlab.com'}</span></div>
          <div class="version-control">
            <strong>Version:</strong>
            <select id="versionSelect" onchange="onVersionChange()">
              ${availableVersions.map((version: string) =>
                `<option value="${version}" ${version === component.version ? 'selected' : ''}>${version}</option>`
              ).join('')}
            </select>
            <span class="version-loading" id="versionLoading" style="display: none;">Loading version details...</span>
          </div>
          ${component.documentationUrl ?
            `<div><strong>Project URL:</strong> <a href="${component.documentationUrl}" target="_blank" id="componentDocUrl">${component.documentationUrl}</a></div>` : ''}
          ${component.url ?
            `<div><strong>Component URL:</strong> <a href="${component.url}" target="_blank" id="componentUrl">${component.url}</a></div>` : ''}
        </div>

        <div class="parameters-header">
          <h2>Parameters</h2>
          ${parameters.length > 0 ? `
            <div class="select-all-group">
              <input type="checkbox" id="selectAllInputs" onchange="toggleAllInputs()">
              <label for="selectAllInputs">Select All</label>
            </div>
          ` : ''}
        </div>
        <div id="parametersContainer">
          ${parameters.length === 0 ?
            '<p>No parameters documented for this component.</p>' :
            `<div class="parameters">
              ${parameters.map((param: ComponentParameter) => `
                <div class="parameter">
                  <div class="parameter-content">
                    <div>
                      <span class="parameter-name">${param.name}</span>
                      <span class="${param.required ? 'parameter-required' : 'parameter-optional'}">
                        (${param.required ? 'required' : 'optional'})
                      </span>
                    </div>
                    <div>${param.description || `Parameter: ${param.name}`}</div>
                    <div><strong>Type:</strong> ${param.type || 'string'}</div>
                    ${param.default !== undefined ?
                      `<div><strong>Default:</strong> <span class="parameter-default">${param.default}</span></div>` : ''}
                  </div>
                  <div class="parameter-checkbox">
                    <input type="checkbox" id="input-${param.name}" class="input-checkbox" onchange="updateInputSelection()" data-param-name="${param.name}">
                    <label for="input-${param.name}">Insert</label>
                  </div>
                </div>
              `).join('')}
            </div>`
          }
        </div>

        <div class="insert-options">
          <h3>Insert Options</h3>
          <div class="checkbox-group">
            <label>
              <input type="checkbox" id="includeInputs">
              Include input parameters with default values
            </label>
          </div>
          <div class="button-group">
            <button onclick="insertComponent()">Insert Component</button>
            <button class="secondary" onclick="refreshVersions()">Refresh Versions</button>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          let currentVersions = ${JSON.stringify(availableVersions)};
          let versionsLoaded = ${availableVersions.length > 1};

          function insertComponent() {
            const selectedVersion = document.getElementById('versionSelect').value;
            const includeInputs = document.getElementById('includeInputs')?.checked || false;

            // Get selected individual inputs
            const selectedInputs = [];
            const inputCheckboxes = document.querySelectorAll('.input-checkbox:checked');
            inputCheckboxes.forEach(checkbox => {
              selectedInputs.push(checkbox.getAttribute('data-param-name'));
            });

            vscode.postMessage({
              command: 'insertComponent',
              version: selectedVersion,
              includeInputs: includeInputs,
              selectedInputs: selectedInputs
            });
          }

          function toggleAllInputs() {
            const selectAllCheckbox = document.getElementById('selectAllInputs');
            const inputCheckboxes = document.querySelectorAll('.input-checkbox');

            inputCheckboxes.forEach(checkbox => {
              checkbox.checked = selectAllCheckbox.checked;
            });

            updateInputSelection();
          }

          function updateInputSelection() {
            const inputCheckboxes = document.querySelectorAll('.input-checkbox');
            const checkedInputs = document.querySelectorAll('.input-checkbox:checked');
            const selectAllCheckbox = document.getElementById('selectAllInputs');
            const includeInputsCheckbox = document.getElementById('includeInputs');

            // Update select all checkbox state
            if (checkedInputs.length === 0) {
              selectAllCheckbox.checked = false;
              selectAllCheckbox.indeterminate = false;
            } else if (checkedInputs.length === inputCheckboxes.length) {
              selectAllCheckbox.checked = true;
              selectAllCheckbox.indeterminate = false;
            } else {
              selectAllCheckbox.checked = false;
              selectAllCheckbox.indeterminate = true;
            }

            // Auto-check "Include input parameters" if any individual inputs are selected
            if (checkedInputs.length > 0) {
              includeInputsCheckbox.checked = true;
            }
          }

          function onVersionChange() {
            const selectedVersion = document.getElementById('versionSelect').value;
            const loading = document.getElementById('versionLoading');

            console.log('Version changed to:', selectedVersion);

            // Show loading state
            loading.style.display = 'inline';

            // Send message to fetch details for this version
            vscode.postMessage({
              command: 'versionChanged',
              selectedVersion: selectedVersion
            });
          }

          function refreshVersions() {
            const loading = document.getElementById('versionLoading');
            const select = document.getElementById('versionSelect');

            loading.style.display = 'inline';
            select.disabled = true;

            vscode.postMessage({ command: 'fetchVersions' });
          }

          function updateComponentDetails(component) {
            console.log('Updating component details:', component);

            // Update component name
            document.getElementById('componentName').textContent = component.name;

            // Update description
            document.getElementById('componentDescription').textContent = component.description || 'No description available';

            // Update source if available
            if (component.source) {
              document.getElementById('componentSource').textContent = component.source;
            }

            // Update GitLab instance if available
            if (component.gitlabInstance) {
              document.getElementById('componentInstance').textContent = component.gitlabInstance;
            }

            // Update documentation URL if available
            const docUrlElement = document.getElementById('componentDocUrl');
            if (component.documentationUrl && docUrlElement) {
              docUrlElement.href = component.documentationUrl;
              docUrlElement.textContent = component.documentationUrl;
            }

            // Update component URL
            const componentUrlElement = document.getElementById('componentUrl');
            if (component.url && componentUrlElement) {
              componentUrlElement.href = component.url;
              componentUrlElement.textContent = component.url;
            }

            // Update parameters
            const parametersContainer = document.getElementById('parametersContainer');
            const parameters = component.parameters || [];

            if (parameters.length === 0) {
              parametersContainer.innerHTML = '<p>No parameters documented for this component.</p>';
            } else {
              let parametersHtml = '<div class="parameters">';
              parameters.forEach(param => {
                parametersHtml += '<div class="parameter">';
                parametersHtml += '<div class="parameter-content">';
                parametersHtml += '<div>';
                parametersHtml += '<span class="parameter-name">' + param.name + '</span>';
                parametersHtml += '<span class="' + (param.required ? 'parameter-required' : 'parameter-optional') + '">';
                parametersHtml += '(' + (param.required ? 'required' : 'optional') + ')';
                parametersHtml += '</span>';
                parametersHtml += '</div>';
                parametersHtml += '<div>' + (param.description || ('Parameter: ' + param.name)) + '</div>';
                parametersHtml += '<div><strong>Type:</strong> ' + (param.type || 'string') + '</div>';
                if (param.default !== undefined) {
                  parametersHtml += '<div><strong>Default:</strong> <span class="parameter-default">' + param.default + '</span></div>';
                }
                parametersHtml += '</div>';
                parametersHtml += '<div class="parameter-checkbox">';
                parametersHtml += '<input type="checkbox" id="input-' + param.name + '" class="input-checkbox" onchange="updateInputSelection()" data-param-name="' + param.name + '">';
                parametersHtml += '<label for="input-' + param.name + '">Insert</label>';
                parametersHtml += '</div>';
                parametersHtml += '</div>';
              });
              parametersHtml += '</div>';
              parametersContainer.innerHTML = parametersHtml;
            }

            // Update select all checkbox visibility and reset state
            const selectAllGroup = document.querySelector('.select-all-group');
            if (selectAllGroup) {
              selectAllGroup.style.display = parameters.length > 0 ? 'flex' : 'none';
              // Reset select all checkbox state
              const selectAllCheckbox = document.getElementById('selectAllInputs');
              if (selectAllCheckbox) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
              }
            }

            // Update checkbox visibility based on parameters
            const includeInputsCheckbox = document.getElementById('includeInputs');
            if (includeInputsCheckbox && includeInputsCheckbox.parentElement && includeInputsCheckbox.parentElement.parentElement) {
              includeInputsCheckbox.parentElement.parentElement.style.display = parameters.length > 0 ? 'block' : 'none';
            }

            // Hide loading indicator
            document.getElementById('versionLoading').style.display = 'none';
          }

          // Handle messages from the extension
          window.addEventListener('message', event => {
            const message = event.data;
            console.log('Received message:', message);

            switch (message.command) {
              case 'versionsLoaded':
                updateVersionDropdown(message.versions, message.currentVersion);
                break;
              case 'versionsError':
                document.getElementById('versionLoading').style.display = 'none';
                document.getElementById('versionSelect').disabled = false;
                // Could show error message here
                break;
              case 'componentDetailsUpdated':
                updateComponentDetails(message.component);
                break;
              case 'versionChangeError':
                document.getElementById('versionLoading').style.display = 'none';
                // Could show error message here
                console.error('Version change error:', message.error);
                break;
            }
          });

          function updateVersionDropdown(versions, currentVersion) {
            const select = document.getElementById('versionSelect');
            const loading = document.getElementById('versionLoading');

            // Clear existing options
            select.innerHTML = '';

            // Add new options
            versions.forEach(version => {
              const option = document.createElement('option');
              option.value = version;
              option.textContent = version;
              if (version === currentVersion) {
                option.selected = true;
              }
              select.appendChild(option);
            });

            loading.style.display = 'none';
            select.disabled = false;
            currentVersions = versions;
            versionsLoaded = true;
          }

          // Auto-fetch versions if not already loaded
          if (!versionsLoaded) {
            setTimeout(() => {
              refreshVersions();
            }, 500);
          }
        </script>
      </body>
      </html>
    `;
  }

  private getNoSourcesHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GitLab CI/CD Components</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            background-color: var(--vscode-editor-background);
          }
          .guidance {
            background-color: var(--vscode-panel-background);
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
          }
          pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 3px;
            overflow-x: auto;
          }
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 2px;
            cursor: pointer;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <h1>Configure Component Sources</h1>

        <div class="guidance">
          <p>No GitLab component sources are configured. Please add sources in your settings.</p>

          <p>Go to: <strong>Settings > Extensions > GitLab Component Helper > Component Sources</strong></p>

          <p>Example configuration:</p>
          <pre>
  [
    {
      "name": "GitLab CI Examples",
      "path": "gitlab-org/gitlab-foss",
      "gitlabInstance": "gitlab.com"
    },
    {
      "name": "OpenTofu Components",
      "path": "components/opentofu",
      "gitlabInstance": "gitlab.com"
    },
    {
      "name": "Internal Components",
      "path": "your-group/your-project",
      "gitlabInstance": "gitlab.your-company.com"
    }
  ]</pre>
        </div>

        <button onclick="openSettings()">Open Settings</button>

        <script>
          const vscode = acquireVsCodeApi();

          function openSettings() {
            vscode.postMessage({ command: 'openSettings' });
          }
        </script>
      </body>
      </html>
    `;
  }

  private getErrorsHtml(errors: string[]): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GitLab CI/CD Components</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            background-color: var(--vscode-editor-background);
          }
          .errors {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 10px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .error-item {
            margin: 8px 0;
          }
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 2px;
            cursor: pointer;
            margin-right: 8px;
          }
        </style>
      </head>
      <body>
        <h1>Component Loading Errors</h1>

        <p>There were errors loading components from the configured sources:</p>

        <div class="errors">
          ${errors.map((error: string) => `<div class="error-item">• ${error}</div>`).join('')}
        </div>

        <div>
          <button onclick="refresh()">Try Again</button>
          <button onclick="openSettings()">Open Settings</button>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          function refresh() {
            vscode.postMessage({ command: 'refreshComponents' });
          }

          function openSettings() {
            vscode.postMessage({ command: 'openSettings' });
          }
        </script>
      </body>
      </html>
    `;
  }

  private async showCacheStatus() {
    const cachedComponents = await this.cacheManager.getComponents();
    const sourceErrors = this.cacheManager.getSourceErrors();
    const totalComponents = cachedComponents.length;

    const status = `Cache Status:
- ${totalComponents} total components cached
- ${sourceErrors.size} sources with errors

${sourceErrors.size > 0 ? '\nErrors:\n' + Array.from(sourceErrors.entries()).map(([source, error]) => `- ${source}: ${error}`).join('\n') : ''}`;

    vscode.window.showInformationMessage(status, { modal: true });
  }

  private async updateCache() {
    this.logger.info('[ComponentBrowser] Update cache requested from browser', 'ComponentBrowser');

    try {
      // Show loading state in the webview
      if (this.panel) {
        this.panel.webview.postMessage({
          command: 'showLoading',
          message: 'Updating cache and fetching fresh data...'
        });
      }

      // Update the cache
      await this.cacheManager.updateCache();

      // Reload components in the browser
      await this.loadComponents(true);

      // Show success message
      vscode.window.showInformationMessage('✅ GitLab component cache updated successfully!');

    } catch (error) {
      this.logger.error(`[ComponentBrowser] Cache update failed: ${error}`, 'ComponentBrowser');
      vscode.window.showErrorMessage(`❌ Failed to update cache: ${error}`);

      // Show error state in the webview
      if (this.panel) {
        this.panel.webview.postMessage({
          command: 'showError',
          message: `Failed to update cache: ${error}`
        });
      }
    }
  }

  private async resetCache() {
    this.logger.info('[ComponentBrowser] Reset cache requested from browser', 'ComponentBrowser');

    // Ask for confirmation before resetting
    const confirmation = await vscode.window.showWarningMessage(
      'Are you sure you want to reset the cache? This will clear all cached components and force them to be re-downloaded.',
      { modal: true },
      'Reset Cache',
      'Cancel'
    );

    if (confirmation === 'Reset Cache') {
      try {
        // Show loading state in the webview
        if (this.panel) {
          this.panel.webview.postMessage({
            command: 'showLoading',
            message: 'Resetting cache and clearing all data...'
          });
        }

        // Reset the cache
        await this.cacheManager.resetCache();

        // Clear the browser and show empty state
        if (this.panel) {
          this.panel.webview.html = this.getLoadingHtml();
        }

        // Reload components in the browser (this will fetch fresh data)
        await this.loadComponents(true);

        // Show success message
        vscode.window.showInformationMessage('🗑️ GitLab component cache reset successfully! Fresh data loaded.');

      } catch (error) {
        this.logger.error(`[ComponentBrowser] Cache reset failed: ${error}`, 'ComponentBrowser');
        vscode.window.showErrorMessage(`❌ Failed to reset cache: ${error}`);

        // Show error state in the webview
        if (this.panel) {
          this.panel.webview.postMessage({
            command: 'showError',
            message: `Failed to reset cache: ${error}`
          });
        }
      }
    } else {
      this.logger.debug('[ComponentBrowser] Cache reset cancelled by user', 'ComponentBrowser');
    }
  }

  private transformCachedComponentsToGroups(cachedComponents: any[]): any[] {
    // Create a hierarchical structure: Source -> Project -> Components (with versions)
    const hierarchy = new Map<string, any>();

    for (const comp of cachedComponents) {
      // Skip components with missing essential data
      if (!comp.source || !comp.sourcePath || !comp.name) {
        this.logger.warn(`[ComponentBrowser] Skipping component with missing data: ${JSON.stringify(comp)}`, 'ComponentBrowser');
        continue;
      }

      // Extract source (main source name, like "GitLab Components Group")
      const mainSource = comp.source.split('/')[0]; // Get the main source before any '/'

      // Get project name (either the full source for simple sources, or the project part for groups)
      let projectName = comp.source;
      let projectPath = comp.sourcePath;

      // For group sources, parse out the individual project
      if (comp.source.includes('/')) {
        const parts = comp.source.split('/');
        projectName = parts[parts.length - 1]; // Get the project name
        projectPath = comp.sourcePath;
      }

      // Initialize main source if not exists
      if (!hierarchy.has(mainSource)) {
        hierarchy.set(mainSource, {
          source: mainSource,
          type: 'source',
          isExpanded: true, // Sources start expanded
          projects: new Map<string, any>(),
          totalComponents: 0,
          totalVersions: 0
        });
      }

      const sourceGroup = hierarchy.get(mainSource)!;

      // Initialize project if not exists
      const projectKey = `${projectPath}@${comp.gitlabInstance}`;
      if (!sourceGroup.projects.has(projectKey)) {
        sourceGroup.projects.set(projectKey, {
          name: projectName,
          path: projectPath,
          gitlabInstance: comp.gitlabInstance,
          type: 'project',
          isExpanded: false, // Projects start collapsed
          components: new Map<string, any>() // Map by component name to group versions
        });
      }

      const projectGroup = sourceGroup.projects.get(projectKey)!;

      // Group components by name to handle multiple versions
      if (!projectGroup.components.has(comp.name)) {
        projectGroup.components.set(comp.name, {
          name: comp.name,
          description: comp.description || 'No description available',
          parameters: comp.parameters || [],
          source: comp.source,
          sourcePath: comp.sourcePath,
          gitlabInstance: comp.gitlabInstance || 'gitlab.com',
          documentationUrl: comp.url ? this.extractProjectUrl(comp.url) : '',
          versions: new Map<string, any>(),
          defaultVersion: comp.version || 'latest' // Use first encountered as default
        });
        sourceGroup.totalComponents++;
      }

      const componentGroup = projectGroup.components.get(comp.name)!;

      // Add this version to the component
      componentGroup.versions.set(comp.version || 'latest', {
        version: comp.version || 'latest',
        description: comp.description || 'No description available',
        parameters: comp.parameters || [],
        documentationUrl: comp.url ? this.extractProjectUrl(comp.url) : '',
        source: comp.source,
        sourcePath: comp.sourcePath,
        gitlabInstance: comp.gitlabInstance || 'gitlab.com'
      });

      sourceGroup.totalVersions++;
    }

    // Convert to array format with nested structure
    return Array.from(hierarchy.values()).map(source => ({
      ...source,
      projectCount: source.projects.size,
      componentCount: source.totalComponents,
      projects: Array.from(source.projects.values()).map((project: any) => ({
        ...project,
        components: Array.from(project.components.values()).map((component: any) => {
          // Determine the best default version using available versions if present
          const availableVersions = component.availableVersions || [component.version || 'latest'];
          const versions: any[] = availableVersions.filter(Boolean).map((version: string) => ({
            version: version,
            description: component.description || 'No description available',
            parameters: component.parameters || [],
            documentationUrl: component.url ? this.extractProjectUrl(component.url) : '',
            source: component.source,
            sourcePath: component.sourcePath,
            gitlabInstance: component.gitlabInstance || 'gitlab.com'
          }));

          let defaultVersion = component.version || 'latest';

          // Find the best version to use as default
          const versionPriority = (version: string | undefined) => {
            if (!version) return 0; // Handle undefined/null versions
            if (version === 'latest') return 1000; // Highest priority
            if (version === 'main') return 900;
            if (version === 'master') return 800;

            // Semantic versions get priority based on version number
            const semanticMatch = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
            if (semanticMatch) {
              const major = parseInt(semanticMatch[1]);
              const minor = parseInt(semanticMatch[2]);
              const patch = parseInt(semanticMatch[3]);
              return major * 1000000 + minor * 1000 + patch;
            }

            return 0; // Lowest priority for other versions
          };

          if (availableVersions.length > 0) {
            const validVersions = availableVersions.filter(Boolean); // Filter out null/undefined versions
            if (validVersions.length > 0) {
              const bestVersionString = validVersions.reduce((best: string, current: string) => {
                return versionPriority(current) > versionPriority(best) ? current : best;
              }, validVersions[0]);

              defaultVersion = bestVersionString;

              // Resolve 'latest' to the actual latest tag version
              if (defaultVersion === 'latest') {
                // Filter out 'latest' and find the best actual version
                const nonLatestVersions = validVersions.filter((v: string) => v !== 'latest');
                if (nonLatestVersions.length > 0) {
                  const resolvedLatestVersion = nonLatestVersions.reduce((latest: string, current: string) => {
                    return versionPriority(current) > versionPriority(latest) ? current : latest;
                  }, nonLatestVersions[0]);
                  defaultVersion = resolvedLatestVersion;
                }
              }
            }
          }

          return {
            ...component,
            versions: versions,
            versionCount: availableVersions.filter(Boolean).length,
            defaultVersion: defaultVersion,
            availableVersions: availableVersions.filter(Boolean),
            description: component.description || 'No description available',
            parameters: component.parameters || [],
            gitlabInstance: component.gitlabInstance || 'gitlab.com'
          };
        })
      }))
    }));
  }

  private getErrorHtml(error: any): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GitLab CI/CD Components - Error</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            background-color: var(--vscode-editor-background);
          }
          .error {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 2px;
            cursor: pointer;
            margin-right: 8px;
          }
        </style>
      </head>
      <body>
        <h1>Component Loading Error</h1>

        <div class="error">
          <strong>Error:</strong> ${error}
        </div>

        <div>
          <button onclick="refresh()">Try Again</button>
          <button onclick="openSettings()">Open Settings</button>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          function refresh() {
            vscode.postMessage({ command: 'refreshComponents' });
          }

          function openSettings() {
            vscode.postMessage({ command: 'openSettings' });
          }
        </script>
      </body>
      </html>
    `;
  }

  /**
   * Extract project URL from component URL
   * Converts: https://gitlab.example.com/group/project/component@version
   * To: https://gitlab.example.com/group/project
   */
  private extractProjectUrl(componentUrl: string | undefined): string {
    try {
      if (!componentUrl) {
        return '';
      }

      // Remove version suffix if present
      const urlWithoutVersion = componentUrl.includes('@') ?
        componentUrl.split('@')[0] : componentUrl;

      const url = new URL(urlWithoutVersion);
      const pathParts = url.pathname.substring(1).split('/');

      // Remove the component name (last part)
      if (pathParts.length > 0) {
        pathParts.pop();
      }

      // Construct project URL
      return `${url.protocol}//${url.host}/${pathParts.join('/')}`;
    } catch (error) {
      this.logger.warn(`[ComponentBrowser] Error extracting project URL from ${componentUrl}: ${error}`, 'ComponentBrowser');
      return componentUrl || '';
    }
  }

  private async fetchAndCacheVersion(componentName: string, sourcePath: string, gitlabInstance: string, version: string) {
    try {
      this.logger.debug(`[ComponentBrowser] Fetching version ${version} for ${componentName}`, 'ComponentBrowser');

      const cachedComponent = await this.cacheManager.fetchSpecificVersion(componentName, sourcePath, gitlabInstance, version);

      if (cachedComponent) {
        this.logger.debug(`[ComponentBrowser] Successfully cached version ${version}`, 'ComponentBrowser');

        // Send update to webview
        if (this.panel) {
          this.panel.webview.postMessage({
            command: 'versionFetched',
            componentName: componentName,
            version: version,
            component: cachedComponent
          });
        }
      } else {
        this.logger.warn(`[ComponentBrowser] Failed to fetch version ${version}`, 'ComponentBrowser');
        vscode.window.showErrorMessage(`Failed to fetch version ${version} for component ${componentName}`);
      }
    } catch (error) {
      this.logger.error(`[ComponentBrowser] Error fetching version: ${error}`, 'ComponentBrowser');
      vscode.window.showErrorMessage(`Error fetching version: ${error}`);
    }
  }

  private async setDefaultVersion(componentName: string, version: string, projectId: string) {
    try {
      // Store user preference for this component's default version
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const defaultVersions = config.get<Record<string, string>>('defaultVersions', {});
      defaultVersions[componentName] = version;
      await config.update('defaultVersions', defaultVersions, vscode.ConfigurationTarget.Global);

      this.logger.debug(`[ComponentBrowser] Set default version for ${componentName} to ${version}`, 'ComponentBrowser');
      vscode.window.showInformationMessage(`Set default version for ${componentName} to ${version}`);

    } catch (error) {
      this.logger.error(`[ComponentBrowser] Error setting default version: ${error}`, 'ComponentBrowser');
      vscode.window.showErrorMessage(`Error setting default version: ${error}`);
    }
  }

  private async setAlwaysUseLatest(componentName: string, projectId: string) {
    try {
      // Store user preference to always use latest for this component
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const alwaysLatest = config.get<string[]>('alwaysUseLatest', []);
      if (!alwaysLatest.includes(componentName)) {
        alwaysLatest.push(componentName);
        await config.update('alwaysUseLatest', alwaysLatest, vscode.ConfigurationTarget.Global);
      }

      // Remove any specific default version for this component
      const defaultVersions = config.get<Record<string, string>>('defaultVersions', {});
      if (defaultVersions[componentName]) {
        delete defaultVersions[componentName];
        await config.update('defaultVersions', defaultVersions, vscode.ConfigurationTarget.Global);
      }

      this.logger.debug(`[ComponentBrowser] Set ${componentName} to always use latest version`, 'ComponentBrowser');
      vscode.window.showInformationMessage(`${componentName} will now always use the latest version`);

    } catch (error) {
      this.logger.error(`[ComponentBrowser] Error setting always use latest: ${error}`, 'ComponentBrowser');
      vscode.window.showErrorMessage(`Error setting always use latest: ${error}`);
    }
  }

  private async fetchSpecificVersion(component: any, version: string): Promise<any | null> {
    try {
      this.logger.debug(`[ComponentBrowser] Fetching version ${version} of ${component.name}`, 'ComponentBrowser');

      // Use the cache manager to fetch the specific version
      const specificComponent = await this.cacheManager.fetchSpecificVersion(
        component.name,
        component.sourcePath,
        component.gitlabInstance,
        version
      );

      return specificComponent;
    } catch (error) {
      this.logger.error(`[ComponentBrowser] Error fetching version ${version}: ${error}`, 'ComponentBrowser');
      return null;
    }
  }

  // Public method to edit an existing component from detached view (called from extension.ts)
  public async editExistingComponentFromDetached(
    component: any,
    documentUri: string,
    position: { line: number; character: number },
    includeInputs: boolean = false,
    selectedInputs?: string[]
  ) {
    // Open the document that contains the component
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri));
    const editor = await vscode.window.showTextDocument(document, { preserveFocus: false });

    // Ensure the editor is fully activated and focused
    await new Promise(resolve => setTimeout(resolve, EDITOR_ACTIVATION_DELAY_MS));

    // Verify the editor is properly active
    if (vscode.window.activeTextEditor !== editor) {
      await vscode.window.showTextDocument(document, editor.viewColumn);
    }

    // Find the component block starting from the hover position
    const componentPosition = new vscode.Position(position.line, position.character);
    const componentRange = await this.findComponentRange(document, componentPosition, component.name);

    if (!componentRange) {
      vscode.window.showErrorMessage(`Could not locate component ${component.name} in the document`);
      return;
    }

    // Parse the existing component to see what inputs it already has
    const existingComponent = await this.parseExistingComponent(document, componentRange);

    // Generate the new component text with updated inputs
    const newComponentText = this.generateComponentText(
      component,
      includeInputs,
      selectedInputs,
      existingComponent
    );

    // Replace the existing component with the updated version
    await editor.edit(editBuilder => {
      editBuilder.replace(componentRange, newComponentText);
    });

    // Show success message
    let message = `Updated component: ${component.name}`;
    if (selectedInputs && selectedInputs.length > 0) {
      message += ` with ${selectedInputs.length} selected input parameter${selectedInputs.length === 1 ? '' : 's'}`;
    }
    vscode.window.showInformationMessage(message);
  }

  // Helper method to find the range of a component block in the document
  private async findComponentRange(
    document: vscode.TextDocument,
    position: vscode.Position,
    componentName: string
  ): Promise<vscode.Range | null> {
    const text = document.getText();
    const lines = text.split('\n');

    // Find the line with the component declaration
    let componentLineIndex = -1;
    for (let i = position.line; i >= Math.max(0, position.line - 10); i--) {
      if (lines[i] && lines[i].includes('component:') && lines[i].includes(componentName)) {
        componentLineIndex = i;
        break;
      }
    }

    // Also search forward a few lines
    if (componentLineIndex === -1) {
      for (let i = position.line; i < Math.min(lines.length, position.line + 10); i++) {
        if (lines[i] && lines[i].includes('component:') && lines[i].includes(componentName)) {
          componentLineIndex = i;
          break;
        }
      }
    }

    if (componentLineIndex === -1) {
      this.logger.warn(`[ComponentBrowser] Could not find component line for ${componentName}`, 'ComponentBrowser');
      return null;
    }

    // Find the start of the component block (look for the '- component:' line)
    let startLine = componentLineIndex;
    const componentLine = lines[componentLineIndex];
    const indentMatch = componentLine.match(/^(\s*)/);
    const componentIndent = indentMatch ? indentMatch[1].length : 0;

    // Look backwards to find the start of this list item
    for (let i = componentLineIndex; i >= 0; i--) {
      const line = lines[i];
      const lineIndentMatch = line.match(/^(\s*)/);
      const lineIndent = lineIndentMatch ? lineIndentMatch[1].length : 0;

      // If we find a line that starts with '- ' at the same or lesser indent, that's our start
      if (line.trim().startsWith('- ') && lineIndent <= componentIndent) {
        startLine = i;
        break;
      }
    }

    // Find the end of the component block
    let endLine = componentLineIndex;
    for (let i = componentLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      const lineIndentMatch = line.match(/^(\s*)/);
      const lineIndent = lineIndentMatch ? lineIndentMatch[1].length : 0;

      // If we find a line at the same or lesser indent that's not just whitespace, that's where we stop
      if (line.trim() && lineIndent <= componentIndent && line.trim().startsWith('-')) {
        endLine = i - 1;
        break;
      }

      // If we find any content at lesser indent, stop there
      if (line.trim() && lineIndent < componentIndent) {
        endLine = i - 1;
        break;
      }

      endLine = i;
    }

    // Make sure we don't include trailing empty lines
    while (endLine > componentLineIndex && !lines[endLine].trim()) {
      endLine--;
    }

    const startPos = new vscode.Position(startLine, 0);
    const endPos = new vscode.Position(endLine, lines[endLine].length);

    this.logger.debug(`[ComponentBrowser] Found component range: ${startLine}:0 to ${endLine}:${lines[endLine].length}`, 'ComponentBrowser');

    return new vscode.Range(startPos, endPos);
  }

  // Helper method to parse an existing component to extract its current inputs
  private async parseExistingComponent(document: vscode.TextDocument, range: vscode.Range): Promise<any> {
    const componentText = document.getText(range);

    try {
      // Use the YAML parser to parse just this component block
      const { parseYaml } = await import('../utils/yamlParser');

      // Wrap the component in a temporary YAML structure for parsing
      const wrappedYaml = `include:\n${componentText}`;
      const parsed = parseYaml(wrappedYaml);

      if (parsed && parsed.include && Array.isArray(parsed.include) && parsed.include[0]) {
        return parsed.include[0];
      } else if (parsed && parsed.include) {
        return parsed.include;
      }
    } catch (error) {
      this.logger.warn(`[ComponentBrowser] Could not parse existing component: ${error}`, 'ComponentBrowser');
    }

    return null;
  }

  // Helper method to generate the component text with updated inputs
  private generateComponentText(
    component: any,
    includeInputs: boolean,
    selectedInputs: string[] = [],
    existingComponent: any = null
  ): string {
    const gitlabInstance = component.gitlabInstance || 'gitlab.com';

    // Create the component reference
    let componentUrl: string;

    // If the component has a preserved URL with variables, use that
    if (component.originalUrl && containsGitLabVariables(component.originalUrl)) {
      componentUrl = component.originalUrl;
      // Update version if different
      if (component.version && !component.originalUrl.includes('@')) {
        componentUrl += `@${component.version}`;
      } else if (component.version && component.originalUrl.includes('@')) {
        componentUrl = component.originalUrl.replace(/@[^@]*$/, `@${component.version}`);
      }
    } else {
      // Create standard URL
      componentUrl = `https://${gitlabInstance}/${component.sourcePath}/${component.name}@${component.version}`;
    }

    let insertion = `  - component: ${componentUrl}`;

    // Handle inputs
    if (includeInputs || (selectedInputs && selectedInputs.length > 0)) {
      insertion += '\n    inputs:';

      // Start with existing inputs if we're editing
      const finalInputs = new Map<string, any>();

      // Add existing inputs first
      if (existingComponent && existingComponent.inputs) {
        for (const [key, value] of Object.entries(existingComponent.inputs)) {
          finalInputs.set(key, value);
        }
      }

      // If selectedInputs is specified, only include those (removing unselected ones)
      if (selectedInputs && selectedInputs.length > 0) {
        // Keep only the selected inputs from existing ones
        const filteredInputs = new Map<string, any>();
        for (const inputName of selectedInputs) {
          if (finalInputs.has(inputName)) {
            filteredInputs.set(inputName, finalInputs.get(inputName));
          }
        }
        finalInputs.clear();
        for (const [key, value] of filteredInputs) {
          finalInputs.set(key, value);
        }

        // Add new selected inputs with default values
        if (component.parameters) {
          for (const param of component.parameters) {
            if (selectedInputs.includes(param.name) && !finalInputs.has(param.name)) {
              let defaultValue = param.default;

              // Format default value based on type
              if (defaultValue !== undefined) {
                if (typeof defaultValue === 'string') {
                  // Check if it contains GitLab variables and preserve them
                  if (containsGitLabVariables(defaultValue)) {
                    defaultValue = `"${defaultValue}"`; // Keep variables as-is in quotes
                  } else {
                    defaultValue = `"${defaultValue}"`;
                  }
                } else if (typeof defaultValue === 'boolean') {
                  defaultValue = defaultValue.toString();
                } else if (typeof defaultValue === 'number') {
                  defaultValue = defaultValue.toString();
                } else {
                  defaultValue = JSON.stringify(defaultValue);
                }
              } else {
                // Provide placeholder based on type and required status
                if (param.required) {
                  switch (param.type) {
                    case 'boolean':
                      defaultValue = 'true';
                      break;
                    case 'number':
                      defaultValue = '0';
                      break;
                    default:
                      defaultValue = '"TODO: set value"';
                  }
                } else {
                  switch (param.type) {
                    case 'boolean':
                      defaultValue = 'false';
                      break;
                    case 'number':
                      defaultValue = '0';
                      break;
                    default:
                      defaultValue = '""';
                  }
                }
              }

              finalInputs.set(param.name, defaultValue);
            }
          }
        }
      } else if (includeInputs && component.parameters) {
        // Add all parameters if includeInputs is true and no specific selection
        for (const param of component.parameters) {
          if (!finalInputs.has(param.name)) {
            let defaultValue = param.default;

            // Format default value (same logic as above)
            if (defaultValue !== undefined) {
              if (typeof defaultValue === 'string') {
                if (containsGitLabVariables(defaultValue)) {
                  defaultValue = `"${defaultValue}"`;
                } else {
                  defaultValue = `"${defaultValue}"`;
                }
              } else if (typeof defaultValue === 'boolean') {
                defaultValue = defaultValue.toString();
              } else if (typeof defaultValue === 'number') {
                defaultValue = defaultValue.toString();
              } else {
                defaultValue = JSON.stringify(defaultValue);
              }
            } else {
              if (param.required) {
                switch (param.type) {
                  case 'boolean':
                    defaultValue = 'true';
                    break;
                  case 'number':
                    defaultValue = '0';
                    break;
                  default:
                    defaultValue = '"TODO: set value"';
                }
              } else {
                switch (param.type) {
                  case 'boolean':
                    defaultValue = 'false';
                    break;
                  case 'number':
                    defaultValue = '0';
                    break;
                  default:
                    defaultValue = '""';
                }
              }
            }

            finalInputs.set(param.name, defaultValue);
          }
        }
      }

      // Generate the inputs section
      for (const [inputName, inputValue] of finalInputs) {
        const param = component.parameters?.find((p: any) => p.name === inputName);
        const comment = param?.required ? ' # required' : ' # optional';
        insertion += `\n      ${inputName}: ${inputValue}${comment}`;
      }
    }

    return insertion;
  }

  // ...existing code...
}
