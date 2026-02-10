import * as vscode from 'vscode';
import { getComponentUnderCursor } from './componentDetector';
import { getComponentService } from '../services/component';
import { GitLabCatalogComponent, GitLabCatalogVariable } from '../types/gitlab-catalog';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
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

    // Check for component input completions first (highest priority)
    const inputCompletions = await this.provideComponentInputCompletions(document, position);
    if (inputCompletions && inputCompletions.length > 0) {
      this.logger.debug(`[CompletionProvider] Providing ${inputCompletions.length} component input completions`, 'CompletionProvider');
      return inputCompletions;
    }

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

  // Enhanced method to detect if we're in a component inputs section and provide input completions
  private async provideComponentInputCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | null> {
    try {
      const text = document.getText();
      const { parseYaml } = await import('../utils/yamlParser');
      const parsedYaml = parseYaml(text);

      if (!parsedYaml || !parsedYaml.include) {
        return null;
      }

      const includes = Array.isArray(parsedYaml.include) ? parsedYaml.include : [parsedYaml.include];
      const currentLineIndex = position.line;
      const lines = text.split('\n');

      this.logger.debug(`[CompletionProvider] Found ${includes.length} components in YAML at line ${currentLineIndex + 1}`, 'CompletionProvider');

      // Find which component the cursor is actually within by finding the closest component above the cursor
      let closestComponent = null;
      let closestDistance = Infinity;

      // Find which component's inputs section we're in
      for (const include of includes) {
        if (!include.component) continue;

        // Find the component in the document text
        const componentUrl = include.component;

        // Look for this component's position in the file
        let componentLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('component:') && lines[i].includes(componentUrl)) {
            componentLineIndex = i;
            break;
          }
        }

        if (componentLineIndex === -1) continue;

        // Check if this component is above the cursor and closer than any previous component
        if (componentLineIndex < currentLineIndex) {
          const distance = currentLineIndex - componentLineIndex;
          if (distance < closestDistance) {
            closestDistance = distance;
            closestComponent = { include, componentLineIndex, componentUrl };
          }
        }
      }

      if (!closestComponent) {
        this.logger.debug(`[CompletionProvider] No component found above cursor position`, 'CompletionProvider');
        return null;
      }

      this.logger.debug(`[CompletionProvider] Found closest component at line ${closestComponent.componentLineIndex + 1}: ${closestComponent.componentUrl}`, 'CompletionProvider');

      // Now check if we're in the inputs section of the closest component
      const include = closestComponent.include;
      const componentUrl = closestComponent.componentUrl;
      const componentLineIndex = closestComponent.componentLineIndex;

      // Check if we're in the inputs section of this component
      let inputsSectionStart = -1;
      let inputsSectionEnd = -1;

      // Look for inputs: after the component line
      for (let i = componentLineIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // If we find a new component or job, stop looking
        if (trimmedLine.startsWith('- ') || (trimmedLine.includes(':') && !line.startsWith('  '))) {
          inputsSectionEnd = i;
          break;
        }

        // If we find inputs:, mark the start
        if (trimmedLine === 'inputs:') {
          inputsSectionStart = i;
          continue;
        }
      }

      // If we didn't find an explicit end, assume it goes to the end of the component
      if (inputsSectionStart !== -1 && inputsSectionEnd === -1) {
        inputsSectionEnd = lines.length;
      }

      this.logger.debug(`[CompletionProvider] Component ${componentUrl}: inputs section from line ${inputsSectionStart + 1} to ${inputsSectionEnd}`, 'CompletionProvider');

      // Check if current position is in the inputs section
      if (inputsSectionStart !== -1 &&
          currentLineIndex > inputsSectionStart &&
          currentLineIndex < inputsSectionEnd) {

        this.logger.debug(`[CompletionProvider] Found inputs section context for component: ${componentUrl}`, 'CompletionProvider');

        // Check if we're on a line that looks like it's starting a parameter
        const currentLine = lines[currentLineIndex];
        const currentLineText = currentLine.trim();

        // Only provide completions if:
        // 1. Line is empty or only has whitespace and partial parameter name
        // 2. Line starts with proper indentation for parameters (6+ spaces)
        // 3. We're not in the middle of a value assignment
        const lineIndent = currentLine.length - currentLine.trimStart().length;
        const isParameterContext = lineIndent >= 6 &&
          (!currentLineText.includes(':') || currentLineText.endsWith(':'));

        if (!isParameterContext) {
          this.logger.debug(`[CompletionProvider] Not in parameter name context (line: "${currentLineText}")`, 'CompletionProvider');
          return null;
        }

        // Get the component details from cache - need exact match for the specific template
        this.logger.debug(`[CompletionProvider] Looking up component in cache: ${componentUrl}`, 'CompletionProvider');
        const component = await this.findComponentInCache(componentUrl);
        if (!component || !component.parameters) {
          this.logger.debug(`[CompletionProvider] Component not found in cache or has no parameters: ${componentUrl}`, 'CompletionProvider');
          return null;
        }

        this.logger.debug(`[CompletionProvider] Found component ${component.name} with ${component.parameters.length} parameters`, 'CompletionProvider');

        // Get existing inputs
        const existingInputs = include.inputs || {};

        this.logger.debug(`[CompletionProvider] Component ${component.name} has ${component.parameters.length} total parameters`, 'CompletionProvider');
        this.logger.debug(`[CompletionProvider] Existing inputs: ${Object.keys(existingInputs).join(', ') || 'none'}`, 'CompletionProvider');

        // Filter out already provided inputs
        const missingInputs = component.parameters.filter((param: any) =>
          !existingInputs.hasOwnProperty(param.name)
        );

        this.logger.debug(`[CompletionProvider] Found ${missingInputs.length} missing inputs for completion: ${missingInputs.map((p: any) => p.name).join(', ')}`, 'CompletionProvider');

        // Create completion items for missing inputs
        return missingInputs.map((param: any) => {
          const item = new vscode.CompletionItem(param.name, vscode.CompletionItemKind.Property);

          // Enhanced documentation
          let documentation = `**${param.name}** (${param.required ? 'required' : 'optional'})\n\n`;
          documentation += `${param.description || 'No description available'}\n\n`;
          documentation += `**Type:** ${param.type || 'string'}\n`;
          if (param.default !== undefined) {
            documentation += `**Default:** \`${param.default}\`\n`;
          }

          item.documentation = new vscode.MarkdownString(documentation);

          // Smart insert text based on parameter type and default value
          let insertValue = '';
          if (param.default !== undefined) {
            if (typeof param.default === 'string') {
              insertValue = `"${param.default}"`;
            } else {
              insertValue = String(param.default);
            }
          } else {
            // Provide type-appropriate placeholders with better snippets
            switch (param.type) {
              case 'boolean':
                insertValue = param.required ? '${1|true,false|}' : '${1|false,true|}';
                break;
              case 'number':
                insertValue = param.required ? '${1:0}' : '${1:0}';
                break;
              case 'integer':
                insertValue = param.required ? '${1:1}' : '${1:0}';
                break;
              case 'array':
                insertValue = '${1:[]}';
                break;
              case 'object':
                insertValue = '${1:{}}';
                break;
              default:
                // Check if there are enum values
                if (param.enum && Array.isArray(param.enum)) {
                  const enumValues = param.enum.map((val: any) => `"${val}"`).join(',');
                  insertValue = `\${1|${enumValues}|}`;
                } else {
                  insertValue = param.required ? '${1:"TODO: set value"}' : '${1:""}';
                }
            }
          }

          item.insertText = new vscode.SnippetString(`${param.name}: ${insertValue}`);

          // Add sorting priority (required params first)
          item.sortText = param.required ? `0${param.name}` : `1${param.name}`;

          // Add detail showing requirement status
          item.detail = `${param.type || 'string'} ${param.required ? '(required)' : '(optional)'}`;

          return item;
        });
      }

      return null;
    } catch (error) {
      this.logger.error(`[CompletionProvider] Error in provideComponentInputCompletions: ${error}`, 'CompletionProvider');
      return null;
    }
  }

  // Helper method to find component in cache (similar to validation provider)
  private async findComponentInCache(componentUrl: string): Promise<any | null> {
    try {
      const cacheManager = getComponentCacheManager();
      const components = await cacheManager.getComponents();

      // Parse the component URL to get instance, project path, and component name
      const url = new URL(componentUrl.split('@')[0]); // Remove version if present
      const gitlabInstance = url.host;
      const pathSegments = url.pathname.split('/').filter(Boolean);

      if (pathSegments.length < 2) {
        this.logger.warn(`[CompletionProvider] Invalid component URL format: ${componentUrl}`, 'CompletionProvider');
        return null;
      }

      // For OpenTofu-style projects with multiple components, the last segment is the component name
      // For single-component projects, we still need the last segment as component name
      const componentName = pathSegments[pathSegments.length - 1];
      const projectPath = pathSegments.slice(0, -1).join('/');

      this.logger.debug(`[CompletionProvider] Looking for component: ${componentName} in project: ${projectPath} on ${gitlabInstance}`, 'CompletionProvider');

      // Find exact match for this specific component template
      const matchingComponent = components.find(comp =>
        comp.gitlabInstance === gitlabInstance &&
        comp.sourcePath === projectPath &&
        comp.name === componentName
      );

      if (matchingComponent) {
        this.logger.debug(`[CompletionProvider] Found exact component match: ${matchingComponent.name}`, 'CompletionProvider');
        return matchingComponent;
      }

      // If no exact match, log what we have available for debugging
      const projectComponents = components.filter(comp =>
        comp.gitlabInstance === gitlabInstance &&
        comp.sourcePath === projectPath
      );

      this.logger.debug(`[CompletionProvider] No exact match found. Available components in project: ${projectComponents.map(c => c.name).join(', ')}`, 'CompletionProvider');

      return null;
    } catch (error) {
      this.logger.error(`[CompletionProvider] Error finding component in cache: ${error}`, 'CompletionProvider');
      return null;
    }
  }
}
