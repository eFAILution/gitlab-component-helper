import * as vscode from 'vscode';
import { createReferenceResolver, getComponentUnderCursor, resolveServerFqdn } from './componentDetector';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
import { getVariableCompletions } from '../utils/gitlabVariables';
import { buildComponentReference, parseVersionCompletionPrefix } from '../utils/componentReference';
import { Logger } from '../utils/logger';
import { isGitLabCIFile } from '../utils/gitlabCiFileMatcher';
import { resolveLocalComponent } from './localComponentResolver';
import { chooseComponentVersion } from './componentBrowserTransform';
import { readVersionPreferences } from './versionPreferenceSettings';
import { findCompletionInputContextAtLine, buildInputInsertValue, renderOptionValue, allowedValuesFor } from './completionInputContext';
import { getComponentService } from '../services/component';
import { parseComponentIdentity, findCachedComponentVersion, findAnyCachedComponentVersion } from '../utils/cachedComponentLookup';
import type { ComponentIdentity } from '../utils/cachedComponentLookup';
import type { Component, ComponentParameter } from '../types/git-component';

export class CompletionProvider implements vscode.CompletionItemProvider {
  private logger = Logger.getInstance();

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | vscode.CompletionList | null> {
    // First check if this is a GitLab CI file
    if (!isGitLabCIFile(document)) {
      this.logger.debug(`[CompletionProvider] Skipping completion for non-GitLab CI file: ${document.fileName} (language: ${document.languageId})`, 'CompletionProvider');
      return null;
    }

    const linePrefix = document.lineAt(position.line).text.substr(0, position.character);

    this.logger.debug(`[CompletionProvider] Triggered at line ${position.line + 1}, character ${position.character}`, 'CompletionProvider');
    this.logger.debug(`[CompletionProvider] File: ${document.fileName} (language: ${document.languageId})`, 'CompletionProvider');
    this.logger.debug(`[CompletionProvider] Line prefix: "${linePrefix}"`, 'CompletionProvider');

    // Check for component input completions first (highest priority)
    const inputCompletions = await this.provideComponentInputCompletions(document, position);
    if (inputCompletions && inputCompletions.length > 0) {
      this.logger.debug(`[CompletionProvider] Providing ${inputCompletions.length} component input completions`, 'CompletionProvider');
      return inputCompletions;
    }

    // Check for version completions after @
    this.logger.debug(`[CompletionProvider] Checking for version pattern in line prefix: "${linePrefix}"`, 'CompletionProvider');
    const versionMatch = parseVersionCompletionPrefix(linePrefix);
    this.logger.debug(`[CompletionProvider] Version regex match result: ${versionMatch ? 'MATCHED' : 'NO MATCH'}`, 'CompletionProvider');
    if (versionMatch) {
      this.logger.debug(`[CompletionProvider] Detected version completion request after @`, 'CompletionProvider');
      return this.provideVersionCompletions(linePrefix, document.uri);
    }

    // Suggest components after "component: "
    if (linePrefix.trim().endsWith('component:') || linePrefix.trim().endsWith('component: ')) {
      this.logger.debug(`[CompletionProvider] Detected component completion request`, 'CompletionProvider');
      return this.provideComponentCompletions(document);
    }

    // Detect if we're in a component and suggest parameters
    const component = await getComponentUnderCursor(document, position);
    if (component) {
      this.logger.debug(`[CompletionProvider] Found component context: ${component.name}, providing parameter completions`, 'CompletionProvider');
      return this.provideParameterCompletions(component.parameters);
    }

    this.logger.debug(`[CompletionProvider] No completion context found`, 'CompletionProvider');

    // Provide GitLab predefined variable completions
    this.logger.debug(`[CompletionProvider] Providing GitLab predefined variable completions`, 'CompletionProvider');
    return this.provideGitLabVariableCompletions(linePrefix);
  }

