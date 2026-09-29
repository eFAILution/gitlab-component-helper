import * as vscode from 'vscode';
import { getComponentService } from '../services/component';
import { ComponentCacheManager } from '../services/cache/componentCacheManager';
import { GitLabCatalogComponent, GitLabCatalogVariable } from '../types/gitlab-catalog';
import type { ComponentParameter, Component } from './componentDetector';
import { isVersionLookupShape } from '../services/component/versionLookupShape';
import type { SourceGroup, ComponentGroup, ComponentVersion } from './componentBrowserTypes';
import type { HoverContext } from './hoverContentBuilder';
import { containsGitLabVariables } from '../utils/gitlabVariables';
import { Logger } from '../utils/logger';
import { templateFileUrlForResolved } from '../utils/templateFileUrl';
import { escapeHtml, handlerArg, renderInlineMarkdown } from '../webview/inlineMarkdown';
import { serializeForScript } from '../webview/scriptData';
import { generateComponentText } from './componentBrowserGenerate';
import { findComponentLineRange, parseExistingComponentText } from './componentBrowserEdit';
import { transformCachedComponentsToGroups } from './componentBrowserTransform';
import { buildVersionLabels, compileTagTemplate, stripTagPrefix } from '../services/component/tagScoping';
import { assetRoots, assetUri, createNonce, cspMetaTag } from '../webview/webviewHtml';
import { safeHttpUrl } from '../webview/safeUrl';

/**
 * Component shape carried through the detach-hover webview's "Open in Detailed View" round trip.
 * Adds the hover-builder's location context so the message handler can route inserts back to the
 * originating editor position. Mirrors the same alias in `extension.ts` — kept local here rather
 * than centralised because the field is a runtime-only extension applied by `hoverContentBuilder`.
 */
type DetachableComponent = Component & { _hoverContext?: HoverContext };

