import * as vscode from 'vscode';
import { getComponentService } from '../services/component';
import { ComponentCacheManager } from '../services/cache/componentCacheManager';
import { GitLabCatalogComponent, GitLabCatalogVariable } from '../types/gitlab-catalog';
import type { ComponentParameter, Component } from './componentDetector';
import type { CachedComponent } from '../types/cache';
import type { SourceGroup, ComponentGroup, ComponentVersion } from './componentBrowserTypes';
import type { HoverContext } from './hoverContentBuilder';
import { containsGitLabVariables } from '../utils/gitlabVariables';
import { Logger } from '../utils/logger';
import { templateFileUrlForResolved } from '../utils/templateFileUrl';
import { escapeHtml, renderInlineMarkdown } from '../webview/inlineMarkdown';
import { serializeForScript } from '../webview/scriptData';
import { generateComponentText } from './componentBrowserGenerate';
import { findComponentLineRange, parseExistingComponentText } from './componentBrowserEdit';
import { transformCachedComponentsToGroups } from './componentBrowserTransform';
import { compileTagTemplate, stripTagPrefix } from '../services/component/tagScoping';

/**
 * Component shape carried through the detach-hover webview's "Open in Detailed View" round trip.
 * Adds the hover-builder's location context so the message handler can route inserts back to the
 * originating editor position. Mirrors the same alias in `extension.ts` — kept local here rather
 * than centralised because the field is a runtime-only extension applied by `hoverContentBuilder`.
 */
type DetachableComponent = Component & { _hoverContext?: HoverContext };

/**
 * Type-guard narrowing a `Component`-shaped value to one that also satisfies `CachedComponent`.
 * `Component` carries `source`/`sourcePath`/`gitlabInstance`/`version`/`url` as optional; cache
 * methods like `fetchComponentVersions` require them. The guard checks all five before the call so
 * we don't pass a half-populated `Component` into a function expecting the full cache shape.
 */
function isCachedComponentShape(component: Component): component is Component & CachedComponent {
  return typeof component.source === 'string'
    && typeof component.sourcePath === 'string'
    && typeof component.gitlabInstance === 'string'
    && typeof component.version === 'string'
    && typeof component.url === 'string';
}

/**
 * Pre-existing component shape parsed out of a `.gitlab-ci.yml` include line by
 * `parseExistingComponentText`. The parser returns `unknown`; this guard narrows it to the
 * `{ inputs?: Record<string, unknown> }` shape that `generateComponentText` expects.
 */
function isExistingComponentShape(value: unknown): value is { inputs?: Record<string, unknown> } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Constants for timing delays
const EDITOR_ACTIVATION_DELAY_MS = 50;

export class ComponentBrowserProvider {
  private panel: vscode.WebviewPanel | undefined;
  private originalEditor: vscode.TextEditor | undefined;
  private logger = Logger.getInstance();

  // State tracking for lazy loading versions
  private expandedComponents = new Set<string>();
  private versionsLoading = new Set<string>();
  private versionsFetched = new Set<string>();

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
          case 'updateToken':
            await vscode.commands.executeCommand('gitlabComponentHelper.addProjectToken');
            await this.loadComponents(true);
            return;
          case 'fetchVersion':
            await this.fetchAndCacheVersion(message.componentName, message.sourcePath, message.gitlabInstance, message.version);
            return;
          case 'setDefaultVersion':
            await this.setDefaultVersion(message.componentName, message.version);
            return;
          case 'setAlwaysUseLatest':
            await this.setAlwaysUseLatest(message.componentName);
            return;
          case 'expandComponent':
            await this.handleComponentExpand(message.componentName, message.projectId);
            return;
          case 'fetchVersions':
            await this.handleFetchVersions(message.componentName, message.sourcePath, message.gitlabInstance);
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

      // Skip upfront version fetching - will load lazily on expand
      this.logger.debug('[ComponentBrowser] Components loaded, versions will be fetched on demand', 'ComponentBrowser');

      // Transform cached components to component groups format
      const allComponents = transformCachedComponentsToGroups(cachedComponents, (comp, reason) =>
        this.logger.warn(`[ComponentBrowser] Skipping component (${reason}): ${JSON.stringify(comp)}`, 'ComponentBrowser'),
      );
      const cacheErrors = Object.fromEntries(sourceErrors);

      this.logger.debug(`[ComponentBrowser] Retrieved ${allComponents.length} component groups from cache`, 'ComponentBrowser');
      this.logger.debug(`[ComponentBrowser] Cache has ${Object.keys(cacheErrors).length} source errors`, 'ComponentBrowser');