  /**
   * Provide version/tag completions for a component URL after @
   */
  private async provideVersionCompletions(linePrefix: string, forUri: vscode.Uri): Promise<vscode.CompletionItem[]> {
    this.logger.debug(`[CompletionProvider] Starting version completions for: "${linePrefix}"`, 'CompletionProvider');

    // Extract the component URL before the @
    const urlMatch = parseVersionCompletionPrefix(linePrefix);
    if (!urlMatch) {
      this.logger.warn(`[CompletionProvider] Could not parse component URL from line prefix`, 'CompletionProvider');
      return [];
    }

    const componentUrlBase = urlMatch.base;
    const currentVersionInput = urlMatch.partialVersion;

    this.logger.debug(`[CompletionProvider] Component URL base: ${componentUrlBase}`, 'CompletionProvider');
    this.logger.debug(`[CompletionProvider] Current version input: "${currentVersionInput}"`, 'CompletionProvider');

    const resolved = await createReferenceResolver(forUri)(componentUrlBase);
    if (!resolved.resolved) {
      this.logger.debug(`[CompletionProvider] Can't resolve GitLab variables for version completion: ${componentUrlBase}`, 'CompletionProvider');
      return [];
    }

    // The last path segment is the component/template name; the rest is the project path.
    try {
      const url = new URL(resolved.url);
      const gitlabInstance = url.host;
      const pathSegments = url.pathname.split('/').filter(Boolean); // remove empty segments
      if (pathSegments.length < 2) {
        this.logger.warn(`[CompletionProvider] Not enough path segments in URL: ${componentUrlBase}`, 'CompletionProvider');
        return [];
      }
      // Always treat the last two segments as project/template
      const projectPath = pathSegments.slice(0, -1).join('/');
      const componentName = pathSegments[pathSegments.length - 1];
      this.logger.debug(`[CompletionProvider] Parsed (simple) - GitLab: ${gitlabInstance}, Project: ${projectPath}, Template: ${componentName}`, 'CompletionProvider');

      // Get components from cache and find the specific component
      const cacheManager = getComponentCacheManager();
      const components = await cacheManager.getComponents();

      // Find the component by gitlab instance, project path, and component name
      const targetComponent = components.find(comp =>
        comp.gitlabInstance === gitlabInstance &&
        comp.sourcePath === projectPath &&
        comp.name === componentName
      );

      if (!targetComponent) {
        this.logger.warn(`[CompletionProvider] Component not found in cache: ${componentName} from ${gitlabInstance}/${projectPath}`, 'CompletionProvider');
        return [];
      }

      // Get available versions for this component
      let availableVersions = targetComponent.availableVersions || [];
      // If no versions cached, try to fetch them
      if (availableVersions.length === 0) {
        this.logger.info(`[CompletionProvider] No cached versions, fetching...`, 'CompletionProvider');
        try {
          availableVersions = await cacheManager.fetchComponentVersions(targetComponent);
        } catch (error) {
          this.logger.error(`[CompletionProvider] Error fetching versions: ${error}`, 'CompletionProvider');
          availableVersions = ['main', 'master']; // fallback
        }
      }

      this.logger.info(`[CompletionProvider] Found ${availableVersions.length} versions: ${availableVersions.slice(0, 5).join(', ')}`, 'CompletionProvider');

      // Create completion items for each version
      const completionItems: vscode.CompletionItem[] = [];
      // Filter versions based on current input
      const filteredVersions = availableVersions.filter(version =>
        version.toLowerCase().includes(currentVersionInput.toLowerCase())
      );
      // The version the component would be inserted with leads the list, so the 10-entry cap never drops it.
      const chosenVersion = chooseComponentVersion(availableVersions, targetComponent, readVersionPreferences(), 'main');
      const orderedVersions = filteredVersions.includes(chosenVersion)
        ? [chosenVersion, ...filteredVersions.filter(version => version !== chosenVersion)]
        : filteredVersions;
      // Limit to top 10 versions to avoid overwhelming the user
      const versionsToShow = orderedVersions.slice(0, 10);
      for (const version of versionsToShow) {
        const item = new vscode.CompletionItem(version, vscode.CompletionItemKind.Reference);
        item.detail = `Version ${version}`;
        item.documentation = `Use version ${version} of component ${componentName}`;
        // Set the insertion text to just the version (since we're after the @)
        item.insertText = version;
        // Add sort priority based on version type
        if (version === chosenVersion) {
          item.sortText = '0' + version;
          item.preselect = true;
        } else if (version === 'main' || version === 'master') {
          item.sortText = '1' + version; // High priority for main branches
        } else if (version.match(/^\d+\.\d+\.\d+$/)) {
          item.sortText = '2' + version; // Medium priority for semantic versions
        } else {
          item.sortText = '3' + version; // Lower priority for other versions
        }
        completionItems.push(item);
      }
      this.logger.debug(`[CompletionProvider] Created ${completionItems.length} version completion items`, 'CompletionProvider');
      return completionItems;
    } catch (err) {
      this.logger.error(`[CompletionProvider] Error parsing component URL: ${err}`, 'CompletionProvider');
      return [];
    }
  }

