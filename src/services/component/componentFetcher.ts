import * as vscode from 'vscode';
import { Component } from '../../providers/componentDetector';
import {
  GitLabCatalogComponent,
  GitLabCatalogVariable,
  GitLabCatalogData
} from '../../types/gitlab-catalog';
import { HttpClient } from '../../utils/httpClient';
import { Logger } from '../../utils/logger';
import { GitLabSpecParser, ComponentVariable } from '../../parsers/specParser';
import { TokenManager } from './tokenManager';
import { UrlParser } from './urlParser';

interface GitLabTreeItem {
  id: string;
  name: string;
  type: string;
  path: string;
  mode: string;
}

/**
 * Helper function to prompt user for token if needed
 */
async function promptForTokenIfNeeded(
  context: vscode.ExtensionContext | undefined,
  tokenManager: TokenManager,
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
    await tokenManager.setTokenForProject(gitlabInstance, projectPath, token.trim());
    vscode.window.showInformationMessage(`Token saved for ${gitlabInstance}`);
    return token.trim();
  } else if (token === '') {
    vscode.window.showInformationMessage('No token entered. Public access will be used.');
    return undefined;
  }
  return undefined;
}

/**
 * Handles fetching component metadata and catalog data from GitLab
 */
export class ComponentFetcher {
  private logger = Logger.getInstance();
  private httpClient: HttpClient;
  private tokenManager: TokenManager;
  private urlParser: UrlParser;
  private catalogCache = new Map<string, any>();

  constructor(httpClient: HttpClient, tokenManager: TokenManager, urlParser: UrlParser) {
    this.httpClient = httpClient;
    this.tokenManager = tokenManager;
    this.urlParser = urlParser;
  }

