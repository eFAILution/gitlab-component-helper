import * as vscode from 'vscode';
import { Component } from '../providers/componentDetector';
import { GitLabCatalogComponent, GitLabCatalogVariable, GitLabCatalogData } from '../types/gitlab-catalog';
import { HttpClient } from '../utils/httpClient';
import { Logger } from '../utils/logger';

// Regex patterns for parsing GitLab CI/CD component specs
const SPEC_INPUTS_SECTION_REGEX = /spec:\s*\n\s*inputs:([\s\S]*?)(?=\n---|\ndescription:|\nvariables:|\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/;

// Helper: Prompt for token if needed and store it
async function promptForTokenIfNeeded(
  context: vscode.ExtensionContext | undefined,
  service: ComponentService,
  gitlabInstance: string,
  projectPath: string
): Promise<string | undefined> {
  const tokenPrompt = `This project/group requires a GitLab personal access token for ${gitlabInstance}. Please enter one to continue.`;
  const token = await vscode.window.showInputBox({
    prompt: tokenPrompt,
    password: true,
    ignoreFocusOut: true
  });
  if (token && token.trim()) {
    if (context && context.secrets) {
      service.setSecretStorage(context.secrets);
    }
    await service.setTokenForProject(gitlabInstance, projectPath, token.trim());
    vscode.window.showInformationMessage(`Token saved for ${gitlabInstance}`);
    return token.trim();
  } else if (token === '') {
    vscode.window.showInformationMessage('No token entered. Public access will be used.');
    return undefined;
  }
  return undefined;
}


// Register the command in your extension's activation (see README for usage)
export function registerAddProjectTokenCommand(context: vscode.ExtensionContext, service: ComponentService) {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitlabComponentHelper.addProjectToken', async () => {
      // Prompt for the full GitLab URL
      const url = await vscode.window.showInputBox({
        prompt: 'Enter the full GitLab project or group URL (e.g. https://gitlab.com/mygroup/myproject)',
        ignoreFocusOut: true,
        placeHolder: 'https://gitlab.com/mygroup/myproject'
      });
      if (!url) return;

      let gitlabInstance = '';
      let projectPath = '';
      try {
        const parsed = new URL(url);
        gitlabInstance = parsed.hostname;
        // Remove leading/trailing slashes and join path
        projectPath = parsed.pathname.replace(/^\/+|\/+$/g, '');
        if (!gitlabInstance || !projectPath) throw new Error('Invalid URL');
      } catch (e) {
        vscode.window.showErrorMessage('Invalid GitLab URL. Please enter a valid project or group URL.');
        return;
      }

      // Prompt for token (optional)
      const token = await vscode.window.showInputBox({
        prompt: `Enter GitLab personal access token for ${gitlabInstance} (leave blank for public access)`,
        password: true,
        ignoreFocusOut: true
      });
      if (token === undefined) return; // User cancelled

      // Add to component sources as a proper object
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const componentSources: any[] = config.get('componentSources', []);

      // Check if this source already exists
      const existingSource = componentSources.find(source =>
        source.path === projectPath && source.gitlabInstance === gitlabInstance
      );

      let displayName: string;
      let type: 'group' | 'project';

      // Try to determine type from path
      const pathSegments = projectPath.split('/').filter(Boolean);
      if (pathSegments.length === 1) {
        type = 'group';
      } else if (pathSegments.length > 1) {
        // Ambiguous, ask user
        const typePick = await vscode.window.showQuickPick([
          { label: 'Project', value: 'project', description: 'A single GitLab project' },
          { label: 'Group', value: 'group', description: 'A GitLab group containing multiple projects' }
        ], {
          placeHolder: 'Is this a group or a project?',
          ignoreFocusOut: true
        });
        if (!typePick) return; // User cancelled
        type = typePick.value as 'group' | 'project';
      } else {
        // Fallback
        type = 'project';
      }

      if (!existingSource) {
        // Prompt for a display name
        const inputDisplayName = await vscode.window.showInputBox({
          prompt: 'Enter a display name for this component source',
          value: projectPath.split('/').pop() || projectPath,
          ignoreFocusOut: true
        });

        if (!inputDisplayName) return; // User cancelled

        displayName = inputDisplayName;

        const newSource = {
          name: displayName,
          path: projectPath,
          gitlabInstance: gitlabInstance,
          type: type
        };

        componentSources.push(newSource);
        await config.update('componentSources', componentSources, vscode.ConfigurationTarget.Global);
      } else {
        displayName = existingSource.name;
      }

      // Store the token if provided
      if (token && token.trim()) {
        try {
          if (!service['secretStorage'] && context.secrets) {
            service.setSecretStorage(context.secrets);
          }
          await service.setTokenForProject(gitlabInstance, projectPath, token.trim());
          vscode.window.showInformationMessage(`Component source "${displayName}" added successfully with token for ${gitlabInstance}!`);
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to save token: ${e}`);
        }
      } else {
        vscode.window.showInformationMessage(`Component source "${displayName}" added successfully! Public access will be used.`);
      }
    })
  );
}

interface GitLabTreeItem {
  id: string;
  name: string;
  type: string;
  path: string;
  mode: string;
}

interface ComponentVariable {
  name: string;
  description: string;
  required: boolean;
  type: string;
  default?: string;
}

export interface ComponentSource {
  getComponents(): Promise<Component[]>;
  getComponent(name: string): Promise<Component | undefined>;
}

// Enhanced cache with Map-based caching by source type
interface CacheEntry {
  components: Component[];
  timestamp: number;
}

const sourceCache = new Map<string, CacheEntry>();
let backgroundUpdateInProgress = false;

export class ComponentService implements ComponentSource {
  public httpClient = new HttpClient();
  private logger = Logger.getInstance();
  private componentCache = new Map<string, Component>();
  private catalogCache = new Map<string, any>();
  private secretStorage: vscode.SecretStorage | undefined;

  constructor() {}

  public setSecretStorage(secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
  }

  public async getTokenForProject(gitlabInstance: string, projectPath: string): Promise<string | undefined> {
    if (!this.secretStorage) {
      this.logger.debug(`No secretStorage available for ${gitlabInstance}`);
      return undefined;
    }
    const key = `gitlab-token-${gitlabInstance}`;
    this.logger.debug(`Looking for token with key: ${key}`);
    const token = await this.secretStorage.get(key);
    this.logger.debug(`Found token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`);
    return token;
  }

  public async setTokenForProject(gitlabInstance: string, projectPath: string, token: string): Promise<void> {
    if (!this.secretStorage) throw new Error('SecretStorage not available');
    const key = `gitlab-token-${gitlabInstance}`;
    this.logger.debug(`Storing token with key: ${key}`);
    await this.secretStorage.store(key, token);
    this.logger.debug(`Token stored successfully for ${gitlabInstance}`);
  }

  // Helper method to get token for any GitLab instance
  public async getTokenForInstance(gitlabInstance: string): Promise<string | undefined> {
    if (!this.secretStorage) return undefined;
    const key = `gitlab-token-${gitlabInstance}`;
    return await this.secretStorage.get(key);
  }

  async getComponents(): Promise<Component[]> {
    // Implementation for getting components
    return this.getLocalComponents();
  }

  async getComponent(name: string): Promise<Component | undefined> {
    const components = await this.getComponents();
    return components.find(c => c.name === name);
  }

  // Update getComponentFromUrl to ensure it sets the context property
  public async getComponentFromUrl(url: string, context?: vscode.ExtensionContext): Promise<Component | null> {
    try {
      // Existing code to fetch component
      const component = await this.fetchComponentMetadata(url, context);
      // Make sure context is added
      if (component) {
        // Parse the URL for context info
        const parsed = this.parseCustomComponentUrl(url);
        if (parsed) {
          component.context = {
            gitlabInstance: parsed.gitlabInstance,
            path: parsed.path
          };
        }
      }
      return component;
    } catch (error) {
      console.error(`Error fetching component from URL: ${error}`);
      throw error;
    }
  }

  private async fetchComponentMetadata(url: string, context?: vscode.ExtensionContext): Promise<Component> {
    const startTime = Date.now();

    try {
      // Parse the GitLab component URL
      const urlObj = new URL(url);
      const gitlabInstance = urlObj.hostname;

      // Extract project path, component name, and version
      const pathParts = urlObj.pathname.split('/');
      let componentName: string, version: string, projectPath: string;

      const lastPart = pathParts[pathParts.length - 1];

      if (lastPart.includes('@')) {
        [componentName, version] = lastPart.split('@');
        projectPath = pathParts.slice(1, pathParts.length - 1).join('/');
      } else {
        componentName = lastPart;
        version = 'main';
        projectPath = pathParts.slice(1, pathParts.length - 1).join('/');
      }

      this.logger.debug(`Parsed URL: Project=${projectPath}, Component=${componentName}, Version=${version}`);

      let templateContent = '';
      let readmeContent = '';
      let parameters: Array<{
        name: string;
        description: string;
        required: boolean;
        type: string;
        default?: string;
      }> = [];

      // Try GitLab CI/CD Catalog first
      try {
        const namespaceProject = projectPath;
        const catalogApiUrl = `https://${gitlabInstance}/api/v4/ci/catalog/${encodeURIComponent(namespaceProject)}`;

        // Try to get a token for catalog API as well
        let token: string | undefined = await this.getTokenForProject(gitlabInstance, projectPath);
        let catalogFetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

        this.logger.debug(`Trying to fetch from GitLab Catalog API: ${catalogApiUrl}`);
        this.logger.debug(`Using token for catalog API: ${token ? 'YES' : 'NO'}`);
        const catalogData = await this.httpClient.fetchJson(catalogApiUrl, catalogFetchOptions) as GitLabCatalogData;

        if (catalogData && catalogData.components) {
          const catalogComponent = catalogData.components.find((c: GitLabCatalogComponent) => c.name === componentName);
          if (catalogComponent) {
            this.logger.info(`Found component in catalog: ${componentName}`);

            const component = {
              name: componentName,
              description: `# ${componentName}\n\n${catalogComponent.description || ''}\n\n` +
                          `**From GitLab CI/CD Catalog**\n` +
                          `**Project:** [${projectPath}](https://${gitlabInstance}/${projectPath})\n` +
                          `**Version:** ${version}\n\n` +
                          (catalogComponent.documentation_url ?
                            `[Full Documentation](${catalogComponent.documentation_url})` : ''),
              parameters: catalogComponent.variables?.map((v: GitLabCatalogVariable) => ({
                name: v.name,
                description: v.description || `Parameter: ${v.name}`,
                required: v.required || false,
                type: v.type || 'string',
                default: v.default
              })) || [],
              version,
              source: `${gitlabInstance}/${projectPath}`,
              documentationUrl: catalogComponent.documentation_url
            };

            this.logger.logPerformance('fetchComponentMetadata (catalog)', Date.now() - startTime);
            return component;
          }
        }
      } catch (catalogError) {
        this.logger.debug(`Could not fetch from catalog: ${catalogError}`);
      }

      // Fall back to API + repository approach with parallel requests
      const encodedProjectPath = encodeURIComponent(projectPath);
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
      const projectApiUrl = `${apiBaseUrl}/projects/${encodedProjectPath}`;

      this.logger.debug(`Fetching project info from: ${projectApiUrl}`);

      // Try to get a token for this project/instance
      let token: string | undefined = await this.getTokenForProject(gitlabInstance, projectPath);
      let fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      this.logger.debug(`Using token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`);

      // **PARALLEL FETCHING OPTIMIZATION** - Fetch project info, template, and README in parallel
      let projectInfo: any, templateResult: any, readmeResult: any;
      try {
        [projectInfo, templateResult, readmeResult] = await Promise.allSettled([
          this.httpClient.fetchJson(projectApiUrl, fetchOptions),
          this.fetchTemplate(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions),
          this.fetchReadme(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions)
        ]);
      } catch (err: any) {
        if (err && (err.status === 401 || err.status === 403)) {
          // Prompt for token and retry
          token = await promptForTokenIfNeeded(context, this, gitlabInstance, projectPath);
          if (token) {
            fetchOptions = { headers: { 'PRIVATE-TOKEN': token } };
            [projectInfo, templateResult, readmeResult] = await Promise.allSettled([
              this.httpClient.fetchJson(projectApiUrl, fetchOptions),
              this.fetchTemplate(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions),
              this.fetchReadme(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions)
            ]);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      if (projectInfo.status === 'rejected') {
        throw new Error(`Failed to fetch project info: ${projectInfo.reason}`);
      }

      const project = projectInfo.value;

      // Process template result
      if (templateResult.status === 'fulfilled' && templateResult.value) {
        const { content, parameters: extractedParams } = templateResult.value;
        templateContent = content;
        parameters = extractedParams;
        this.logger.debug(`Found component template with ${parameters.length} parameters`);
      }

      // Process README result
      if (readmeResult.status === 'fulfilled' && readmeResult.value) {
        readmeContent = readmeResult.value;
      }

      // Construct the component
      const component: Component = {
        name: componentName,
        description:
          `# ${componentName}\n\n` +
          `${project.description || 'GitLab Component'}\n\n` +
          `**Project:** [${projectPath}](${project.web_url})\n` +
          `**Version:** ${version}\n\n` +
          (readmeContent ? `## Documentation\n${readmeContent.substring(0, 800)}...\n\n` : '') +
          (templateContent ? `## Template Preview\n\`\`\`yaml\n${templateContent.substring(0, 300)}...\n\`\`\`` : ''),
        parameters,
        version,
        source: `${gitlabInstance}/${projectPath}`
      };

      this.logger.logPerformance('fetchComponentMetadata (full)', Date.now() - startTime, {
        hasTemplate: !!templateContent,
        hasReadme: !!readmeContent,
        paramCount: parameters.length
      });

      return component;
    } catch (error) {
      this.logger.error(`Error fetching component metadata: ${error}`);

      // Still provide a minimal component rather than failing
      const urlParts = url.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      const componentName = lastPart.includes('@') ? lastPart.split('@')[0] : lastPart;

      return {
        name: componentName,
        description: `Component from ${url}\n\nCould not fetch detailed information: ${error}`,
        parameters: []
      };
    }
  }

  // Helper method for parallel template fetching
  private async fetchTemplate(apiBaseUrl: string, projectId: string, componentName: string, version: string, fetchOptions?: any): Promise<{ content: string; parameters: any[] } | null> {
    try {
      const templatePath = `templates/${componentName}.yml`;
      const templateUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(templatePath)}/raw?ref=${version}`;

      const templateContent = await this.httpClient.fetchText(templateUrl, fetchOptions);

      // Extract variables/parameters from the template
      let parameters: any[] = [];
      const variableMatches = templateContent.match(/variables:[\s\S]*?(?=\n\w+:|$)/g);
      if (variableMatches && variableMatches.length > 0) {
        const variableSection = variableMatches[0];
        const varLines = variableSection.split('\n').slice(1);

        parameters = varLines
          .filter(line => line.trim() && line.includes(':'))
          .map(line => {
            const parts = line.trim().split(':');
            const name = parts[0].trim();
            const defaultValue = parts.slice(1).join(':').trim();

            return {
              name,
              description: `Parameter: ${name}`,
              required: false,
              type: 'string',
              default: defaultValue
            };
          });
      }

      return { content: templateContent, parameters };
    } catch (error) {
      this.logger.debug(`Could not fetch component template: ${error}`);
      return null;
    }
  }

  // Helper method for parallel README fetching
  private async fetchReadme(apiBaseUrl: string, projectId: string, componentName: string, version: string, fetchOptions?: any): Promise<string | null> {
    try {
      // First check if there's a component-specific README
      const componentReadmePath = `docs/${componentName}/README.md`;
      try {
        const readmeUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(componentReadmePath)}/raw?ref=${version}`;
        return await this.httpClient.fetchText(readmeUrl, fetchOptions);
      } catch (e) {
        // Then try the project README
        const projectReadmeUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/README.md/raw?ref=${version}`;
        return await this.httpClient.fetchText(projectReadmeUrl, fetchOptions);
      }
    } catch (error) {
      this.logger.debug(`Could not fetch README: ${error}`);
      return null;
    }
  }

  // Helper methods for HTTP requests - now using HttpClient
  public async fetchJson(url: string, options?: any): Promise<any> {
    return this.httpClient.fetchJson(url, options);
  }

  private async fetchText(url: string): Promise<string> {
    return this.httpClient.fetchText(url);
  }

  private getLocalComponents(): Component[] {
    // Return the mock components as fallback
    return [
      {
        name: 'deploy-component',
        description: 'Deploys the application to the specified environment',
        parameters: [
          {
            name: 'environment',
            description: 'Target environment for deployment',
            required: true,
            type: 'string'
          },
          {
            name: 'version',
            description: 'Version to deploy',
            required: false,
            type: 'string',
            default: 'latest'
          }
        ]
      },
      {
        name: 'test-component',
        description: 'Runs tests for the application',
        parameters: [
          {
            name: 'test_type',
            description: 'Type of tests to run',
            required: true,
            type: 'string'
          },
          {
            name: 'coverage',
            description: 'Whether to collect coverage information',
            required: false,
            type: 'boolean',
            default: false
          }
        ]
      }
    ];
  }

  private async fetchFromGitLab(): Promise<Component[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const gitlabUrl = config.get<string>('gitlabUrl', '');
    const projectId = config.get<string>('gitlabProjectId', '');
    const token = config.get<string>('gitlabToken', '');
    const filePath = config.get<string>('gitlabComponentsFilePath', 'components.json');

    if (!gitlabUrl || !projectId || !token) {
      throw new Error('GitLab URL, project ID, or token not configured');
    }

    const apiUrl = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw`;

    try {
      const components = await this.httpClient.fetchJson(apiUrl, {
        headers: {
          'PRIVATE-TOKEN': token
        }
      });

      this.logger.info(`Successfully fetched ${components.length} components from GitLab`);
      return components;
    } catch (error) {
      this.logger.error(`GitLab fetch failed: ${error}`);
      throw error;
    }
  }

  private async fetchFromUrl(): Promise<Component[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const url = config.get<string>('componentsUrl', '');

    if (!url) {
      throw new Error('Components URL not configured');
    }

    try {
      const components = await this.httpClient.fetchJson(url);
      this.logger.info(`Successfully fetched ${components.length} components from URL`);
      return components;
    } catch (error) {
      this.logger.error(`URL fetch failed: ${error}`);
      throw error;
    }
  }

  /**
   * Fetch component catalog data from GitLab with optimizations
   */
  async fetchCatalogData(gitlabInstance: string, projectPath: string, forceRefresh: boolean = false, version?: string, context?: vscode.ExtensionContext): Promise<any> {
    const startTime = Date.now();
    const versionSuffix = version ? `@${version}` : '';
    const cacheKey = `catalog:${gitlabInstance}:${projectPath}${versionSuffix}`;

    this.logger.info(`fetchCatalogData called for ${gitlabInstance}/${projectPath}${versionSuffix}`);
    this.logger.debug(`Force refresh: ${forceRefresh}`);

    // Clean up GitLab instance URL if it contains protocol
    let cleanGitlabInstance = gitlabInstance;
    if (cleanGitlabInstance.startsWith('https://')) {
      cleanGitlabInstance = cleanGitlabInstance.replace('https://', '');
    }
    if (cleanGitlabInstance.startsWith('http://')) {
      cleanGitlabInstance = cleanGitlabInstance.replace('http://', '');
    }

    // Check cache first
    if (!forceRefresh && this.catalogCache.has(cacheKey)) {
      this.logger.info(`Returning cached catalog data for ${cacheKey}`);
      this.logger.logPerformance('fetchCatalogData (cached)', Date.now() - startTime);
      return this.catalogCache.get(cacheKey);
    }

    this.logger.info(`Fetching fresh catalog data from ${cleanGitlabInstance}`);

    try {
      // **PARALLEL OPTIMIZATION** - Fetch project info and templates in parallel
      const apiBaseUrl = `https://${cleanGitlabInstance}/api/v4`;
      let ref = version || 'main';
      let token: string | undefined = await this.getTokenForProject(cleanGitlabInstance, projectPath);
      let fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;
      let projectInfo: any, templates: any;
      try {
        [projectInfo, templates] = await Promise.all([
          this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`, fetchOptions),
          this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=templates&ref=${ref}`, fetchOptions)
            .catch(() => [] as GitLabTreeItem[])
        ]);
      } catch (err: any) {
        if (err && (err.status === 401 || err.status === 403)) {
          // Prompt for token and retry
          token = await promptForTokenIfNeeded(context, this, cleanGitlabInstance, projectPath);
          if (token) {
            fetchOptions = { headers: { 'PRIVATE-TOKEN': token } };
            [projectInfo, templates] = await Promise.all([
              this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`, fetchOptions),
              this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=templates&ref=${ref}`, fetchOptions)
                .catch(() => [] as GitLabTreeItem[])
            ]);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      // --- Use the project's default branch if available ---
      if (projectInfo && projectInfo.default_branch) {
        ref = projectInfo.default_branch;
      }
      this.logger.debug(`Found project: ${projectInfo.name} (ID: ${projectInfo.id}), using ref: ${ref}`);
      // Re-fetch templates with correct ref if needed
      templates = await this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=templates&ref=${ref}`, fetchOptions)
        .catch(() => [] as GitLabTreeItem[]);

      // Filter YAML files
      const yamlFiles = templates.filter((file: GitLabTreeItem) =>
        file.name.endsWith('.yml') || file.name.endsWith('.yaml')
      );
      this.logger.debug(`Found ${yamlFiles.length} YAML template files`);
      if (yamlFiles.length === 0) {
        this.logger.info(`No YAML templates found in ${projectPath}`);
        const catalogData = { components: [] };
        this.catalogCache.set(cacheKey, catalogData);
        return catalogData;
      }
      // **BATCH PROCESSING OPTIMIZATION** - Process components in batches
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const batchSize = config.get<number>('batchSize', 5);
      const components = await this.httpClient.processBatch(
        yamlFiles,
        async (file: GitLabTreeItem) => {
          const name = file.name.replace(/\.ya?ml$/, '');
          this.logger.debug(`Processing component: ${name} (${file.name})`);
          // **PARALLEL CONTENT FETCHING** - Fetch template content and README in parallel
          const [templateResult, readmeResult] = await Promise.allSettled([
            this.fetchTemplateContent(apiBaseUrl, projectInfo.id, file.name, ref, fetchOptions),
            this.fetchProjectReadme(apiBaseUrl, projectInfo.id, ref, fetchOptions)
          ]);
          let description = '';
          let variables: ComponentVariable[] = [];
          let readmeContent = '';
          // Process template content
          if (templateResult.status === 'fulfilled' && templateResult.value) {
            const { content, extractedVariables, extractedDescription } = templateResult.value;
            variables = extractedVariables;
            description = extractedDescription || `${name} component`;
          } else {
            description = `${name} component`;
          }
          // Process README content
          if (readmeResult.status === 'fulfilled' && readmeResult.value) {
            readmeContent = readmeResult.value;
            // Extract description from README if not found in template
            if (!description || description === `${name} component`) {
              const readmeLines = readmeContent.split('\n').filter(line => line.trim());
              for (const line of readmeLines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('[') && trimmed.length > 20) {
                  description = trimmed;
                  break;
                }
              }
            }
          }
          return {
            name,
            description,
            variables,
            latest_version: ref,
            readme: readmeContent
          };
        },
        batchSize
      );
      const catalogData = { components };
      // Cache the result
      this.catalogCache.set(cacheKey, catalogData);
      this.logger.info(`Successfully processed ${components.length} components`);
      this.logger.logPerformance('fetchCatalogData (fresh)', Date.now() - startTime, {
        componentCount: components.length,
        batchSize,
        projectPath
      });
      return catalogData;
    } catch (error) {
      this.logger.error(`Error fetching catalog data for ${projectPath}: ${error}`);
      throw error;
    }
  }

  // Helper method for parallel template content fetching
  private async fetchTemplateContent(apiBaseUrl: string, projectId: string, fileName: string, ref: string, fetchOptions?: any): Promise<{
    content: string;
    extractedVariables: ComponentVariable[];
    extractedDescription?: string;
  } | null> {
    try {
      const contentUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent('templates/' + fileName)}/raw?ref=${ref}`;
      const content = await this.httpClient.fetchText(contentUrl, fetchOptions);

      let extractedDescription = '';
      let extractedVariables: ComponentVariable[] = [];

      // Split content by the GitLab component spec separator '---'
      // Everything before '---' is the spec section, everything after is the CI/CD job definitions
      const parts = content.split(/^---\s*$/m);
      const specSection = parts[0] || '';

      this.logger.debug(`[ComponentService] Template ${fileName}: Found ${parts.length} sections (spec + jobs)`);
      this.logger.debug(`[ComponentService] Template ${fileName}: Spec section length: ${specSection.length} chars`);

      // Extract description from component spec
      const specDescMatch = specSection.match(/spec:\s*\n(?:\s*inputs:[\s\S]*?)?\n\s*description:\s*["']?(.*?)["']?\s*$/m);
      if (specDescMatch) {
        extractedDescription = specDescMatch[1].trim();
        this.logger.debug(`[ComponentService] Template ${fileName}: Found spec description: ${extractedDescription}`);
      }

      // If no spec description, try comment at top of file
      if (!extractedDescription) {
        const commentMatch = specSection.match(/^#\s*(.+?)$/m);
        if (commentMatch && !commentMatch[1].toLowerCase().includes('gitlab') && !commentMatch[1].toLowerCase().includes('ci')) {
          extractedDescription = commentMatch[1].trim();
          this.logger.debug(`[ComponentService] Template ${fileName}: Found comment description: ${extractedDescription}`);
        }
      }

      // Extract variables from GitLab CI/CD component spec format - ONLY from spec section
      const specMatches = specSection.match(SPEC_INPUTS_SECTION_REGEX);
      if (specMatches) {
        this.logger.debug(`[ComponentService] Template ${fileName}: Found spec inputs section`);

        // Parse component spec format
        const inputsSection = specMatches[1];
        const inputLines = inputsSection.split('\n')
          .filter(line => line.trim() && !line.trim().startsWith('#'));

        let currentInput: any = null;

        for (const line of inputLines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Stop if we hit a top-level key (indicating we've left the inputs section)
          if (line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/)) {
            this.logger.debug(`[ComponentService] Template ${fileName}: Stopping at top-level key: ${trimmedLine}`);
            break;
          }

          // New input parameter (indented under inputs)
          if (line.match(/^\s{4}[a-zA-Z_][a-zA-Z0-9_]*:/) || line.match(/^\s{2}[a-zA-Z_][a-zA-Z0-9_]*:/)) {
            if (currentInput) {
              extractedVariables.push(currentInput);
            }
            const inputName = trimmedLine.split(':')[0];
            currentInput = {
              name: inputName,
              description: `Parameter: ${inputName}`,
              required: false,
              type: 'string',
              default: undefined
            };
            this.logger.debug(`[ComponentService] Template ${fileName}: Found input parameter: ${inputName}`);
          }
          // Property of current input (more deeply indented)
          else if (currentInput && line.match(/^\s{6,}/)) {
            if (trimmedLine.startsWith('description:')) {
              currentInput.description = trimmedLine.substring(12).replace(/['"]/g, '').trim();
            } else if (trimmedLine.startsWith('default:')) {
              currentInput.default = trimmedLine.substring(8).replace(/['"]/g, '').trim();
            } else if (trimmedLine.startsWith('type:')) {
              currentInput.type = trimmedLine.substring(5).replace(/['"]/g, '').trim();
            }
          }
        }

        // Add the last input
        if (currentInput) {
          extractedVariables.push(currentInput);
        }

        this.logger.debug(`[ComponentService] Template ${fileName}: Extracted ${extractedVariables.length} input parameters from spec`);
      } else {
        this.logger.debug(`[ComponentService] Template ${fileName}: No spec inputs found, trying fallback parsing`);

        // Fallback to old format for backward compatibility - also only in spec section
        // Look for variables section that's ONLY within the spec section
        const variableMatches = specSection.match(/spec:\s*[\s\S]*?variables:([\s\S]*?)(?=\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/);
        if (variableMatches) {
          const variableSection = variableMatches[1];
          const varLines = variableSection.split('\n').slice(0); // Don't skip first line since we captured just the content

          extractedVariables = varLines
            .filter(line => {
              const trimmed = line.trim();
              // Only include properly indented variable definitions
              return trimmed &&
                     line.match(/^\s{2,}/) && // Must be indented
                     trimmed.includes(':') &&
                     !trimmed.startsWith('#') &&
                     !line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/); // Not a top-level key
            })
            .map(line => {
              const parts = line.trim().split(':');
              const varName = parts[0].trim();
              const defaultValue = parts.slice(1).join(':').trim();

              return {
                name: varName,
                description: `Parameter: ${varName}`,
                required: false,
                type: 'string',
                default: defaultValue || undefined
              };
            });

          this.logger.debug(`[ComponentService] Template ${fileName}: Extracted ${extractedVariables.length} variables from fallback parsing`);
        } else {
          this.logger.debug(`[ComponentService] Template ${fileName}: No variables found in fallback parsing`);
        }
      }

      return { content, extractedVariables, extractedDescription };
    } catch (error) {
      this.logger.debug(`Could not fetch template content: ${error}`);
      return null;
    }
  }

  // Helper method for parallel README fetching
  private async fetchProjectReadme(apiBaseUrl: string, projectId: string, ref: string, fetchOptions?: any): Promise<string | null> {
    try {
      const readmeUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/README.md/raw?ref=${ref}`;
      return await this.httpClient.fetchText(readmeUrl, fetchOptions);
    } catch (error) {
      this.logger.debug(`No README found: ${error}`);
      return null;
    }
  }

  /**
   * Fetch all tags/versions for a GitLab project with optimizations
   */
  public async fetchProjectVersions(gitlabInstance: string, projectPath: string): Promise<string[]> {
    const startTime = Date.now();

    try {
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
      const encodedPath = encodeURIComponent(projectPath);

      this.logger.info(`Fetching versions for ${gitlabInstance}/${projectPath}`);

      // Try to get a token for this project/instance
      let token: string | undefined = await this.getTokenForProject(gitlabInstance, projectPath);
      let fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      this.logger.debug(`Using token for versions fetch: ${token ? 'YES' : 'NO'}`);

      // First, get project info to get the project ID
      const projectInfo = await this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodedPath}`, fetchOptions);

      if (!projectInfo || !projectInfo.id) {
        this.logger.warn(`Could not get project info for ${projectPath}`);
        return ['main']; // Fallback to main branch
      }

      // **PARALLEL OPTIMIZATION** - Fetch tags and branches in parallel
      const [tagsResult, branchesResult] = await Promise.allSettled([
        this.httpClient.fetchJson(`${apiBaseUrl}/projects/${projectInfo.id}/repository/tags?per_page=100&sort=desc`, fetchOptions),
        this.httpClient.fetchJson(`${apiBaseUrl}/projects/${projectInfo.id}/repository/branches?per_page=20`, fetchOptions)
      ]);

      const versions: string[] = [];

      // Process tags
      if (tagsResult.status === 'fulfilled' && Array.isArray(tagsResult.value)) {
        const tagVersions = tagsResult.value.map((tag: any) => tag.name).filter((name: string) => name);
        versions.push(...tagVersions);
        this.logger.debug(`Found ${tagVersions.length} tags`);
      } else {
        this.logger.warn(`Error fetching tags: ${tagsResult.status === 'rejected' ? tagsResult.reason : 'Unknown error'}`);
      }

      // Process branches
      if (branchesResult.status === 'fulfilled' && Array.isArray(branchesResult.value)) {
        const importantBranches = branchesResult.value
          .map((branch: any) => branch.name)
          .filter((name: string) => ['main', 'master', 'develop', 'dev'].includes(name));
        versions.push(...importantBranches);
        this.logger.debug(`Found ${importantBranches.length} important branches`);
      } else {
        this.logger.warn(`Error fetching branches: ${branchesResult.status === 'rejected' ? branchesResult.reason : 'Unknown error'}`);
      }

      // Remove duplicates and sort
      const uniqueVersions = Array.from(new Set(versions));

      // Sort versions with semantic versions first, then branches
      const sortedVersions = uniqueVersions.sort((a, b) => {
        // Put main/master branches at the end
        if (a === 'main' || a === 'master') return 1;
        if (b === 'main' || b === 'master') return -1;

        // Semantic version sorting
        const aMatch = a.match(/^v?(\d+)\.(\d+)\.(\d+)/);
        const bMatch = b.match(/^v?(\d+)\.(\d+)\.(\d+)/);

        if (aMatch && bMatch) {
          const aMajor = parseInt(aMatch[1]);
          const bMajor = parseInt(bMatch[1]);
          if (aMajor !== bMajor) return bMajor - aMajor; // Descending

          const aMinor = parseInt(aMatch[2]);
          const bMinor = parseInt(bMatch[2]);
          if (aMinor !== bMinor) return bMinor - aMinor;

          const aPatch = parseInt(aMatch[3]);
          const bPatch = parseInt(bMatch[3]);
          return bPatch - aPatch;
        }

        // Put semantic versions before non-semantic ones
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;

        // Alphabetical for non-semantic versions
        return b.localeCompare(a);
      });

      const result = sortedVersions.length > 0 ? sortedVersions : ['main'];

      this.logger.info(`Returning ${result.length} versions: ${result.slice(0, 5).join(', ')}${result.length > 5 ? '...' : ''}`);
      this.logger.logPerformance('fetchProjectVersions', Date.now() - startTime, {
        projectPath,
        versionCount: result.length
      });

      return result;

    } catch (error) {
      this.logger.error(`Error fetching project versions: ${error}`);
      return ['main']; // Fallback
    }
  }

  /**
   * Fetch all tags/versions for a GitLab project (optimized version)
   */
  public async fetchProjectTags(gitlabInstance: string, projectPath: string): Promise<Array<{name: string, commit: any}>> {
    const startTime = Date.now();
    this.logger.info(`Fetching tags for ${gitlabInstance}/${projectPath}`);

    try {
      const apiUrl = `https://${gitlabInstance}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/tags?per_page=100&order_by=updated&sort=desc`;
      // Try to get a token for this project/group/instance
      const token = await this.getTokenForProject(gitlabInstance, projectPath);
      const options = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;
      const tags = await this.httpClient.fetchJson(apiUrl, options);

      this.logger.info(`Found ${tags.length} tags for ${projectPath}`);
      this.logger.logPerformance('fetchProjectTags', Date.now() - startTime, {
        projectPath,
        tagCount: tags.length
      });

      return tags;
    } catch (error) {
      this.logger.warn(`Error fetching tags: ${error}`);
      return []; // Return empty array instead of rejecting
    }
  }

  // Add this method to your ComponentService class
  public parseCustomComponentUrl(url: string): { gitlabInstance: string; path: string; name: string; version?: string } | null {
    try {
      // Handle URLs like: https://gitlab.com/components/proj/proj-template@1.0.0
      const urlObj = new URL(url);
      const gitlabInstance = urlObj.hostname;

      const pathParts = urlObj.pathname.split('/');
      if (pathParts.length < 3) {
        return null;
      }

      // The last part contains the component name and version
      const lastPart = pathParts[pathParts.length - 1];
      let name, version;

      if (lastPart.includes('@')) {
        // Split component name and version
        [name, version] = lastPart.split('@');
      } else {
        name = lastPart;
      }

      // Extract the path (everything except the last part)
      const path = pathParts.slice(1, pathParts.length - 1).join('/');

      console.log(`Parsed component URL: ${gitlabInstance}/${path}/${name}${version ? `@${version}` : ''}`);

      return { gitlabInstance, path, name, version };
    } catch (e) {
      console.error(`Error parsing component URL: ${e}`);
      return null;
    }
  }

  /**
   * Update cache - Forces refresh of all cached data by bypassing cache checks
   */
  public updateCache(): void {
    this.logger.info('[ComponentService] Updating cache - forcing refresh of all data');
    // Clear catalog cache to force fresh fetch on next request
    this.catalogCache.clear();
    // Clear component cache to force fresh fetch
    this.componentCache.clear();
    // Clear the sourceCache as well
    sourceCache.clear();
    this.logger.info('[ComponentService] Cache update completed - all cached data will be refreshed on next request');
  }

  /**
   * Reset cache - Completely clears all cached data
   */
  public resetCache(): void {
    this.logger.info('[ComponentService] Resetting cache - clearing all cached data');
    // Clear all caches
    this.catalogCache.clear();
    this.componentCache.clear();
    sourceCache.clear();
    this.logger.info('[ComponentService] Cache reset completed - all cached data cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): {
    catalogCacheSize: number;
    componentCacheSize: number;
    sourceCacheSize: number;
    catalogKeys: string[];
    componentKeys: string[];
    sourceKeys: string[];
  } {
    return {
      catalogCacheSize: this.catalogCache.size,
      componentCacheSize: this.componentCache.size,
      sourceCacheSize: sourceCache.size,
      catalogKeys: Array.from(this.catalogCache.keys()),
      componentKeys: Array.from(this.componentCache.keys()),
      sourceKeys: Array.from(sourceCache.keys())
    };
  }
}

// Singleton instance
let serviceInstance: ComponentService | null = null;

export function getComponentService(): ComponentService {
  if (!serviceInstance) {
    serviceInstance = new ComponentService();
  }
  return serviceInstance;
}