  /**
   * Provide component completions after "component: "
   */
  private async provideComponentCompletions(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
    this.logger.debug(`[CompletionProvider] Providing component completions`, 'CompletionProvider');

    const cacheManager = getComponentCacheManager();
    const components = await cacheManager.getComponents();

    this.logger.debug(`[CompletionProvider] Found ${components.length} components in cache`, 'CompletionProvider');

    const completionItems: vscode.CompletionItem[] = [];
    const seenComponents = new Set<string>();
    const preferences = readVersionPreferences();
    const serverFqdn = await resolveServerFqdn(document.uri);

    for (const component of components) {
      // Create a unique key for each component to avoid duplicates
      const componentKey = `${component.name}@${component.sourcePath}@${component.gitlabInstance}`;

      if (seenComponents.has(componentKey)) {
        continue;
      }
      seenComponents.add(componentKey);

      const bestVersion = chooseComponentVersion(component.availableVersions ?? [], component, preferences, 'main');

      // Suggest the best version; the user can change it afterwards.
      const componentUrl = buildComponentReference(
        component.gitlabInstance,
        component.sourcePath,
        component.name,
        bestVersion,
        serverFqdn,
      );

      const item = new vscode.CompletionItem(component.name, vscode.CompletionItemKind.Module);
      item.detail = `Component from ${component.source}`;

      let documentation = `**${component.name}**\n\n`;
      if (component.description) {
        documentation += `${component.description}\n\n`;
      }
      documentation += `**Source:** ${component.source}\n`;
      documentation += `**Instance:** ${component.gitlabInstance}\n`;
      if (component.availableVersions && component.availableVersions.length > 0) {
        documentation += `**Available versions:** ${component.availableVersions.slice(0, 5).join(', ')}${component.availableVersions.length > 5 ? '...' : ''}\n`;
      }
      if (component.parameters && component.parameters.length > 0) {
        documentation += `**Parameters:** ${component.parameters.length}\n`;
      }

      item.documentation = new vscode.MarkdownString(documentation);

      item.insertText = componentUrl;
      completionItems.push(item);
    }

    this.logger.debug(`[CompletionProvider] Created ${completionItems.length} component completion items`, 'CompletionProvider');
    return completionItems;
  }

  private provideParameterCompletions(parameters: ComponentParameter[]): vscode.CompletionItem[] {
    return parameters.map(param => {
      const item = new vscode.CompletionItem(param.name, vscode.CompletionItemKind.Property);
      item.documentation = new vscode.MarkdownString(param.description);

      if (param.default !== undefined) {
        item.insertText = new vscode.SnippetString(`${param.name}: \${1:${param.default}}`);
      } else {
        item.insertText = new vscode.SnippetString(`${param.name}: \${1}`);
      }

      return item;
    });
  }