/** Per-entry-point behaviour for the shared details-panel message handler. */
interface DetailsPanelOptions {
  /**
   * Set by the detached (hover) entry point to the editor the panel was opened from. Two effects, both of which
   * exist because that entry point constructs its own provider rather than going through `show()`:
   *
   * 1. The editor is adopted as this provider's insertion target at registration, since nothing else has populated
   *    it and `insertComponent` refuses to insert without one.
   * 2. The panel is disposed once an insert completes — it is a one-shot view, where the Component Browser's own
   *    details panel stays open.
   *
   * Refocusing the target editor is not one of them: `insertComponent` and `editExistingComponentFromDetached` each
   * focus and verify their own document, on both entry points.
   */
  detachedFrom?: vscode.TextEditor;
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
        localResourceRoots: assetRoots(this.context.extensionUri)
      }
    );

    // Set initial HTML content with loading message
    this.panel.webview.html = this.getLoadingHtml(this.panel.webview);

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
      this.panel.webview.html = this.getLoadingHtml(this.panel.webview);

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
        this.panel.webview.html = this.getNoSourcesHtml(this.panel.webview);
        return;
      }

      // If no components found but we have cache errors, show errors
      if (allComponents.length === 0 && Object.keys(cacheErrors).length > 0) {
        this.panel.webview.html = this.getErrorsHtml(this.panel.webview, cacheErrors);
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

      this.panel.webview.html = this.getComponentBrowserHtml(this.panel.webview, allComponents, filteredErrors);
    } catch (error) {
      this.logger.error(`[ComponentBrowser] Error in loadComponents: ${error}`, 'ComponentBrowser');
      if (this.panel) {
        this.panel.webview.html = this.getErrorHtml(this.panel.webview, error);
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

  public async showComponentDetails(component: DetachableComponent) {
    // Create a new webview panel for component details
    const detailsPanel = vscode.window.createWebviewPanel(
      'gitlabComponentDetails',
      `Component: ${component.name}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: assetRoots(this.context.extensionUri)
      }
    );

    // The component arrives from the webview carrying only the selected version and none of the source settings;
    // recover the full version list and monorepo settings from the cache so the dropdown is complete and labelled.
    const enriched = await this.lookupComponentDetails(component);

    // Show component details
    detailsPanel.webview.html = this.getComponentDetailsHtml(detailsPanel.webview, { ...component, ...enriched });

    this.registerDetailsPanelMessageHandler(detailsPanel, { ...component, ...enriched });
  }

  /**
   * Wires the details panel's message handling. Both entry points — the Component Browser's Details button and the
   * hover's "Open in Detailed View" — render the same HTML and speak the same protocol, so they share this handler;
   * `options.detachedFrom` carries the only behavioural difference between them.
   *
   * @param panel     The details webview panel to attach to.
   * @param component The component being shown. Held mutably: a `versionChanged` round trip replaces it so later
   *                  `fetchVersions`/`insertComponent` messages act on the version the user is actually looking at.
   * @param options   Per-entry-point behaviour; see {@link DetailsPanelOptions}.
   */
  public registerDetailsPanelMessageHandler(
    panel: vscode.WebviewPanel,
    component: DetachableComponent,
    options: DetailsPanelOptions = {}
  ): void {
    let active = component;

    if (options.detachedFrom) {
      this.adoptOriginalEditor(options.detachedFrom);
    }

    panel.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'insertComponent': {
          const { version, includeInputs, selectedInputs } = message;
          try {
            let target = active;
            if (version && version !== active.version) {
              if (!active.sourcePath || !active.gitlabInstance) {
                vscode.window.showErrorMessage('Cannot fetch version: component is missing source path or GitLab instance.');
                return;
              }
              const updatedComponent = await this.cacheManager.fetchSpecificVersion(
                active.name,
                active.sourcePath,
                active.gitlabInstance,
                version
              );
              if (!updatedComponent) {
                vscode.window.showErrorMessage(`Failed to fetch version ${version} of component ${active.name}`);
                return;
              }
              target = updatedComponent;
            }

            if (active._hoverContext) {
              await this.editExistingComponentFromDetached(
                target,
                active._hoverContext.documentUri,
                active._hoverContext.position,
                includeInputs || false,
                selectedInputs || []
              );
            } else {
              await this.insertComponent(target, includeInputs || false, selectedInputs || []);
            }

            // The detached panel is a one-shot view opened from a hover, so it closes once it has done its job.
            if (options.detachedFrom) {
              panel.dispose();
            }
          } catch (error) {
            this.logger.error(`[ComponentBrowser] Error inserting component from details panel: ${error}`, 'ComponentBrowser');
            vscode.window.showErrorMessage(`Error inserting component: ${error}`);
          }
          break;
        }

        case 'fetchVersions': {
          try {
            if (!isVersionLookupShape(active)) {
              throw new Error(`Cannot look up versions for ${active.name}: missing source path or GitLab instance.`);
            }
            // Bind the narrowed value: `active` is reassignable, so TS widens it back across the await below.
            const lookupTarget = active;
            const versions = await this.cacheManager.fetchComponentVersions(lookupTarget);
            // Same monorepo labelling as the detached panel: the webview can't reach the template matcher, so the
            // full tag → stripped {version} map is built here. Without it a refresh reverts the dropdown to full tags.
            panel.webview.postMessage({
              command: 'versionsLoaded',
              versions,
              versionLabels: buildVersionLabels(versions, lookupTarget.name, lookupTarget.tagPattern),
              currentVersion: lookupTarget.version
            });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.error(`[ComponentBrowser] Error fetching versions: ${reason}`, 'ComponentBrowser');
            panel.webview.postMessage({
              command: 'versionsError',
              error: reason
            });
          }
          break;
        }

        case 'openLink': {
          // The webview names a link; it never supplies the URL. The host resolves it from the component it holds and
          // validates it again here, so a message from a compromised document cannot open anything the component
          // metadata did not already name. `openExternal` then applies VS Code's trusted-domain confirmation, which
          // shows the user the destination before an untrusted host is opened.
          const target = message.link === 'documentation'
            ? active.documentationUrl
            : message.link === 'templateFile'
              ? this.buildTemplateFileUrl(active)
              : undefined;
          const url = safeHttpUrl(target);
          if (!url) {
            this.logger.warn(`[ComponentBrowser] Refused to open ${String(message.link)} link: not an http(s) URL`, 'ComponentBrowser');
            break;
          }
          await vscode.env.openExternal(vscode.Uri.parse(url, true));
          break;
        }

        case 'versionChanged': {
          const { selectedVersion } = message;
          try {
            this.logger.debug(`[ComponentBrowser] Version changed to ${selectedVersion}, fetching details...`, 'ComponentBrowser');

            if (!active.sourcePath || !active.gitlabInstance) {
              vscode.window.showErrorMessage('Cannot change version: component is missing source path or GitLab instance.');
              return;
            }
            const updatedComponent = await this.cacheManager.fetchSpecificVersion(
              active.name,
              active.sourcePath,
              active.gitlabInstance,
              selectedVersion
            );
            if (updatedComponent) {
              // Carry the hover context forward so a later insert still edits in place rather than inserting anew.
              // Carry the documentation URL forward too: a cached version carries none, and it names the project rather
              // than a version, so dropping it would silently break the Project URL link after a version switch.
              active = {
                ...updatedComponent,
                documentationUrl: active.documentationUrl,
                _hoverContext: active._hoverContext,
              };
              // Send the updated component details to the webview, with the template-file URL precomputed
              // server-side so the webview never has to do its own URL routing.
              panel.webview.postMessage({
                command: 'componentDetailsUpdated',
                component: {
                  ...updatedComponent,
                  documentationUrl: safeHttpUrl(active.documentationUrl),
                  templateFileUrl: safeHttpUrl(this.buildTemplateFileUrl(updatedComponent)),
                }
              });
            } else {
              panel.webview.postMessage({
                command: 'versionChangeError',
                error: `Failed to fetch details for version ${selectedVersion}`
              });
            }
          } catch (error) {
            this.logger.error(`[ComponentBrowser] Error fetching version details: ${error}`, 'ComponentBrowser');
            panel.webview.postMessage({
              command: 'versionChangeError',
              error: error instanceof Error ? error.message : String(error)
            });
          }
          break;
        }
      }
    });
  }

  /**
   * Adopts `editor` as the insertion target for a panel opened outside `show()`. The detached (hover) panel builds its
   * own provider, so nothing has populated `originalEditor` and `insertComponent` would otherwise refuse to insert.
   */
  private adoptOriginalEditor(editor: vscode.TextEditor): void {
    this.originalEditor = editor;
  }

  private getLoadingHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const styleUri = assetUri(webview, this.context.extensionUri, 'styles/loading.css');
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${cspMetaTag(webview.cspSource, nonce)}
        <link rel="stylesheet" href="${styleUri}">
        <title>GitLab CI/CD Components</title>
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

  /**
   * Render the Component Browser: every configured source, its projects and their components, as a collapsible tree.
   *
   * @param webview         The panel this document is for, used to resolve its asset URIs.
   * @param componentGroups Sources with their projects and components, already grouped for display.
   * @param cacheErrors     Per-source failure messages, keyed by source name. Sources that failed are listed in a
   *                        banner above the tree; an empty record omits it.
   * @returns               The panel's complete HTML document.
   */
  private getComponentBrowserHtml(
    webview: vscode.Webview,
    componentGroups: SourceGroup[],
    cacheErrors: Record<string, string> = {}
  ): string {
    const styleUri = assetUri(webview, this.context.extensionUri, 'styles/componentBrowser.css');
    const scriptUri = assetUri(webview, this.context.extensionUri, 'client/componentBrowser.js');
    const hasErrors = Object.keys(cacheErrors).length > 0;

    // Prepare version data as a safe JSON string
    // Null-prototype maps: component names and versions are publisher-controlled, and `__proto__` is a legal template
    // file name and git tag. On a plain object, `acc['__proto__'][v] = …` would write to Object.prototype in the
    // extension host.
    const versionData = componentGroups.reduce<Record<string, Record<string, ComponentVersion>>>((acc, source) => {
      if (source.projects && Array.isArray(source.projects)) {
        source.projects.forEach(project => {
          if (project.components && Array.isArray(project.components)) {
            project.components.forEach(component => {
              if (!Object.prototype.hasOwnProperty.call(acc, component.name)) {
                acc[component.name] = Object.create(null) as Record<string, ComponentVersion>;
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
    }, Object.create(null) as Record<string, Record<string, ComponentVersion>>);

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
              const initialVersion = component.defaultVersion || component.availableVersions[0];
              const hasVersions = component.availableVersions && component.availableVersions.length > 0;

              return `
              <div class="component-card" data-name="${this.escapeHtml(component.name)}" data-description="${this.escapeHtml(component.description || '')}" data-component-name="${this.escapeHtml(component.name)}" data-project-id="${projectId}" data-source-path="${this.escapeHtml(component.sourcePath)}" data-gitlab-instance="${this.escapeHtml(component.gitlabInstance)}" id="component-${this.escapeHtml(componentKey)}">
                <div class="component-header">
                  <span class="component-title">
                    ${this.escapeHtml(component.name)}
                    ${hasVersions && component.availableVersions.length > 1 ? `<span class="version-badge">${component.availableVersions.length} versions</span>` : ''}
                  </span>
                  <div class="component-actions" id="actions-${this.escapeHtml(componentKey)}">
                    ${hasVersions ? `
                      ${component.availableVersions.length > 1 ? `
                        <select class="version-dropdown" onchange="updateComponentVersion(${this.jsArg(component.name)}, this.value, ${this.jsArg(projectId)})" oncontextmenu="showContextMenu(event, ${this.jsArg(component.name)}, this.value, ${this.jsArg(projectId)})">
                          ${this.renderVersionOptions(component)}
                        </select>
                      ` : `<span class="single-version">${this.escapeHtml(component.availableVersions[0] || 'latest')}</span>`}
                      <button data-role="details" onclick="viewDetailsById(${this.jsArg(component.name)}, ${this.jsArg(initialVersion)})">Details</button>
                      <button data-role="insert" onclick="insertComponentById(${this.jsArg(component.name)}, ${this.jsArg(initialVersion)})">Insert</button>
                    ` : `
                      <button class="load-versions-btn" onclick="loadComponentVersions(${this.jsArg(component.name)}, ${this.jsArg(component.sourcePath)}, ${this.jsArg(component.gitlabInstance)}, ${this.jsArg(projectId)})">Load Versions</button>
                      <span class="loading-versions" id="loading-${this.escapeHtml(componentKey)}" style="display: none;">Loading...</span>
                    `}
                  </div>
                </div>
                <div class="component-description" id="desc-${this.escapeHtml(component.name)}-${projectId}">${this.renderInlineMarkdown(component.description || '')}</div>
                ${hasVersions && component.availableVersions.length > 1 ? `
                  <div class="version-info" id="version-info-${this.escapeHtml(component.name)}-${projectId}">
                    <small>Default version: ${this.escapeHtml(component.defaultVersion)}</small>
                  </div>
                ` : ''}
              </div>
            `;
            }).join('');

          return `
            <div class="project-group">
              <div class="project-header" onclick="toggleProject('${projectId}')">
                <span class="project-icon" id="project-icon-${projectId}">${project.isExpanded ? '▼' : '▶'}</span>
                <span class="project-title">${this.escapeHtml(project.name)} (${components.length})</span>
                <span class="project-path">${this.escapeHtml(project.gitlabInstance)}/${this.escapeHtml(project.path)}</span>
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
              <span class="source-title">${this.escapeHtml(source.source)} (${source.projects?.length || 0} projects, ${source.totalComponents || 0} components)</span>
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
        <link rel="stylesheet" href="${styleUri}">
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

        <script type="application/json" id="component-version-data">${versionDataJson}</script>
        <script src="${scriptUri}"></script>
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
    webview: vscode.Webview,
    component: Component & {
      availableVersions?: string[];
      tagPattern?: string;
    },
  ): string {
    const nonce = createNonce();
    const styleUri = assetUri(webview, this.context.extensionUri, 'styles/componentDetails.css');
    const scriptUri = assetUri(webview, this.context.extensionUri, 'client/componentDetails.js');

    const parameters = component.parameters || [];
    const availableVersions = component.availableVersions || [component.version || 'main'];
    const headerSummary = component.summary;
    const headerUsage = component.usage;
    const headerNotes = Array.isArray(component.notes) ? component.notes : [];
    const hasContext = Boolean(headerSummary || headerUsage || headerNotes.length > 0);
    const rawYaml = component.rawYaml || '';
    const hasRawYaml = Boolean(rawYaml);
    const templateFileUrl = this.buildTemplateFileUrl(component);
    // `documentationUrl` is whatever the component's publisher put in its catalog entry. Validate before display; the
    // anchors carry no URL, and clicking one has the extension host open it (see `openLink`).
    const safeDocUrl = safeHttpUrl(component.documentationUrl);
    const safeTemplateUrl = safeHttpUrl(templateFileUrl);

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Component: ${this.escapeHtml(component.name)}</title>
        ${cspMetaTag(webview.cspSource, nonce)}
        <link rel="stylesheet" href="${styleUri}">
      </head>
      <body>
        <h1 id="componentName">${this.escapeHtml(component.name)}</h1>

        <div class="description" id="componentDescription">
          ${this.renderInlineMarkdown(component.description || '')}
        </div>

        <div id="componentContext" class="metadata ${hasContext ? '' : 'is-hidden'}">
          <div><strong>Context</strong></div>
          <div id="componentSummaryRow" class="${headerSummary ? '' : 'is-hidden'}">
            <strong>Summary:</strong> <span id="componentSummary">${this.escapeHtml(headerSummary || '')}</span>
          </div>
          <div id="componentUsageRow" class="${headerUsage ? '' : 'is-hidden'}">
            <strong>Usage:</strong> <span id="componentUsage">${this.escapeHtml(headerUsage || '')}</span>
          </div>
          <div id="componentNotesRow" class="${headerNotes.length > 0 ? '' : 'is-hidden'}">
            <strong>Notes:</strong>
            <ul id="componentNotes">
              ${headerNotes.map((note: string) => `<li>${this.escapeHtml(note)}</li>`).join('')}
            </ul>
          </div>
        </div>

        <div id="rawYamlSection" class="metadata ${hasRawYaml ? '' : 'is-hidden'}">
          <div class="parameters-header raw-yaml-header">
            <h2>Raw YAML</h2>
            <button class="secondary" id="toggle-raw-yaml" data-action="toggleRawYaml">Show</button>
          </div>
          <pre id="raw-yaml-content" class="is-hidden">${this.escapeHtml(rawYaml)}</pre>
        </div>

        <div class="metadata">
          <div><strong>Source:</strong> <span id="componentSource">${this.escapeHtml(component.source || '')}</span></div>
          <div><strong>GitLab Instance:</strong> <span id="componentInstance">${this.escapeHtml(component.gitlabInstance || 'gitlab.com')}</span></div>
          <div class="version-control">
            <strong>Version:</strong>
            <select id="versionSelect" data-action="onVersionChange">
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
            <span class="version-loading is-hidden" id="versionLoading">Loading version details...</span>
          </div>
          ${safeDocUrl ?
            `<div><strong>Project URL:</strong> <a href="#" data-action="openDocumentation" id="componentDocUrl">${this.escapeHtml(safeDocUrl)}</a></div>` : ''}
          ${component.url ?
            `<div><strong>Component URL:</strong> <code id="componentUrl">${this.escapeHtml(component.url)}</code></div>` : ''}
          ${safeTemplateUrl ?
            `<div><strong>Template File:</strong> <a href="#" data-action="openTemplateFile" id="templateFileUrl">${this.escapeHtml(safeTemplateUrl)}</a></div>` : ''}
        </div>

        <div class="parameters-header">
          <h2>Parameters</h2>
          ${parameters.length > 0 ? `
            <div class="select-all-group">
              <input type="checkbox" id="selectAllInputs" data-action="toggleAllInputs">
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
                      <span class="parameter-name">${this.escapeHtml(param.name)}</span>
                      <span class="${param.required ? 'parameter-required' : 'parameter-optional'}">
                        (${param.required ? 'required' : 'optional'})
                      </span>
                    </div>
                    <div>${this.escapeHtml(param.description || `Parameter: ${param.name}`)}</div>
                    <div><strong>Type:</strong> ${this.escapeHtml(param.type || 'string')}</div>
                    ${param.default !== undefined ?
                      `<div><strong>Default:</strong> <span class="parameter-default">${this.escapeHtml(String(param.default))}</span></div>` : ''}
                  </div>
                  <div class="parameter-checkbox">
                    <input type="checkbox" id="input-${this.escapeHtml(param.name)}" class="input-checkbox" data-action="updateInputSelection" data-param-name="${this.escapeHtml(param.name)}">
                    <label for="input-${this.escapeHtml(param.name)}">Insert</label>
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
            <button data-action="insertComponent">Insert Component</button>
            <button class="secondary" data-action="refreshVersions">Refresh Versions</button>
          </div>
        </div>

        <script type="application/json" id="details-bootstrap" nonce="${nonce}">${serializeForScript({
          loaded: availableVersions.length > 1,
        })}</script>
        <script nonce="${nonce}" src="${scriptUri}"></script>
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

  /** See {@link handlerArg}: a JS string argument, safe inside an event-handler attribute. */
  private jsArg(value: string | undefined): string {
    return handlerArg(value);
  }

  private renderInlineMarkdown(value: string): string {
    return renderInlineMarkdown(value);
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

  private getNoSourcesHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const styleUri = assetUri(webview, this.context.extensionUri, 'styles/noSources.css');
    const scriptUri = assetUri(webview, this.context.extensionUri, 'client/noSources.js');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${cspMetaTag(webview.cspSource, nonce)}
        <title>GitLab CI/CD Components</title>
        <link rel="stylesheet" href="${styleUri}">
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

        <button data-action="openSettings">Open Settings</button>

        <script nonce="${nonce}" src="${scriptUri}"></script>
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
  private getErrorsHtml(webview: vscode.Webview, errors: Record<string, string>): string {
    const nonce = createNonce();
    const styleUri = assetUri(webview, this.context.extensionUri, 'styles/errors.css');
    const scriptUri = assetUri(webview, this.context.extensionUri, 'client/errors.js');

    const entries = Object.entries(errors);
    const hasAuthError = entries.some(([, error]) => this.classifySourceError(error).isAuth);

    const errorItemsHtml = entries.map(([source, error], index) => {
      const { summary } = this.classifySourceError(error);
      const detailsId = `error-details-${index}`;
      return `
        <div class="error-item">
          <div class="error-source">${this.escapeHtml(source)}</div>
          <div class="error-summary">${this.escapeHtml(summary)}</div>
          <button class="link-button" data-action="toggleDetails" data-details-id="${detailsId}">Show details</button>
          <pre class="error-raw is-hidden" id="${detailsId}">${this.escapeHtml(error)}</pre>
        </div>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${cspMetaTag(webview.cspSource, nonce)}
        <title>GitLab CI/CD Components</title>
        <link rel="stylesheet" href="${styleUri}">
      </head>
      <body>
        <h1>Component Loading Errors</h1>

        <p>There were errors loading components from the configured sources:</p>

        <div class="errors">
          ${errorItemsHtml}
        </div>

        <div>
          ${hasAuthError ? '<button data-action="updateToken">Update Token</button>' : ''}
          <button data-action="refresh">Try Again</button>
          <button data-action="openSettings">Open Settings</button>
        </div>

        <script nonce="${nonce}" src="${scriptUri}"></script>
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
      'Reset Cache'
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
          this.panel.webview.html = this.getLoadingHtml(this.panel.webview);
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
  private getErrorHtml(webview: vscode.Webview, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const { isAuth, summary } = this.classifySourceError(message);
    const nonce = createNonce();
    const styleUri = assetUri(webview, this.context.extensionUri, 'styles/errors.css');
    const scriptUri = assetUri(webview, this.context.extensionUri, 'client/errors.js');
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${cspMetaTag(webview.cspSource, nonce)}
        <title>GitLab CI/CD Components - Error</title>
        <link rel="stylesheet" href="${styleUri}">
      </head>
      <body>
        <h1>Component Loading Error</h1>

        <div class="error">
          ${isAuth
            ? `${this.escapeHtml(summary)}
               <button class="link-button" data-action="toggleDetails" data-details-id="error-raw">Show details</button>
               <pre class="error-raw is-hidden" id="error-raw">${this.escapeHtml(message)}</pre>`
            : `<strong>Error:</strong> ${this.escapeHtml(message)}`}
        </div>

        <div>
          ${isAuth ? '<button data-action="updateToken">Update Token</button>' : ''}
          <button data-action="refresh">Try Again</button>
          <button data-action="openSettings">Open Settings</button>
        </div>

        <script nonce="${nonce}" src="${scriptUri}"></script>
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
      const versionLabels = buildVersionLabels(availableVersions, componentName, updatedComponent.tagPattern);

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