  /**
   * Fetch component metadata from a GitLab URL
   * Tries catalog API first, then falls back to repository API
   */
  public async fetchComponentMetadata(
    url: string,
    context?: vscode.ExtensionContext
  ): Promise<Component> {
    const startTime = Date.now();

    try {
      // Parse the GitLab component URL
      const urlObj = new URL(url);
      const gitlabInstance = urlObj.hostname;

      // Extract project path, component name, and version
      const pathParts = urlObj.pathname.split('/');
      let componentName: string;
      let version: string;
      let projectPath: string;

      const lastPart = pathParts[pathParts.length - 1];

      if (lastPart.includes('@')) {
        [componentName, version] = lastPart.split('@');
        projectPath = pathParts.slice(1, pathParts.length - 1).join('/');
      } else {
        componentName = lastPart;
        version = 'main';
        projectPath = pathParts.slice(1, pathParts.length - 1).join('/');
      }

      this.logger.debug(
        `Parsed URL: Project=${projectPath}, Component=${componentName}, Version=${version}`
      );

      let templateContent = '';
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
        const catalogApiUrl = `https://${gitlabInstance}/api/v4/ci/catalog/${encodeURIComponent(
          namespaceProject
        )}`;

        let token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
        let catalogFetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

        this.logger.debug(`Trying to fetch from GitLab Catalog API: ${catalogApiUrl}`);
        this.logger.debug(`Using token for catalog API: ${token ? 'YES' : 'NO'}`);
        const catalogData = (await this.httpClient.fetchJson(
          catalogApiUrl,
          catalogFetchOptions
        )) as GitLabCatalogData;

        if (catalogData && catalogData.components) {
          const catalogComponent = catalogData.components.find(
            (c: GitLabCatalogComponent) => c.name === componentName
          );
          if (catalogComponent) {
            this.logger.info(`Found component in catalog: ${componentName}`);

            const component = {
              name: componentName,
              description:
                `# ${componentName}\n\n${catalogComponent.description || ''}\n\n` +
                `**From GitLab CI/CD Catalog**\n` +
                `**Project:** [${projectPath}](https://${gitlabInstance}/${projectPath})\n` +
                `**Version:** ${version}\n\n` +
                (catalogComponent.documentation_url
                  ? `[Full Documentation](${catalogComponent.documentation_url})`
                  : ''),
              parameters:
                catalogComponent.variables?.map((v: GitLabCatalogVariable) => ({
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

      let token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
      let fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      this.logger.debug(`Using token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`);

      // Fetch project info and template in parallel
      let projectInfo: any;
      let templateResult: any;
      try {
        [projectInfo, templateResult] = await Promise.allSettled([
          this.httpClient.fetchJson(projectApiUrl, fetchOptions),
          this.fetchTemplate(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions)
        ]);
      } catch (err: any) {
        if (err && (err.status === 401 || err.status === 403)) {
          // Prompt for token and retry
          token = await promptForTokenIfNeeded(context, this.tokenManager, gitlabInstance, projectPath);
          if (token) {
            fetchOptions = { headers: { 'PRIVATE-TOKEN': token } };
            [projectInfo, templateResult] = await Promise.allSettled([
              this.httpClient.fetchJson(projectApiUrl, fetchOptions),
              this.fetchTemplate(
                apiBaseUrl,
                encodedProjectPath,
                componentName,
                version,
                fetchOptions
              )
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

      // Build component description with proper fallbacks
      let cleanDescription = '';

      if (project.description && project.description.trim()) {
        cleanDescription = project.description.trim();
      } else {
        cleanDescription = `Component/Project does not have a description`;
      }

      // Construct the component
      const component: Component = {
        name: componentName,
        description: cleanDescription,
        parameters,
        version,
        source: `${gitlabInstance}/${projectPath}`
      };

      this.logger.logPerformance('fetchComponentMetadata (full)', Date.now() - startTime, {
        hasTemplate: !!templateContent,
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

  /**
   * Helper method for parallel template fetching
   */
  private async fetchTemplate(
    apiBaseUrl: string,
    projectId: string,
    componentName: string,
    version: string,
    fetchOptions?: any
  ): Promise<{ content: string; parameters: any[] } | null> {
    try {
      const templatePath = `templates/${componentName}.yml`;
      const templateUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(
        templatePath
      )}/raw?ref=${version}`;

      this.logger.debug(`[ComponentFetcher] Fetching template from: ${templateUrl}`);
      const templateContent = await this.httpClient.fetchText(templateUrl, fetchOptions);
      this.logger.debug(
        `[ComponentFetcher] Template content received, length: ${templateContent.length} chars`
      );

      // Use unified parser to extract parameters
      const parsedSpec = GitLabSpecParser.parse(templateContent, componentName);

      this.logger.debug(
        `[ComponentFetcher] Template ${componentName}: Extracted ${parsedSpec.variables.length} parameters`
      );
      parsedSpec.variables.forEach((param) => {
        this.logger.debug(
          `[ComponentFetcher] Template ${componentName}: Parameter: ${param.name} (${param.type}, required: ${param.required})`
        );
      });

      return { content: templateContent, parameters: parsedSpec.variables };
    } catch (error) {
      this.logger.debug(`Could not fetch component template: ${error}`);
      return null;
    }
  }

  /**
   * Fetch component catalog data from GitLab with optimizations
   */
  public async fetchCatalogData(
    gitlabInstance: string,
    projectPath: string,
    forceRefresh: boolean = false,
    version?: string,
    context?: vscode.ExtensionContext
  ): Promise<any> {
    const startTime = Date.now();
    const versionSuffix = version ? `@${version}` : '';
    const cacheKey = `catalog:${gitlabInstance}:${projectPath}${versionSuffix}`;

    this.logger.info(`fetchCatalogData called for ${gitlabInstance}/${projectPath}${versionSuffix}`);
    this.logger.debug(`Force refresh: ${forceRefresh}`);

    // Clean up GitLab instance URL if it contains protocol
    const cleanGitlabInstance = this.urlParser.cleanGitLabInstance(gitlabInstance);

    // Check cache first
    if (!forceRefresh && this.catalogCache.has(cacheKey)) {
      this.logger.info(`Returning cached catalog data for ${cacheKey}`);
      this.logger.logPerformance('fetchCatalogData (cached)', Date.now() - startTime);
      return this.catalogCache.get(cacheKey);
    }

    this.logger.info(`Fetching fresh catalog data from ${cleanGitlabInstance}`);

    try {
      const apiBaseUrl = `https://${cleanGitlabInstance}/api/v4`;
      let ref = version || 'main';
      let token = await this.tokenManager.getTokenForProject(cleanGitlabInstance, projectPath);
      let fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      // **PARALLEL OPTIMIZATION with GRACEFUL DEGRADATION** - Fetch project info and templates in parallel
      const [projectInfoResult, templatesResult] = await Promise.allSettled([
        this.httpClient.fetchJson(
          `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`,
          fetchOptions
        ),
        this.httpClient.fetchJson(
          `${apiBaseUrl}/projects/${encodeURIComponent(
            projectPath
          )}/repository/tree?path=templates&ref=${ref}`,
          fetchOptions
        )
      ]);

      let projectInfo: any;
      let templates: any;

      // Handle authentication errors and retry if needed
      if (projectInfoResult.status === 'rejected') {
        const err = projectInfoResult.reason;
        if (err && (err.status === 401 || err.status === 403)) {
          // Prompt for token and retry
          token = await promptForTokenIfNeeded(context, this.tokenManager, cleanGitlabInstance, projectPath);
          if (token) {
            fetchOptions = { headers: { 'PRIVATE-TOKEN': token } };
            const [retryProjectInfo, retryTemplates] = await Promise.allSettled([
              this.httpClient.fetchJson(
                `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`,
                fetchOptions
              ),
              this.httpClient.fetchJson(
                `${apiBaseUrl}/projects/${encodeURIComponent(
                  projectPath
                )}/repository/tree?path=templates&ref=${ref}`,
                fetchOptions
              )
            ]);

            if (retryProjectInfo.status === 'rejected') {
              throw retryProjectInfo.reason;
            }

            projectInfo = retryProjectInfo.value;
            templates = retryTemplates.status === 'fulfilled' ? retryTemplates.value : [] as GitLabTreeItem[];
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      } else {
        projectInfo = projectInfoResult.value;
        templates = templatesResult.status === 'fulfilled' ? templatesResult.value : [] as GitLabTreeItem[];
      }

      // Use the project's default branch if available
      if (projectInfo && projectInfo.default_branch) {
        ref = projectInfo.default_branch;
      }
      this.logger.debug(`Found project: ${projectInfo.name} (ID: ${projectInfo.id}), using ref: ${ref}`);

      // Re-fetch templates with correct ref if needed
      templates = await this.httpClient
        .fetchJson(
          `${apiBaseUrl}/projects/${encodeURIComponent(
            projectPath
          )}/repository/tree?path=templates&ref=${ref}`,
          fetchOptions
        )
        .catch(() => [] as GitLabTreeItem[]);

      // Filter YAML files
      const yamlFiles = templates.filter(
        (file: GitLabTreeItem) => file.name.endsWith('.yml') || file.name.endsWith('.yaml')
      );
      this.logger.debug(`Found ${yamlFiles.length} YAML template files`);

      if (yamlFiles.length === 0) {
        this.logger.info(`No YAML templates found in ${projectPath}`);
        const catalogData = { components: [] };
        this.catalogCache.set(cacheKey, catalogData);
        return catalogData;
      }

      // Process components in batches
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const batchSize = config.get<number>('batchSize', 5);
      const componentResults = await this.httpClient.processBatch(
        yamlFiles,
        async (file: GitLabTreeItem) => {
          const name = file.name.replace(/\.ya?ml$/, '');
          this.logger.debug(`Processing component: ${name} (${file.name})`);

          // Fetch template content
          const templateResult = await this.fetchTemplateContent(
            apiBaseUrl,
            projectInfo.id,
            file.name,
            ref,
            fetchOptions
          );

          let description = '';
          let variables: ComponentVariable[] = [];

          // Process template content - skip files that don't have a spec section
          if (templateResult) {
            const { extractedVariables, extractedDescription, isValidComponent } = templateResult;

            // Skip non-component templates
            if (!isValidComponent) {
              this.logger.debug(
                `[ComponentFetcher] Skipping ${name}: not a valid GitLab CI/CD component (no spec section)`
              );
              return null;
            }

            variables = extractedVariables;
            description = extractedDescription || `${name} component`;
          } else {
            // If we couldn't fetch the template, skip it
            this.logger.debug(`[ComponentFetcher] Skipping ${name}: could not fetch template content`);
            return null;
          }

          return {
            name,
            description,
            variables,
            latest_version: ref
          };
        },
        batchSize
      );

      // Filter out null results (non-component templates)
      const components = componentResults.filter((c: any) => c !== null);
      this.logger.debug(
        `[ComponentFetcher] ${components.length} of ${yamlFiles.length} templates are valid components`
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

  /**
   * Helper method for parallel template content fetching
   */
  private async fetchTemplateContent(
    apiBaseUrl: string,
    projectId: string,
    fileName: string,
    ref: string,
    fetchOptions?: any
  ): Promise<{
    content: string;
    extractedVariables: ComponentVariable[];
    extractedDescription?: string;
    isValidComponent: boolean;
  } | null> {
    try {
      const contentUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(
        'templates/' + fileName
      )}/raw?ref=${ref}`;
      const content = await this.httpClient.fetchText(contentUrl, fetchOptions);

      // Use unified parser to extract spec information
      const parsedSpec = GitLabSpecParser.parse(content, fileName);

      return {
        content,
        extractedVariables: parsedSpec.variables,
        extractedDescription: parsedSpec.description,
        isValidComponent: parsedSpec.isValidComponent
      };
    } catch (error) {
      this.logger.debug(`Could not fetch template content: ${error}`);
      return null;
    }
  }

  /**
   * Fetch project information from GitLab API
   */
  public async fetchProjectInfo(
    gitlabInstance: string,
    projectPath: string
  ): Promise<any> {
    const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
    const token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
    const fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

    return this.httpClient.fetchJson(
      `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`,
      fetchOptions
    );
  }

  /**
   * Clear the catalog cache
   */
  public clearCache(): void {
    this.catalogCache.clear();
  }

  /**
   * Get catalog cache statistics
   */
  public getCatalogCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.catalogCache.size,
      keys: Array.from(this.catalogCache.keys())
    };
  }
}