  /**
   * Provide GitLab predefined variable completions
   */
  private provideGitLabVariableCompletions(linePrefix: string): vscode.CompletionItem[] {
    this.logger.debug(`[CompletionProvider] Providing GitLab predefined variable completions`, 'CompletionProvider');

    const completionItems: vscode.CompletionItem[] = [];

    // Check if we're in a context where $ variables are expected
    const lastChar = linePrefix.slice(-1);
    const beforeCursor = linePrefix.slice(-10); // Look at last 10 characters

    // If $ was just typed, provide all variables
    const shouldProvideVariables = lastChar === '$' || beforeCursor.includes('$');

    if (shouldProvideVariables) {
      // Use the new GitLab variables utility for completions
      const variables = getVariableCompletions();

      for (const variable of variables) {
        const item = new vscode.CompletionItem(`$${variable.name}`, vscode.CompletionItemKind.Variable);
        item.detail = variable.description;
        item.documentation = new vscode.MarkdownString(`**GitLab Predefined Variable**\n\n${variable.description}\n\n**Example:** \`${variable.example}\``);
        item.insertText = variable.name; // Don't include $ since it might already be typed

        completionItems.push(item);
      }
    } else {
      // Provide context-sensitive completions for partial matches
      const variables = getVariableCompletions(linePrefix);

      for (const variable of variables) {
        const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
        item.detail = variable.description;
        item.documentation = new vscode.MarkdownString(`**GitLab Predefined Variable**\n\n${variable.description}\n\n**Example:** \`${variable.example}\``);

        completionItems.push(item);
      }
    }

    this.logger.debug(`[CompletionProvider] Created ${completionItems.length} GitLab variable completion items`, 'CompletionProvider');
    return completionItems;
  }

  // Enhanced method to detect if we're in a component inputs section and provide input completions
  private async provideComponentInputCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | null> {
    try {
      const text = document.getText();

      const context = findCompletionInputContextAtLine(text, position.line, position.character);
      if (!context) {
        this.logger.debug(`[CompletionProvider] No inputs parameter-name slot at cursor`, 'CompletionProvider');
        return null;
      }

      const { componentUrl, includeKind, existingInputNames } = context;
      const isLocal = includeKind === 'local';

      this.logger.debug(`[CompletionProvider] In inputs ${context.slot} slot for ${componentUrl} (local=${isLocal})`, 'CompletionProvider');

      // Get the component details - local includes resolve from the workspace file, others from cache.
      const component = isLocal
        ? await resolveLocalComponent(componentUrl, document)
        : await this.findComponentInCache(componentUrl, document.uri);
      if (!component || !component.parameters) {
        this.logger.debug(`[CompletionProvider] Component not found in cache or has no parameters: ${componentUrl}`, 'CompletionProvider');
        return null;
      }

      this.logger.debug(`[CompletionProvider] Found component ${component.name} with ${component.parameters.length} parameters; existing inputs: ${existingInputNames.join(', ') || 'none'}`, 'CompletionProvider');

      // A value slot (cursor after a known `inputName:`) offers that input's allowed values, independent of whether
      // it also declares a default — the default is just the pre-filled choice, not a reason to hide the others.
      if (context.slot === 'value') {
        const param = component.parameters.find((p: ComponentParameter) => p.name === context.inputName);
        // A `boolean` input is a closed two-value enum, so offer `true`/`false` even though it declares no `options:`.
        const values = param ? allowedValuesFor(param) : undefined;
        if (!values?.length) {
          this.logger.debug(`[CompletionProvider] Value slot for ${context.inputName} has no options to offer`, 'CompletionProvider');
          return null;
        }
        return values.map((value, index) => {
          const rendered = renderOptionValue(value);
          const item = new vscode.CompletionItem(String(value), vscode.CompletionItemKind.EnumMember);
          item.insertText = rendered;
          // Flag the declared default rather than reordering around it — the list stays in a stable, scannable
          // order (`true` before `false`, or the spec's own `options:` order) whatever the default happens to be.
          const isDefault = param?.default !== undefined && param.default === value;
          item.detail = `${param?.type || 'string'} option${isDefault ? ' (default)' : ''}`;
          // Preserve the declared order of the allowed values in the dropdown.
          item.sortText = String(index).padStart(4, '0');
          return item;
        });
      }

      // Filter out already provided inputs
      const existing = new Set(existingInputNames);
      const missingInputs = component.parameters.filter((param: ComponentParameter) => !existing.has(param.name));

      this.logger.debug(`[CompletionProvider] Found ${missingInputs.length} missing inputs for completion: ${missingInputs.map(p => p.name).join(', ')}`, 'CompletionProvider');

      // Create completion items for missing inputs
      return missingInputs.map((param: ComponentParameter) => {
        const item = new vscode.CompletionItem(param.name, vscode.CompletionItemKind.Property);

        // Enhanced documentation
        let documentation = `**${param.name}** (${param.required ? 'required' : 'optional'})\n\n`;
        documentation += `${param.description || 'No description available'}\n\n`;
        documentation += `**Type:** ${param.type || 'string'}\n`;
        if (param.default !== undefined) {
          documentation += `**Default:** \`${param.default}\`\n`;
        }

        item.documentation = new vscode.MarkdownString(documentation);

        item.insertText = new vscode.SnippetString(`${param.name}: ${buildInputInsertValue(param)}`);

        // Add sorting priority (required params first)
        item.sortText = param.required ? `0${param.name}` : `1${param.name}`;

        // Add detail showing requirement status
        item.detail = `${param.type || 'string'} ${param.required ? '(required)' : '(optional)'}`;

        return item;
      });
    } catch (error) {
      this.logger.error(`[CompletionProvider] Error in provideComponentInputCompletions: ${error}`, 'CompletionProvider');
      return null;
    }
  }