      // Debug: log what components we actually have
      allComponents.forEach((source, index) => {
        this.logger.debug(`[ComponentBrowser] Source ${index + 1}: ${source.source} (${source.totalComponents} total components)`, 'ComponentBrowser');
        source.projects.forEach(project => {
          this.logger.debug(`[ComponentBrowser]   Project: ${project.name} (${project.components.length} components)`, 'ComponentBrowser');
          project.components.forEach(comp => {
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
      const sources = config.get<Array<{
        name: string;
        path: string;
        gitlabInstance?: string;
      }>>('componentSources', []);

      // If we have context, ensure that source is included
      if (componentContext && componentContext.gitlabInstance && componentContext.path) {
        const contextInstance = componentContext.gitlabInstance;
        const contextPath = componentContext.path;

        // Check if the context source is already in the cache. Match by any project's `path`/`gitlabInstance`
        // within the source group — `SourceGroup` doesn't carry these fields itself.
        const contextSourceExists = allComponents.some(group =>
          group.projects.some(p => p.gitlabInstance === contextInstance && p.path === contextPath)
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
                description: c.description || '',
                summary: c.summary,
                usage: c.usage,
                notes: c.notes,
                rawYaml: c.rawYaml,
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
              const contextProjectComponents: ComponentGroup[] = components.map((comp): ComponentGroup => ({
                name: comp.name,
                description: comp.description,
                summary: comp.summary,
                usage: comp.usage,
                notes: comp.notes,
                rawYaml: comp.rawYaml,
                parameters: comp.parameters,
                source: comp.source,
                sourcePath: comp.sourcePath,
                gitlabInstance: comp.gitlabInstance,
                documentationUrl: comp.documentationUrl ?? '',
                versions: [{
                  version: comp.version,
                  description: comp.description,
                  parameters: comp.parameters,
                  documentationUrl: comp.documentationUrl ?? '',
                  source: comp.source,
                  sourcePath: comp.sourcePath,
                  gitlabInstance: comp.gitlabInstance,
                }],
                versionCount: 1,
                defaultVersion: comp.version,
                availableVersions: [comp.version],
              }));
              const contextSource: SourceGroup = {
                source: `Components from ${contextPath}`,
                type: 'source',
                isExpanded: true,
                totalComponents: components.length,
                totalVersions: components.length,
                projectCount: 1,
                componentCount: components.length,
                projects: [{
                  name: contextPath.split('/').pop() || contextPath,
                  path: contextPath,
                  gitlabInstance: contextInstance,
                  type: 'project',
                  isExpanded: true, // Auto-expand context projects
                  components: contextProjectComponents,
                }],
              };
              allComponents.unshift(contextSource);

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
        this.panel.webview.html = this.getErrorsHtml(cacheErrors);
        return;
      }

      // Render the component browser with the components and any errors
      // Only show errors for sources that have no components AND have errors
      const filteredErrors: Record<string, string> = {};

      // Get list of sources that have components
      const sourcesWithComponents = new Set(allComponents.map(group => group.source));

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

  private async insertComponent(component: Component, includeInputs: boolean = false, selectedInputs?: string[]) {
    // Check if we have the original editor stored
    if (!this.originalEditor) {
      vscode.window.showErrorMessage("No active editor to insert component into");
      return;
    }

    // Refocus the original editor to restore context
    await vscode.window.showTextDocument(this.originalEditor.document, this.originalEditor.viewColumn);

    // Brief wait to ensure editor is fully activated
    await new Promise(resolve => setTimeout(resolve, EDITOR_ACTIVATION_DELAY_MS));

    // Verify we have the correct active editor now
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== this.originalEditor.document.uri.toString()) {
      vscode.window.showErrorMessage("Could not activate the original editor");
      return;
    }

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
        parametersToInclude = component.parameters.filter(param => selectedInputs.includes(param.name));
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
  public async insertComponentFromDetached(component: Component, includeInputs: boolean = false, selectedInputs?: string[]) {
    return this.insertComponent(component, includeInputs, selectedInputs);
  }

  public async showComponentDetails(component: DetachableComponent) {
    // Create a new webview panel for component details
    const detailsPanel = vscode.window.createWebviewPanel(
      'gitlabComponentDetails',
      `Component: ${component.name}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true
      }
    );

    // The component arrives from the webview carrying only the selected version and none of the source settings;
    // recover the full version list and monorepo settings from the cache so the dropdown is complete and labelled.
    const enriched = await this.lookupComponentDetails(component);

    // Show component details
    detailsPanel.webview.html = this.getComponentDetailsHtml({ ...component, ...enriched });

    // Handle messages from the details panel
    detailsPanel.webview.onDidReceiveMessage(
      async message => {
        if (message.command === 'insertComponent') {
          // Handle different insertion options
          const { version, includeInputs, selectedInputs } = message;

          // Update component version if specified
          if (version && version !== component.version) {
            if (!component.sourcePath || !component.gitlabInstance) {
              vscode.window.showErrorMessage('Cannot fetch version: component is missing source path or GitLab instance.');
              return;
            }
            const updatedComponent = await this.cacheManager.fetchSpecificVersion(
              component.name,
              component.sourcePath,
              component.gitlabInstance,
              version
            );
            if (updatedComponent) {
              if (component._hoverContext) {
                await this.editExistingComponentFromDetached(
                  updatedComponent,
                  component._hoverContext.documentUri,
                  component._hoverContext.position,
                  includeInputs || false,
                  selectedInputs || []
                );
              } else {
                await this.insertComponent(updatedComponent, includeInputs, selectedInputs);
              }
            } else {
              vscode.window.showErrorMessage(`Failed to fetch version ${version} of component ${component.name}`);
            }
          } else {
            if (component._hoverContext) {
              await this.editExistingComponentFromDetached(
                component,
                component._hoverContext.documentUri,
                component._hoverContext.position,
                includeInputs || false,
                selectedInputs || []
              );
            } else {
              await this.insertComponent(component, includeInputs, selectedInputs);
            }
          }
        } else if (message.command === 'fetchVersions') {
          // Fetch available versions for the component
          try {
            if (!isCachedComponentShape(component)) {
              throw new Error('Component is missing required fields (source, sourcePath, gitlabInstance, version) for version lookup.');
            }
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

            if (!component.sourcePath || !component.gitlabInstance) {
              vscode.window.showErrorMessage('Cannot change version: component is missing source path or GitLab instance.');
              return;
            }
            const updatedComponent = await this.cacheManager.fetchSpecificVersion(
              component.name,
              component.sourcePath,
              component.gitlabInstance,
              selectedVersion
            );
            if (updatedComponent) {
              // Send the updated component details to the webview, with the template-file URL precomputed
              // server-side so the webview never has to do its own URL routing.
              detailsPanel.webview.postMessage({
                command: 'componentDetailsUpdated',
                component: {
                  ...updatedComponent,
                  templateFileUrl: this.buildTemplateFileUrl(updatedComponent),
                }
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

  /**
   * Render the `<option>` markup for a component's version dropdown.
   *
   * For a monorepo source the available versions are full prefixed tags (`<name>-1.1.0`). The option **value** is
   * always the full tag (the ref inserted into the file); only the visible label is the prefix-stripped form.
   * Non-monorepo components keep value == label == the version string.
   *
   * @param component  The component group to render options for. Its `availableVersions` become the options,
   *                   `defaultVersion` marks the pre-selected one, and a `tagPattern` (if present) drives the
   *                   prefix-stripped labels.
   * @returns          The concatenated `<option>` HTML for the dropdown's contents (no wrapping `<select>`).
   */
  private renderVersionOptions(component: ComponentGroup): string {
    const selectedAttr = (version: string): string =>
      version === component.defaultVersion ? ' selected' : '';

    return component.availableVersions
      .map((version) => {
        const label = component.tagPattern
          ? stripTagPrefix(version, component.name, component.tagPattern)
          : version;
        return `<option value="${this.escapeHtml(version)}"${selectedAttr(version)}>${this.escapeHtml(label)}</option>`;
      })
      .join('');
  }

  private getComponentBrowserHtml(componentGroups: SourceGroup[], cacheErrors: Record<string, string> = {}): string {
    const hasErrors = Object.keys(cacheErrors).length > 0;

    // Prepare version data as a safe JSON string
    const versionData = componentGroups.reduce<Record<string, Record<string, ComponentVersion>>>((acc, source) => {
      if (source.projects && Array.isArray(source.projects)) {
        source.projects.forEach(project => {
          if (project.components && Array.isArray(project.components)) {
            project.components.forEach(component => {
              if (!acc[component.name]) {
                acc[component.name] = {};
              }
              if (component.versions && Array.isArray(component.versions)) {
                component.versions.forEach(version => {
                  acc[component.name][version.version] = version;
                });
              }
            });
          }
        });
      }
      return acc;
    }, {});

    const versionDataJson = serializeForScript(versionData);

    // Build error section HTML
    const hasAuthError = Object.values(cacheErrors).some(error => this.classifySourceError(error).isAuth);
    const errorSectionHtml = hasErrors ? `
      <div class="error-section">
        <div class="error-header">⚠️ Cache Errors</div>
        ${Object.entries(cacheErrors).map(([source, error], index) => {
          const { summary } = this.classifySourceError(error);
          return `
          <div class="error-item">
            <div class="error-source">${this.escapeHtml(source)}</div>
            <div class="error-summary">${this.escapeHtml(summary)}</div>
            <button class="error-toggle" onclick="toggleError('error-${index}')">Show Details</button>
            <div class="error-details" id="error-${index}" style="display: none;">${this.escapeHtml(error)}</div>
          </div>
          `;
        }).join('')}
        ${hasAuthError ? '<button class="update-token-btn" onclick="updateToken()">Update Token</button>' : ''}
      </div>
    ` : '';

    // Build components HTML
    const componentsHtml = componentGroups.length === 0 ?
      '<p class="no-components">No components found. Click "Refresh" to load components from your configured sources.</p>' :
      componentGroups.map(source => {
        const sourceId = source.source.replace(/[^a-zA-Z0-9]/g, '_');
        const projectsHtml = (source.projects && Array.isArray(source.projects) ? source.projects : []).map(project => {
          const projectId = `${sourceId}_${project.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
          const components = project.components && Array.isArray(project.components) ? project.components : [];
          const componentsHtml = components.length === 0 ?
            '<p class="no-components">No components found in this project</p>' :
            components.map(component => {
              const componentKey = `${component.name}-${component.sourcePath}`;
              const hasVersions = component.availableVersions && component.availableVersions.length > 0;

              return `
              <div class="component-card" data-name="${component.name}" data-description="${this.escapeHtml(component.description || '')}" data-component-name="${component.name}" data-project-id="${projectId}" data-source-path="${component.sourcePath}" data-gitlab-instance="${component.gitlabInstance}" id="component-${componentKey}">
                <div class="component-header">
                  <span class="component-title">
                    ${component.name}
                    ${hasVersions && component.availableVersions.length > 1 ? `<span class="version-badge">${component.availableVersions.length} versions</span>` : ''}
                  </span>
                  <div class="component-actions" id="actions-${componentKey}">
                    ${hasVersions ? `
                      ${component.availableVersions.length > 1 ? `
                        <select class="version-dropdown" onchange="updateComponentVersion('${component.name}', this.value, '${projectId}')" oncontextmenu="showContextMenu(event, '${component.name}', this.value, '${projectId}')">
                          ${this.renderVersionOptions(component)}
                        </select>
                      ` : `<span class="single-version">${component.availableVersions[0] || 'latest'}</span>`}
                      <button onclick="viewDetailsById('${component.name}', '${component.defaultVersion || component.availableVersions[0]}', '${projectId}')">Details</button>
                      <button onclick="insertComponentById('${component.name}', '${component.defaultVersion || component.availableVersions[0]}', '${projectId}')">Insert</button>
                    ` : `
                      <button class="load-versions-btn" onclick="loadComponentVersions('${component.name}', '${component.sourcePath}', '${component.gitlabInstance}', '${projectId}')">Load Versions</button>
                      <span class="loading-versions" id="loading-${componentKey}" style="display: none;">Loading...</span>
                    `}
                  </div>
                </div>
                <div class="component-description" id="desc-${component.name}-${projectId}">${this.renderInlineMarkdown(component.description || '')}</div>
                ${hasVersions && component.availableVersions.length > 1 ? `
                  <div class="version-info" id="version-info-${component.name}-${projectId}">
                    <small>Default version: ${component.defaultVersion}</small>
                  </div>
                ` : ''}
              </div>
            `;
            }).join('');

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
          .error-summary {
            color: var(--vscode-errorForeground);
            margin: 4px 0;
          }
          .update-token-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 14px;
            border-radius: 2px;
            cursor: pointer;
            margin-top: 6px;
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
          .load-versions-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          .load-versions-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
          }
          .loading-versions {
            font-size: 0.85em;
            color: var(--vscode-disabledForeground);
            font-style: italic;
          }
          .error-message {
            color: var(--vscode-errorForeground);
            font-size: 0.85em;
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

          ${this.clientRenderInlineMarkdownSource()}

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

          function updateToken() {
            vscode.postMessage({ command: 'updateToken' });
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

          function loadComponentVersions(componentName, sourcePath, gitlabInstance, projectId) {
            const componentKey = componentName + '-' + sourcePath;
            const loadingElement = document.getElementById('loading-' + componentKey);
            const loadButton = document.querySelector('#component-' + componentKey + ' .load-versions-btn');
            if (loadingElement) { loadingElement.style.display = 'inline'; }
            if (loadButton) { loadButton.style.display = 'none'; }
            vscode.postMessage({ command: 'fetchVersions', componentName: componentName, sourcePath: sourcePath, gitlabInstance: gitlabInstance });
          }

          window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'versionsLoaded') { handleVersionsLoaded(message); }
            else if (message.command === 'versionsError') { handleVersionsError(message); }
          });

          function handleVersionsLoaded(message) {
            const componentName = message.componentName, sourcePath = message.sourcePath, versions = message.versions, defaultVersion = message.defaultVersion, componentKey = componentName + '-' + sourcePath;
            if (!window.componentVersionData[componentName]) { window.componentVersionData[componentName] = {}; }
            versions.forEach(function(v) { window.componentVersionData[componentName][v] = { version: v, sourcePath: sourcePath, gitlabInstance: message.gitlabInstance || 'gitlab.com' }; });
            const componentCard = document.getElementById('component-' + componentKey);
            if (!componentCard) { return; }
            const projectId = componentCard.getAttribute('data-project-id'), actionsDiv = document.getElementById('actions-' + componentKey);
            if (actionsDiv) {
              if (versions.length > 1) {
                // For monorepo sources the version values are full tags (e.g. <name>-1.1.0); the server sends a
                // versionLabels map (full tag → stripped {version}) so we display the short form while keeping the
                // full tag as the option value (the inserted ref).
                const labels = message.versionLabels || {};
                const label = function(v) { return labels[v] || v; };
                // Build the dropdown shell + buttons as markup, then append options via the DOM so the untrusted
                // version strings (tag names can contain <, >, &) are never interpolated into HTML.
                actionsDiv.innerHTML = '<select class="version-dropdown" onchange="updateComponentVersion(&#39;' + componentName + '&#39;, this.value, &#39;' + projectId + '&#39;)"></select><button onclick="viewDetailsById(&#39;' + componentName + '&#39;, &#39;' + defaultVersion + '&#39;, &#39;' + projectId + '&#39;)">Details</button><button onclick="insertComponentById(&#39;' + componentName + '&#39;, &#39;' + defaultVersion + '&#39;, &#39;' + projectId + '&#39;)">Insert</button>';
                const select = actionsDiv.querySelector('.version-dropdown');
                versions.forEach(function(v) {
                  const option = document.createElement('option');
                  option.value = v;
                  option.textContent = label(v);
                  if (v === defaultVersion) { option.selected = true; }
                  select.appendChild(option);
                });
                const descElement = document.getElementById('desc-' + componentName + '-' + projectId);
                if (descElement && !document.getElementById('version-info-' + componentName + '-' + projectId)) {
                  const versionInfo = document.createElement('div');
                  versionInfo.className = 'version-info'; versionInfo.id = 'version-info-' + componentName + '-' + projectId;
                  versionInfo.innerHTML = '<small>Default version: ' + defaultVersion + '</small>';
                  descElement.parentNode.insertBefore(versionInfo, descElement.nextSibling);
                }
              } else {
                const singleVersion = versions[0] || 'latest';
                actionsDiv.innerHTML = '<span class="single-version">' + singleVersion + '</span><button onclick="viewDetailsById(&#39;' + componentName + '&#39;, &#39;' + singleVersion + '&#39;, &#39;' + projectId + '&#39;)">Details</button><button onclick="insertComponentById(&#39;' + componentName + '&#39;, &#39;' + singleVersion + '&#39;, &#39;' + projectId + '&#39;)">Insert</button>';
              }
            }
            const titleSpan = componentCard.querySelector('.component-title');
            if (titleSpan && versions.length > 1 && !titleSpan.querySelector('.version-badge')) {
              const badge = document.createElement('span'); badge.className = 'version-badge'; badge.textContent = versions.length + ' versions'; titleSpan.appendChild(badge);
            }
          }

          function handleVersionsError(message) {
            const componentKey = message.componentName + '-' + message.sourcePath;
            const loadingElement = document.getElementById('loading-' + componentKey);
            if (loadingElement) { loadingElement.style.display = 'none'; }
            const actionsDiv = document.getElementById('actions-' + componentKey);
            if (actionsDiv) {
              actionsDiv.innerHTML = '<span class="error-message" style="color: red; font-size: 0.9em;">Failed to load versions</span><button class="load-versions-btn" onclick="loadComponentVersions(&#39;' + message.componentName + '&#39;, &#39;' + message.sourcePath + '&#39;, &#39;' + (message.gitlabInstance || 'gitlab.com') + '&#39;, &#39;&#39;)">Retry</button>';
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
              descElement.innerHTML = renderInlineMarkdown(versionData.description);
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
              // Send the raw component data; the server computes the template-file URL when it renders the details panel.
              const component = {
                ...componentData[version],
                name: componentName,
                version: version,
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

  /**
   * Enrich a webview-supplied component from the cache for the details panel. The object posted from the browser
   * carries only the selected version and none of the source-level settings, so here we recover:
   *  - the full `availableVersions` list (so the version dropdown isn't limited to the one selected version), and
   *  - the source's `tagPattern` (for monorepo prefix-stripped labels).
   *
   * Best-effort: returns an empty object if the component isn't found or the cache read fails.
   *
   * @param component  Identity of the component to look up. Matched against the cache by `name` plus its location —
   *                   the flat `sourcePath`/`gitlabInstance` fields (browser components) or `context` (hover-detected
   *                   components).
   * @returns          The recovered `availableVersions` and `tagPattern`, each omitted when the cache has no value
   *                   for it; an empty object if no matching component is cached or the read fails.
   */
  public async lookupComponentDetails(
    component: {
      name: string;
      sourcePath?: string;
      gitlabInstance?: string;
      context?: { gitlabInstance: string; path: string };
    },
  ): Promise<{ availableVersions?: string[]; tagPattern?: string }> {
    try {
      // Hover-detected components carry their location under `context`; browser components use the flat fields.
      const sourcePath = component.sourcePath || component.context?.path;
      const gitlabInstance = component.gitlabInstance || component.context?.gitlabInstance;

      const cached = await this.cacheManager.getComponents();
      const match = cached.find(c =>
        c.name === component.name &&
        c.sourcePath === sourcePath &&
        c.gitlabInstance === gitlabInstance
      );
      if (!match) return {};

      const enriched: { availableVersions?: string[]; tagPattern?: string } = {};
      if (match.availableVersions && match.availableVersions.length > 0) {
        enriched.availableVersions = match.availableVersions;
      }
      if (match.tagPattern) {
        enriched.tagPattern = match.tagPattern;
      }
      return enriched;
    } catch {
      // Best-effort enrichment — fall through to no enrichment.
      return {};
    }
  }

  public getComponentDetailsHtml(
    component: Component & {
      availableVersions?: string[];
      tagPattern?: string;
    },
  ): string {
    const parameters = component.parameters || [];
    const availableVersions = component.availableVersions || [component.version || 'main'];
    const headerSummary = component.summary;
    const headerUsage = component.usage;
    const headerNotes = Array.isArray(component.notes) ? component.notes : [];
    const hasContext = Boolean(headerSummary || headerUsage || headerNotes.length > 0);
    const rawYaml = component.rawYaml || '';
    const hasRawYaml = Boolean(rawYaml);
    const templateFileUrl = this.buildTemplateFileUrl(component);

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
          #rawYamlContent {
            white-space: pre;
            overflow-x: auto;
            background-color: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 5px;
            border: 1px solid var(--vscode-panel-border);
          }
        </style>
      </head>
      <body>
        <h1 id="componentName">${component.name}</h1>

        <div class="description" id="componentDescription">
          ${this.renderInlineMarkdown(component.description || '')}
        </div>

        <div class="metadata" id="componentContext" style="display: ${hasContext ? 'block' : 'none'};">
          <div><strong>Context</strong></div>
          <div id="componentSummaryRow" style="display: ${headerSummary ? 'block' : 'none'};">
            <strong>Summary:</strong> <span id="componentSummary">${headerSummary || ''}</span>
          </div>
          <div id="componentUsageRow" style="display: ${headerUsage ? 'block' : 'none'};">
            <strong>Usage:</strong> <span id="componentUsage">${headerUsage || ''}</span>
          </div>
          <div id="componentNotesRow" style="display: ${headerNotes.length > 0 ? 'block' : 'none'};">
            <strong>Notes:</strong>
            <ul id="componentNotes">
              ${headerNotes.map((note: string) => '<li>' + note + '</li>').join('')}
            </ul>
          </div>
        </div>

        <div class="metadata" id="rawYamlSection" style="display: ${hasRawYaml ? 'block' : 'none'};">
          <div class="parameters-header" style="margin-bottom: 5px;">
            <h2 style="margin: 0;">Raw YAML</h2>
            <button class="secondary" id="toggleRawYaml" onclick="toggleRawYaml()">Show</button>
          </div>
          <pre id="rawYamlContent" style="display: none;">${this.escapeHtml(rawYaml)}</pre>
        </div>

        <div class="metadata">
          <div><strong>Source:</strong> <span id="componentSource">${component.source}</span></div>
          <div><strong>GitLab Instance:</strong> <span id="componentInstance">${component.gitlabInstance || 'gitlab.com'}</span></div>
          <div class="version-control">
            <strong>Version:</strong>
            <select id="versionSelect" onchange="onVersionChange()">
              ${(() => {
                // For monorepo tags show the template's {version} capture as the label, keeping the full tag as the
                // option value (the ref used to fetch and insert the version).
                const matcher = component.tagPattern
                  ? compileTagTemplate(component.tagPattern, component.name)
                  : null;
                return availableVersions.map((version: string) => {
                  const label = matcher?.extractVersion(version) ?? version;
                  return `<option value="${this.escapeHtml(version)}" ${version === component.version ? 'selected' : ''}>${this.escapeHtml(label)}</option>`;
                }).join('');
              })()}
            </select>
            <span class="version-loading" id="versionLoading" style="display: none;">Loading version details...</span>
          </div>
          ${component.documentationUrl ?
            `<div><strong>Project URL:</strong> <a href="${component.documentationUrl}" target="_blank" id="componentDocUrl">${component.documentationUrl}</a></div>` : ''}
          ${component.url ?
            `<div><strong>Component URL:</strong> <code id="componentUrl">${component.url}</code></div>` : ''}
          ${templateFileUrl ?
            `<div><strong>Template File:</strong> <a href="${templateFileUrl}" target="_blank" id="templateFileUrl">${templateFileUrl}</a></div>` : ''}
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
          let currentVersions = ${serializeForScript(availableVersions)};
          let versionsLoaded = ${availableVersions.length > 1};

          ${this.clientRenderInlineMarkdownSource()}

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

          function toggleRawYaml() {
            const rawContent = document.getElementById('rawYamlContent');
            const toggleButton = document.getElementById('toggleRawYaml');
            if (!rawContent || !toggleButton) return;

            const isHidden = rawContent.style.display === 'none';
            rawContent.style.display = isHidden ? 'block' : 'none';
            toggleButton.textContent = isHidden ? 'Hide' : 'Show';
          }

          function updateComponentDetails(component) {
            console.log('Updating component details:', component);

            // Update component name
            document.getElementById('componentName').textContent = component.name;

            // Update description
            document.getElementById('componentDescription').innerHTML = renderInlineMarkdown(component.description || '');

            // Update context section (summary/usage/notes) from spec-compliant header comments
            const contextContainer = document.getElementById('componentContext');
            const summaryRow = document.getElementById('componentSummaryRow');
            const usageRow = document.getElementById('componentUsageRow');
            const notesRow = document.getElementById('componentNotesRow');
            const summary = component.summary || '';
            const usage = component.usage || '';
            const notes = Array.isArray(component.notes) ? component.notes : [];
            const hasContext = summary || usage || notes.length > 0;

            if (contextContainer) {
              contextContainer.style.display = hasContext ? 'block' : 'none';
            }

            if (summaryRow) {
              summaryRow.style.display = summary ? 'block' : 'none';
              const summaryEl = document.getElementById('componentSummary');
              if (summaryEl) summaryEl.textContent = summary;
            }

            if (usageRow) {
              usageRow.style.display = usage ? 'block' : 'none';
              const usageEl = document.getElementById('componentUsage');
              if (usageEl) usageEl.textContent = usage;
            }

            if (notesRow) {
              notesRow.style.display = notes.length > 0 ? 'block' : 'none';
              const notesEl = document.getElementById('componentNotes');
              if (notesEl) {
                notesEl.innerHTML = notes.map(note => '<li>' + note + '</li>').join('');
              }
            }

            // Update raw YAML section
            const rawYamlSection = document.getElementById('rawYamlSection');
            const rawYamlContent = document.getElementById('rawYamlContent');
            const rawYamlToggle = document.getElementById('toggleRawYaml');
            const rawYaml = component.rawYaml || '';
            const hasRawYaml = rawYaml.length > 0;
            if (rawYamlSection) {
              rawYamlSection.style.display = hasRawYaml ? 'block' : 'none';
            }
            if (rawYamlContent) {
              rawYamlContent.textContent = rawYaml;
              rawYamlContent.style.display = 'none';
            }
            if (rawYamlToggle) {
              rawYamlToggle.textContent = 'Show';
            }

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
              componentUrlElement.textContent = component.url;
            }

            // Update template file URL. The server precomputes templateFileUrl and includes it in the
            // payload; if it's absent (no resolved templatePath), the row is hidden.
            const templateFileUrlElement = document.getElementById('templateFileUrl');
            if (templateFileUrlElement) {
              if (component.templateFileUrl) {
                templateFileUrlElement.href = component.templateFileUrl;
                templateFileUrlElement.textContent = component.templateFileUrl;
                templateFileUrlElement.style.display = 'inline';
              } else {
                templateFileUrlElement.style.display = 'none';
              }
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
                updateVersionDropdown(message.versions, message.currentVersion, message.versionLabels);
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

          function updateVersionDropdown(versions, currentVersion, versionLabels) {
            const select = document.getElementById('versionSelect');
            const loading = document.getElementById('versionLoading');
            const labels = versionLabels || {};

            // Clear existing options
            select.innerHTML = '';

            // Add new options. The option value is the full tag (the inserted ref); the label is the stripped
            // {version} for monorepo sources (falls back to the full tag when no label is provided).
            versions.forEach(version => {
              const option = document.createElement('option');
              option.value = version;
              option.textContent = labels[version] || version;
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

  /**
   * Classify a per-source error message so the error views can tell an expired/invalid token apart
   * from a generic failure. Auth errors get a plain-language summary and an "Update Token" action;
   * everything else falls back to the raw message. The raw text is always preserved for the details
   * disclosure so we never hide what GitLab actually returned.
   *
   * @param rawError  The error message stored for a source (e.g. `HTTP 401: {"error":"invalid_token",…}`).
   * @returns         `isAuth` — whether the message looks like a 401/403/token failure; `summary` — a
   *                  plain-language message for auth errors, or the unchanged `rawError` otherwise.
   */
  private classifySourceError(rawError: string): { isAuth: boolean; summary: string } {
    const lower = rawError.toLowerCase();
    const isAuth =
      /\bhttp\s*40[13]\b/.test(lower) ||
      lower.includes('invalid_token') ||
      lower.includes('token is expired') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden');

    if (!isAuth) {
      return { isAuth: false, summary: rawError };
    }

    const summary = lower.includes('expired')
      ? 'Your GitLab access token has expired. Update it to reload these components.'
      : 'GitLab rejected the access token for this source. Update it to reload these components.';
    return { isAuth: true, summary };
  }

  private escapeHtml(value: string): string {
    return escapeHtml(value);
  }

  private renderInlineMarkdown(value: string): string {
    return renderInlineMarkdown(value);
  }

  /**
   * Source for the client-side twin of {@link renderInlineMarkdown}, injected into every webview `<script>`
   * that renders a description so all render paths escape and format identically. Kept as one string (not
   * duplicated per script) so the twins can't drift. `new RegExp(...)` avoids the webview HTML template
   * literal mangling the pattern escaping; the escape set (incl. `'`) mirrors the server `escapeHtml`.
   */
  private clientRenderInlineMarkdownSource(): string {
    return `
      function renderInlineMarkdown(text) {
        const escaped = String(text || '')
          .replace(new RegExp('&', 'g'), '&amp;')
          .replace(new RegExp('<', 'g'), '&lt;')
          .replace(new RegExp('>', 'g'), '&gt;')
          .replace(new RegExp('"', 'g'), '&quot;')
          .replace(new RegExp("'", 'g'), '&#39;');
        return escaped
          .replace(new RegExp('\`([^\`]+)\`', 'g'), '<code>$1</code>')
          .replace(new RegExp('\\[([^\\]]+)\\]\\((https?://[^\\s)]+)\\)', 'g'), '<a href="$2">$1</a>')
          .replace(new RegExp('\\*\\*([^*]+)\\*\\*', 'g'), '<strong>$1</strong>')
          .replace(new RegExp('(^|[^*])\\*([^*]+)\\*', 'g'), '$1<em>$2</em>');
      }
    `;
  }

  private buildTemplateFileUrl(component: Component): string | undefined {
    if (!component || !component.gitlabInstance || !component.sourcePath || !component.templatePath) {
      return undefined;
    }
    return templateFileUrlForResolved({
      gitlabInstance: component.gitlabInstance,
      projectPath: component.sourcePath,
      version: component.version,
      templatePath: component.templatePath,
    });
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

  /**
   * Build the full-screen error view shown when no components could be loaded but sources reported
   * errors. Each source is rendered with a plain-language summary (auth errors are humanised via
   * {@link classifySourceError}) and its raw message behind a "Show details" toggle. An "Update Token"
   * button is added when any source failed with an auth error.
   *
   * @param errors  Map of source name to its error message (as stored by the cache manager).
   * @returns       A complete HTML document string for the webview panel.
   */
  private getErrorsHtml(errors: Record<string, string>): string {
    const entries = Object.entries(errors);
    const hasAuthError = entries.some(([, error]) => this.classifySourceError(error).isAuth);

    const errorItemsHtml = entries.map(([source, error], index) => {
      const { summary } = this.classifySourceError(error);
      const detailsId = `error-details-${index}`;
      return `
        <div class="error-item">
          <div class="error-source">${this.escapeHtml(source)}</div>
          <div class="error-summary">${this.escapeHtml(summary)}</div>
          <button class="link-button" onclick="toggleDetails('${detailsId}', this)">Show details</button>
          <pre class="error-raw" id="${detailsId}" style="display: none;">${this.escapeHtml(error)}</pre>
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
          .errors {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 10px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .error-item {
            margin: 12px 0;
          }
          .error-item:not(:last-child) {
            border-bottom: 1px solid var(--vscode-inputValidation-errorBorder);
            padding-bottom: 12px;
          }
          .error-source {
            font-weight: 600;
            margin-bottom: 4px;
          }
          .error-summary {
            color: var(--vscode-errorForeground);
          }
          .error-raw {
            margin: 8px 0 0;
            padding: 8px;
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 0.85em;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 3px;
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
          .link-button {
            background: none;
            color: var(--vscode-textLink-foreground);
            padding: 0;
            margin: 4px 0 0;
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <h1>Component Loading Errors</h1>

        <p>There were errors loading components from the configured sources:</p>

        <div class="errors">
          ${errorItemsHtml}
        </div>

        <div>
          ${hasAuthError ? '<button onclick="updateToken()">Update Token</button>' : ''}
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

          function updateToken() {
            vscode.postMessage({ command: 'updateToken' });
          }

          function toggleDetails(id, btn) {
            const el = document.getElementById(id);
            const showing = el.style.display !== 'none';
            el.style.display = showing ? 'none' : 'block';
            btn.textContent = showing ? 'Show details' : 'Hide details';
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


  /**
   * Build the catch-all error view shown when loading the component browser throws (as opposed to a
   * per-source failure). Auth errors are humanised via {@link classifySourceError} and get an "Update
   * Token" button with the raw message behind a "Show details" toggle; other errors show the message
   * directly. Both keep "Try Again" and "Open Settings".
   *
   * @param error  The thrown value caught while loading components (typed `unknown` at the catch site).
   * @returns      A complete HTML document string for the webview panel.
   */
  private getErrorHtml(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const { isAuth, summary } = this.classifySourceError(message);
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
          .error-raw {
            margin: 8px 0 0;
            padding: 8px;
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 0.85em;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 3px;
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
          .link-button {
            background: none;
            color: var(--vscode-textLink-foreground);
            padding: 0;
            margin: 4px 0 0;
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <h1>Component Loading Error</h1>

        <div class="error">
          ${isAuth
            ? `${this.escapeHtml(summary)}
               <button class="link-button" onclick="toggleDetails('error-raw', this)">Show details</button>
               <pre class="error-raw" id="error-raw" style="display: none;">${this.escapeHtml(message)}</pre>`
            : `<strong>Error:</strong> ${this.escapeHtml(message)}`}
        </div>

        <div>
          ${isAuth ? '<button onclick="updateToken()">Update Token</button>' : ''}
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

          function updateToken() {
            vscode.postMessage({ command: 'updateToken' });
          }

          function toggleDetails(id, btn) {
            const el = document.getElementById(id);
            const showing = el.style.display !== 'none';
            el.style.display = showing ? 'none' : 'block';
            btn.textContent = showing ? 'Show details' : 'Hide details';
          }
        </script>
      </body>
      </html>
    `;
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

  private async setDefaultVersion(componentName: string, version: string) {
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

  private async setAlwaysUseLatest(componentName: string) {
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

  private async handleComponentExpand(componentName: string, projectId: string) {
    const componentKey = `${componentName}-${projectId}`;

    // Track expanded state
    this.expandedComponents.add(componentKey);

    // Check if we already fetched versions for this component
    if (this.versionsFetched.has(componentKey)) {
      this.logger.debug(`[ComponentBrowser] Versions already fetched for ${componentName}`, 'ComponentBrowser');
      return;
    }

    // Check if we're already loading versions for this component
    if (this.versionsLoading.has(componentKey)) {
      this.logger.debug(`[ComponentBrowser] Already loading versions for ${componentName}`, 'ComponentBrowser');
      return;
    }

    // Mark as loading
    this.versionsLoading.add(componentKey);

    // Send loading state to webview
    if (this.panel) {
      this.panel.webview.postMessage({
        command: 'versionsLoading',
        componentName,
        projectId
      });
    }

    this.logger.debug(`[ComponentBrowser] Loading versions for ${componentName}`, 'ComponentBrowser');
  }

  private async handleFetchVersions(componentName: string, sourcePath: string, gitlabInstance: string) {
    const componentKey = `${componentName}-${sourcePath}`;

    try {
      // Find the component in cache
      const cachedComponents = await this.cacheManager.getComponents();
      const component = cachedComponents.find(c =>
        c.name === componentName &&
        c.sourcePath === sourcePath &&
        c.gitlabInstance === gitlabInstance
      );

      if (!component) {
        throw new Error(`Component ${componentName} not found in cache`);
      }

      // Fetch versions from cache manager
      await this.cacheManager.fetchComponentVersions(component);

      // Get updated component with versions
      const updatedComponents = await this.cacheManager.getComponents();
      const updatedComponent = updatedComponents.find(c =>
        c.name === componentName &&
        c.sourcePath === sourcePath &&
        c.gitlabInstance === gitlabInstance
      );

      if (!updatedComponent) {
        throw new Error(`Updated component ${componentName} not found`);
      }

      // Mark as fetched
      this.versionsFetched.add(componentKey);
      this.versionsLoading.delete(componentKey);

      // Pick the default version. `availableVersions` is already sorted highest-priority-first (semantic versions
      // before branches), so the first entry is the best default — except `latest`, the catalog floating tag, which
      // wins when present.
      const availableVersions = updatedComponent.availableVersions || [];
      let defaultVersion = updatedComponent.version || 'latest';

      if (availableVersions.length > 0) {
        defaultVersion = availableVersions.includes('latest') ? 'latest' : availableVersions[0];
      }

      // For a monorepo source, precompute display labels (full tag → stripped {version}) server-side, since the
      // webview can't reach the template matcher. Non-monorepo sources send no labels (value == label).
      let versionLabels: Record<string, string> | undefined;
      if (updatedComponent.tagPattern) {
        const matcher = compileTagTemplate(updatedComponent.tagPattern, componentName);
        if (matcher) {
          versionLabels = {};
          for (const v of availableVersions) {
            versionLabels[v] = matcher.extractVersion(v) ?? v;
          }
        }
      }

      // Send versions to webview
      if (this.panel) {
        this.panel.webview.postMessage({
          command: 'versionsLoaded',
          componentName,
          sourcePath,
          versions: availableVersions,
          versionLabels,
          defaultVersion
        });
      }

      this.logger.debug(`[ComponentBrowser] Loaded ${availableVersions.length} versions for ${componentName}`, 'ComponentBrowser');

    } catch (error) {
      this.logger.error(`[ComponentBrowser] Error fetching versions for ${componentName}: ${error}`, 'ComponentBrowser');

      // Mark as no longer loading
      this.versionsLoading.delete(componentKey);

      // Send error to webview
      if (this.panel) {
        this.panel.webview.postMessage({
          command: 'versionsError',
          componentName,
          sourcePath,
          error: String(error)
        });
      }
    }
  }

  // Public method to edit an existing component from detached view (called from extension.ts)
  public async editExistingComponentFromDetached(
    component: Component,
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
    const parsedExisting = await this.parseExistingComponent(document, componentRange);
    const existingComponent = isExistingComponentShape(parsedExisting) ? parsedExisting : null;

    // Generate the new component text with updated inputs
    const newComponentText = generateComponentText(
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
    const range = findComponentLineRange(document.getText(), position.line, componentName);
    if (!range) {
      this.logger.warn(`[ComponentBrowser] Could not find component line for ${componentName}`, 'ComponentBrowser');
      return null;
    }
    this.logger.debug(
      `[ComponentBrowser] Found component range: ${range.startLine}:0 to ${range.endLine}:${range.endColumn}`,
      'ComponentBrowser',
    );
    return new vscode.Range(
      new vscode.Position(range.startLine, 0),
      new vscode.Position(range.endLine, range.endColumn),
    );
  }

  private async parseExistingComponent(document: vscode.TextDocument, range: vscode.Range): Promise<unknown> {
    return parseExistingComponentText(document.getText(range));
  }
}
