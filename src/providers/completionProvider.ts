import * as vscode from 'vscode';
import { getComponentUnderCursor } from './componentDetector';
import { getComponentService } from '../services/componentService';
import { GitLabCatalogComponent, GitLabCatalogVariable } from '../types/gitlab-catalog';
import { getComponentCacheManager } from '../services/componentCacheManager';
import { getVariableCompletions, GITLAB_PREDEFINED_VARIABLES } from '../utils/gitlabVariables';
import { Logger } from '../utils/logger';

export class CompletionProvider implements vscode.CompletionItemProvider {
  private logger = Logger.getInstance();

  // Helper function to check if file is a GitLab CI file
  private isGitLabCIFile(document: vscode.TextDocument): boolean {
    const fileName = document.fileName.toLowerCase();
    return fileName.endsWith('.gitlab-ci.yml') || fileName.endsWith('.gitlab-ci.yaml') ||
           fileName.includes('gitlab-ci') || document.languageId === 'gitlab-ci';
  }

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | vscode.CompletionList | null> {
    // First check if this is a GitLab CI file
    if (!this.isGitLabCIFile(document)) {
      this.logger.debug(`[CompletionProvider] Skipping completion for non-GitLab CI file: ${document.fileName} (language: ${document.languageId})`, 'CompletionProvider');
      return null;
    }

    const linePrefix = document.lineAt(position.line).text.substr(0, position.character);

    this.logger.debug(`[CompletionProvider] Triggered at line ${position.line + 1}, character ${position.character}`, 'CompletionProvider');
    this.logger.debug(`[CompletionProvider] File: ${document.fileName} (language: ${document.languageId})`, 'CompletionProvider');
    this.logger.debug(`[CompletionProvider] Line prefix: "${linePrefix}"`, 'CompletionProvider');

    // Check for version completions after @
    this.logger.debug(`[CompletionProvider] Checking for version pattern in line prefix: "${linePrefix}"`, 'CompletionProvider');
    const versionMatch = linePrefix.match(/https:\/\/[^@\s]+@(.*)$/);
    this.logger.debug(`[CompletionProvider] Version regex match result: ${versionMatch ? 'MATCHED' : 'NO MATCH'}`, 'CompletionProvider');
    if (versionMatch) {
      this.logger.debug(`[CompletionProvider] Detected version completion request after @`, 'CompletionProvider');
      return this.provideVersionCompletions(linePrefix);
    }

    // Suggest components after "component: "
    if (linePrefix.trim().endsWith('component:') || linePrefix.trim().endsWith('component: ')) {
      this.logger.debug(`[CompletionProvider] Detected component completion request`, 'CompletionProvider');
      return this.provideComponentCompletions();
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
  private async provideVersionCompletions(linePrefix: string): Promise<vscode.CompletionItem[]> {
    this.logger.debug(`[CompletionProvider] Starting version completions for: "${linePrefix}"`, 'CompletionProvider');

    // Extract the component URL before the @
    const urlMatch = linePrefix.match(/(https:\/\/[^@\s]+)@(.*)$/);
    if (!urlMatch) {
      this.logger.warn(`[CompletionProvider] Could not parse component URL from line prefix`, 'CompletionProvider');
      return [];
    }

    const componentUrlBase = urlMatch[1];
    const currentVersionInput = urlMatch[2];

    this.logger.debug(`[CompletionProvider] Component URL base: ${componentUrlBase}`, 'CompletionProvider');
    this.logger.debug(`[CompletionProvider] Current version input: "${currentVersionInput}"`, 'CompletionProvider');

    // Parse the component URL to extract GitLab instance, project path, and component/template name
    // Accepts URLs like:
    //   https://gitlab.com/components/opentofu/full-pipeline
    //   https://gitlab.instance.com/group/project/componentName
    //   https://gitlab.instance.com/group/project/templateName
    // We'll treat the last path segment as the component/template name, and the rest as the project path
    try {
      const url = new URL(componentUrlBase);
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
      // Limit to top 10 versions to avoid overwhelming the user
      const versionsToShow = filteredVersions.slice(0, 10);
      for (const version of versionsToShow) {
        const item = new vscode.CompletionItem(version, vscode.CompletionItemKind.Reference);
        item.detail = `Version ${version}`;
        item.documentation = `Use version ${version} of component ${componentName}`;
        // Set the insertion text to just the version (since we're after the @)
        item.insertText = version;
        // Add sort priority based on version type
        if (version === 'main' || version === 'master') {
          item.sortText = '0' + version; // High priority for main branches
        } else if (version.match(/^\d+\.\d+\.\d+$/)) {
          item.sortText = '1' + version; // Medium priority for semantic versions
        } else {
          item.sortText = '2' + version; // Lower priority for other versions
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
  private async provideComponentCompletions(): Promise<vscode.CompletionItem[]> {
    this.logger.debug(`[CompletionProvider] Providing component completions`, 'CompletionProvider');

    const cacheManager = getComponentCacheManager();
    const components = await cacheManager.getComponents();

    this.logger.debug(`[CompletionProvider] Found ${components.length} components in cache`, 'CompletionProvider');

    const completionItems: vscode.CompletionItem[] = [];
    const seenComponents = new Set<string>();

    for (const component of components) {
      // Create a unique key for each component to avoid duplicates
      const componentKey = `${component.name}@${component.sourcePath}@${component.gitlabInstance}`;

      if (seenComponents.has(componentKey)) {
        continue;
      }
      seenComponents.add(componentKey);

      // Get the best version to suggest
      let bestVersion = 'main';
      if (component.availableVersions && component.availableVersions.length > 0) {
        // Find the best version using priority logic
        bestVersion = this.getBestVersionForComponent(component.availableVersions, component.name);
      }

      let componentUrl = `https://${component.gitlabInstance}/${component.sourcePath}/${component.name}`;

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

      // Check user preferences for default version
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const defaultVersions = config.get<Record<string, string>>('defaultVersions', {});
      const alwaysLatest = config.get<string[]>('alwaysUseLatest', []);

      let versionToUse = bestVersion;

      if (alwaysLatest.includes(component.name)) {
        // User wants to always use latest for this component
        versionToUse = bestVersion; // bestVersion is already the latest
      } else if (defaultVersions[component.name]) {
        // User has set a specific default version for this component
        versionToUse = defaultVersions[component.name];
      }

      // For now, suggest the URL with the best version - user can change the version later
      if (componentUrl.includes('@')) {
        const urlBase = componentUrl.split('@')[0];
        componentUrl = `${urlBase}@${bestVersion}`;
      } else {
        componentUrl = `${componentUrl}@${bestVersion}`;
      }

      item.insertText = componentUrl;
      completionItems.push(item);
    }

    this.logger.debug(`[CompletionProvider] Created ${completionItems.length} component completion items`, 'CompletionProvider');
    return completionItems;
  }

  /**
   * Get the best version for a component based on priority logic
   */
  private getBestVersionForComponent(availableVersions: string[], componentName: string): string {
    if (!availableVersions || availableVersions.length === 0) {
      return 'main';
    }

    // Check user preferences first
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const defaultVersions = config.get<Record<string, string>>('defaultVersions', {});
    const alwaysLatest = config.get<string[]>('alwaysUseLatest', []);

    if (alwaysLatest.includes(componentName)) {
      // User wants always latest - find the highest semantic version or fall back to main
      const semanticVersions = availableVersions.filter(v => v.match(/^\d+\.\d+\.\d+$/));
      if (semanticVersions.length > 0) {
        // Sort semantic versions in descending order
        semanticVersions.sort((a, b) => {
          const aParts = a.split('.').map(Number);
          const bParts = b.split('.').map(Number);
          for (let i = 0; i < 3; i++) {
            if (aParts[i] !== bParts[i]) {
              return bParts[i] - aParts[i];
            }
          }
          return 0;
        });
        return semanticVersions[0];
      }
    }

    if (defaultVersions[componentName] && availableVersions.includes(defaultVersions[componentName])) {
      return defaultVersions[componentName];
    }

    // Default priority: main > master > highest semantic version > first available
    if (availableVersions.includes('main')) {
      return 'main';
    }
    if (availableVersions.includes('master')) {
      return 'master';
    }

    // Find highest semantic version
    const semanticVersions = availableVersions.filter(v => v.match(/^\d+\.\d+\.\d+$/));
    if (semanticVersions.length > 0) {
      semanticVersions.sort((a, b) => {
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if (aParts[i] !== bParts[i]) {
            return bParts[i] - aParts[i];
          }
        }
        return 0;
      });
      return semanticVersions[0];
    }

    return availableVersions[0];
  }

  private provideParameterCompletions(parameters: any[]): vscode.CompletionItem[] {
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
}