  // Resolves the spec for the exact version the include references, since inputs can differ between versions.
  // `forUri` is the active document's URI — used so variable expansion picks
  // the GitLab host matching the file's containing repo, not workspace[0].
  private async findComponentInCache(componentUrl: string, forUri: vscode.Uri): Promise<Component | null> {
    try {
      const cacheManager = getComponentCacheManager();
      const components = await cacheManager.getComponents();

      const resolved = await createReferenceResolver(forUri)(componentUrl);
      if (!resolved.resolved) {
        this.logger.debug(`[CompletionProvider] Can't resolve GitLab variables in component URL: ${componentUrl}`, 'CompletionProvider');
        return null;
      }

      const identity = parseComponentIdentity(resolved.url);
      if (!identity) {
        this.logger.warn(`[CompletionProvider] Invalid component URL format: ${componentUrl}`, 'CompletionProvider');
        return null;
      }

      this.logger.debug(`[CompletionProvider] Looking for component: ${identity.name}@${identity.version ?? 'unspecified'} in project: ${identity.sourcePath} on ${identity.gitlabInstance}`, 'CompletionProvider');

      const exactVersion = findCachedComponentVersion(components, identity);
      if (exactVersion) {
        this.logger.debug(`[CompletionProvider] Found cached ${exactVersion.name}@${exactVersion.version}`, 'CompletionProvider');
        return exactVersion;
      }

      const fetched = await this.fetchReferencedVersion(resolved.url, identity);
      if (fetched) {
        return fetched;
      }

      // Offline or fetch failed: another version's inputs beat offering none.
      const anyVersion = findAnyCachedComponentVersion(components, identity);
      if (anyVersion) {
        this.logger.debug(`[CompletionProvider] Falling back to cached ${anyVersion.name}@${anyVersion.version} for requested ${identity.version ?? 'unspecified'}`, 'CompletionProvider');
        return anyVersion;
      }

      this.logger.debug(`[CompletionProvider] No cached version of ${identity.name} in ${identity.sourcePath}`, 'CompletionProvider');
      return null;
    } catch (error) {
      this.logger.error(`[CompletionProvider] Error finding component in cache: ${error}`, 'CompletionProvider');
      return null;
    }
  }

  // Fetches the referenced version's spec and caches it under that version, as validation does.
  private async fetchReferencedVersion(expandedUrl: string, identity: ComponentIdentity): Promise<Component | null> {
    const version = identity.version;
    if (!version) {
      return null;
    }
    try {
      const fetched = await getComponentService().getComponentFromUrl(expandedUrl);
      if (!fetched) {
        return null;
      }
      getComponentCacheManager().addDynamicComponent({
        name: fetched.name,
        description: fetched.description,
        parameters: fetched.parameters,
        source: fetched.source || '',
        sourcePath: identity.sourcePath,
        gitlabInstance: identity.gitlabInstance,
        version,
        url: expandedUrl,
        templatePath: fetched.templatePath
      });
      this.logger.debug(`[CompletionProvider] Fetched and cached ${fetched.name}@${version}`, 'CompletionProvider');
      return fetched;
    } catch (error) {
      this.logger.debug(`[CompletionProvider] Error fetching ${identity.name}@${version}: ${error}`, 'CompletionProvider');
      return null;
    }
  }
}
