import * as vscode from 'vscode';
import { Component } from '../../providers/componentDetector';
import type { ComponentParameter } from '../../types/git-component';
import {
  GitLabCatalogComponent,
  GitLabCatalogVariable,
  GitLabCatalogData,
  ParsedCatalogData
} from '../../types/gitlab-catalog';
import type { GitLabProjectInfo, GitLabTreeItem } from '../../types/api';
import { HttpClient } from '../../utils/httpClient';
import { Logger } from '../../utils/logger';
import { GitLabSpecParser, ComponentVariable } from '../../parsers/specParser';
import { isAuthError } from '../../errors';
import { TokenManager } from './tokenManager';
import { UrlParser } from './urlParser';
import {
  backfillParameterOptions,
  buildCatalogComponents,
  fetchAllTemplateFiles,
} from './componentFetcherTemplates';
import { firstParagraph, readmeDirForTemplate } from './readmeDescription';

/**
 * Prompt the user for a GitLab personal access token for `gitlabInstance`.
 *
 * The two reasons we reach a 401 need different wording: a stored token that GitLab rejected
 * (expired/invalid — *replace* it) versus no token at all (private source needs *first-time* auth).
 *
 * @param context        Extension context (currently unused; reserved for context-scoped secrets).
 * @param tokenManager   Stores the entered token, keyed by `gitlabInstance`.
 * @param gitlabInstance The GitLab host the token is for (e.g. `gitlab.com`).
 * @param hadToken       Whether a token was already stored for this instance — selects which of the
 *                       two messages above is shown.
 * @returns              The trimmed token if the user entered one (also persisted), or `undefined`
 *                       if they left it blank (public access) or dismissed the prompt.
 */
async function promptForTokenIfNeeded(
  context: vscode.ExtensionContext | undefined,
  tokenManager: TokenManager,
  gitlabInstance: string,
  hadToken: boolean
): Promise<string | undefined> {
  const tokenPrompt = hadToken
    ? `Your GitLab token for ${gitlabInstance} is invalid or has expired. Enter a new personal access token (needs the read_api scope) to continue.`
    : `This project/group requires a GitLab personal access token for ${gitlabInstance} (needs the read_api scope). Enter one to continue, or leave blank for public access.`;
  const token = await vscode.window.showInputBox({
    title: 'GitLab Component Helper',
    prompt: tokenPrompt,
    placeHolder: hadToken ? 'New personal access token' : 'Personal access token (blank for public access)',
    password: true,
    ignoreFocusOut: true
  });
  if (token && token.trim()) {
    await tokenManager.setTokenForProject(gitlabInstance, token.trim());
    vscode.window.showInformationMessage(`GitLab Component Helper: token saved for ${gitlabInstance}`);
    return token.trim();
  } else if (token === '') {
    vscode.window.showInformationMessage('GitLab Component Helper: no token entered. Public access will be used.');
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
  private catalogCache = new Map<string, ParsedCatalogData>();

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

      // Extract project path, component name, and version.
      // Supports:
      // 1) /group/project/component@version
      // 2) /group/project/component
      // 3) /group/project (project-only shorthand -> default component selection)
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      let componentName: string;
      let version: string;
      let projectPath: string;
      let projectOnlyUrl = false;

      const lastPart = pathParts[pathParts.length - 1];

      if (lastPart.includes('@')) {
        [componentName, version] = lastPart.split('@');
        projectPath = pathParts.slice(0, pathParts.length - 1).join('/');
      } else if (pathParts.length >= 3) {
        componentName = lastPart;
        version = 'main';
        projectPath = pathParts.slice(0, pathParts.length - 1).join('/');
      } else {
        // Project-only URL (e.g. /components/dependency-scanning).
        // Default to "main" and let catalog selection refine it if available.
        componentName = 'main';
        version = 'main';
        projectPath = pathParts.join('/');
        projectOnlyUrl = true;
      }

      this.logger.debug(
        `Parsed URL: Project=${projectPath}, Component=${componentName}, Version=${version}`
      );

      const encodedProjectPath = encodeURIComponent(projectPath);
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;

      let templateContent = '';
      let parameters: ComponentVariable[] = [];

      // Try GitLab CI/CD Catalog first
      try {
        const namespaceProject = projectPath;
        const catalogApiUrl = `https://${gitlabInstance}/api/v4/ci/catalog/${encodeURIComponent(
          namespaceProject
        )}`;

        const token = await this.tokenManager.getTokenForProject(gitlabInstance);
        const catalogFetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

        this.logger.debug(`Trying to fetch from GitLab Catalog API: ${catalogApiUrl}`);
        this.logger.debug(`Using token for catalog API: ${token ? 'YES' : 'NO'}`);
        const catalogData = await this.httpClient.fetchJson<GitLabCatalogData>(
          catalogApiUrl,
          catalogFetchOptions
        );

        if (catalogData && catalogData.components) {
          let catalogComponent = catalogData.components.find(
            (c: GitLabCatalogComponent) => c.name === componentName
          );

          // For project-only shorthand URLs, try to auto-select a sensible component.
          if (!catalogComponent && projectOnlyUrl) {
            const projectBaseName = projectPath.split('/').pop() || '';
            catalogComponent =
              catalogData.components.find((c: GitLabCatalogComponent) => c.name === 'main') ||
              catalogData.components.find((c: GitLabCatalogComponent) => c.name === projectBaseName) ||
              (catalogData.components.length === 1 ? catalogData.components[0] : undefined);

            if (catalogComponent) {
              componentName = catalogComponent.name;
              this.logger.debug(
                `Project-only URL resolved to component: ${componentName}`,
                'ComponentFetcher'
              );
            }
          }

          if (catalogComponent) {
            this.logger.info(`Found component in catalog: ${componentName}`);

            let extractedParameters: ComponentParameter[] =
              catalogComponent.variables?.map((v: GitLabCatalogVariable) => ({
                name: v.name,
                description: v.description || `Parameter: ${v.name}`,
                required: v.required || false,
                type: v.type || 'string',
                default: v.default
              })) || [];

            // Always probe the template so we know the on-repo path (needed for the template-file link). When the
            // catalog omits variable details we also harvest the parsed parameters as a backup.
            const templateResult = await this.fetchTemplate(
              apiBaseUrl,
              encodedProjectPath,
              componentName,
              version,
              catalogFetchOptions
            );
            if (extractedParameters.length === 0 && templateResult?.parameters?.length) {
              extractedParameters = templateResult.parameters;
            } else if (templateResult?.parameters?.length) {
              // The catalog API doesn't return per-input `options`, so backfill them from the parsed template
              // (matched by name) onto the catalog-derived parameters we're keeping.
              extractedParameters = backfillParameterOptions(extractedParameters, templateResult.parameters);
            }

            // If the catalog omits a description, fall back to the component's README.
            const readmeDirs = [readmeDirForTemplate(templateResult?.templatePath), ''];
            const readme =
              (await this.fetchReadme(
                apiBaseUrl,
                encodedProjectPath,
                version,
                readmeDirs,
                catalogFetchOptions
              )) ?? undefined;
            const summary = catalogComponent.description?.trim() || firstParagraph(readme) || '';

            const component = {
              name: componentName,
              description:
                `# ${componentName}\n\n${summary}\n\n` +
                `**From GitLab CI/CD Catalog**\n` +
                `**Project:** [${projectPath}](https://${gitlabInstance}/${projectPath})\n` +
                `**Version:** ${version}\n\n` +
                (catalogComponent.documentation_url
                  ? `[Full Documentation](${catalogComponent.documentation_url})`
                  : ''),
              parameters: extractedParameters,
              version,
              source: `${gitlabInstance}/${projectPath}`,
              documentationUrl: catalogComponent.documentation_url,
              templatePath: templateResult?.templatePath
            };

            this.logger.logPerformance('fetchComponentMetadata (catalog)', Date.now() - startTime);
            return component;
          }
        }
      } catch (catalogError) {
        this.logger.debug(`Could not fetch from catalog: ${catalogError}`);
      }

      // Fall back to API + repository approach with parallel requests
      const projectApiUrl = `${apiBaseUrl}/projects/${encodedProjectPath}`;

      this.logger.debug(`Fetching project info from: ${projectApiUrl}`);

      let token = await this.tokenManager.getTokenForProject(gitlabInstance);
      let fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      this.logger.debug(`Using token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`);

      // Fetch project info and template in parallel. `allSettled` never rejects, so an auth failure
      // surfaces as a rejected `projectInfo` rather than a thrown error — handle it explicitly below.
      let [projectInfo, templateResult] = await Promise.allSettled([
        this.httpClient.fetchJson<GitLabProjectInfo>(projectApiUrl, fetchOptions),
        this.fetchTemplate(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions)
      ]);

      // On a 401/403 fetching project info, prompt for a token once and retry. If the user declines
      // (or it still fails), rethrow the original auth error so callers can surface a clear prompt
      // instead of degrading into an empty-parameter component.
      if (projectInfo.status === 'rejected' && isAuthError(projectInfo.reason)) {
        token = await promptForTokenIfNeeded(context, this.tokenManager, gitlabInstance, !!token);
        if (!token) {
          throw projectInfo.reason;
        }
        fetchOptions = { headers: { 'PRIVATE-TOKEN': token } };
        [projectInfo, templateResult] = await Promise.allSettled([
          this.httpClient.fetchJson<GitLabProjectInfo>(projectApiUrl, fetchOptions),
          this.fetchTemplate(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions)
        ]);
      }

      if (projectInfo.status === 'rejected') {
        // Preserve the original error (and its status) so auth failures stay recognisable upstream.
        throw projectInfo.reason;
      }

      const project = projectInfo.value;

      // Process template result
      let resolvedTemplatePath: string | undefined;
      if (templateResult.status === 'fulfilled' && templateResult.value) {
        const { content, parameters: extractedParams, templatePath } = templateResult.value;
        templateContent = content;
        parameters = extractedParams;
        resolvedTemplatePath = templatePath;
        this.logger.debug(`Found component template with ${parameters.length} parameters at ${templatePath}`);
      }

      // A component's README sits next to its template; fall back to the repo root for flat layouts.
      const readmeDirs = [readmeDirForTemplate(resolvedTemplatePath), ''];
      const readme =
        (await this.fetchReadme(apiBaseUrl, encodedProjectPath, version, readmeDirs, fetchOptions)) ??
        undefined;

      // Prefer the project description; when absent, fall back to the README's first meaningful paragraph.
      const cleanDescription = project.description?.trim() || firstParagraph(readme) || '';

      // Construct the component
      const component: Component = {
        name: componentName,
        description: cleanDescription,
        parameters,
        version,
        source: `${gitlabInstance}/${projectPath}`,
        templatePath: resolvedTemplatePath
      };

      this.logger.logPerformance('fetchComponentMetadata (full)', Date.now() - startTime, {
        hasTemplate: !!templateContent,
        paramCount: parameters.length
      });

      return component;
    } catch (error) {
      this.logger.error(`Error fetching component metadata: ${error}`);

      // Auth failures must propagate: a minimal empty-parameter component would make every provided
      // input look "unknown" during validation. Let callers surface a token prompt instead.
      if (isAuthError(error)) {
        throw error;
      }

      // For other failures, still provide a minimal component rather than failing outright.
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
    fetchOptions?: { headers?: Record<string, string> }
  ): Promise<{
    content: string;
    parameters: ComponentVariable[];
    templatePath: string;
  } | null> {
    try {
      const templatePathCandidates = [
        `templates/${componentName}.yml`,
        `templates/${componentName}.yaml`,
        `templates/${componentName}/template.yml`,
        `templates/${componentName}/template.yaml`
      ];

      let templateContent: string | null = null;
      let resolvedTemplatePath = '';

      for (const templatePath of templatePathCandidates) {
        const templateUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(
          templatePath
        )}/raw?ref=${version}`;
        this.logger.debug(`[ComponentFetcher] Trying template path: ${templatePath}`);

        try {
          templateContent = await this.httpClient.fetchText(templateUrl, fetchOptions);
          resolvedTemplatePath = templatePath;
          break;
        } catch {
          // try next candidate
        }
      }

      if (!templateContent) {
        this.logger.debug(`[ComponentFetcher] No template found for ${componentName} at known paths`);
        return null;
      }

      this.logger.debug(
        `[ComponentFetcher] Template content received from ${resolvedTemplatePath}, length: ${templateContent.length} chars`
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

      return { content: templateContent, parameters: parsedSpec.variables, templatePath: resolvedTemplatePath };
    } catch (error) {
      this.logger.debug(`Could not fetch component template: ${error}`);
      return null;
    }
  }

  /**
   * Fetch a README, trying the common filename/casing variants under each of `dirs` in order. A component's
   * own README lives next to its template (`templates/<name>/README.md`), so callers pass that directory
   * ahead of the root.
   *
   * @param apiBaseUrl   GitLab API v4 base.
   * @param projectId    Numeric or string project id for the raw-file endpoint.
   * @param version      Git ref to read each file at.
   * @param dirs         Directories to search, in priority order; `''` means the repo root.
   * @param fetchOptions Optional request headers.
   * @returns            The raw text of the first README that exists, or `null` when none are present (or the fetch fails).
   */
  private async fetchReadme(
    apiBaseUrl: string,
    projectId: string,
    version: string,
    dirs: string[],
    fetchOptions?: { headers?: Record<string, string> }
  ): Promise<string | null> {
    const names = ['README.md', 'README.MD', 'readme.md', 'README', 'README.rst', 'README.txt'];

    for (const dir of dirs) {
      const prefix = dir ? `${dir.replace(/\/$/, '')}/` : '';
      for (const name of names) {
        const path = `${prefix}${name}`;
        const readmeUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(
          path
        )}/raw?ref=${version}`;
        try {
          const content = await this.httpClient.fetchText(readmeUrl, fetchOptions);
          if (content && content.trim()) {
            this.logger.debug(`[ComponentFetcher] README found at ${path}, length: ${content.length} chars`);
            return content;
          }
        } catch {
          // try next candidate
        }
      }
    }

    this.logger.debug(`[ComponentFetcher] No README found at known paths`);
    return null;
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
  ): Promise<ParsedCatalogData> {
    const startTime = Date.now();
    const versionSuffix = version ? `@${version}` : '';
    const cacheKey = `catalog:${gitlabInstance}:${projectPath}${versionSuffix}`;

    this.logger.info(`fetchCatalogData called for ${gitlabInstance}/${projectPath}${versionSuffix}`);
    this.logger.debug(`Force refresh: ${forceRefresh}`);

    // Clean up GitLab instance URL if it contains protocol
    const cleanGitlabInstance = this.urlParser.cleanGitLabInstance(gitlabInstance);

    // Check cache first
    const cached = forceRefresh ? undefined : this.catalogCache.get(cacheKey);
    if (cached) {
      this.logger.info(`Returning cached catalog data for ${cacheKey}`);
      this.logger.logPerformance('fetchCatalogData (cached)', Date.now() - startTime);
      return cached;
    }

    this.logger.info(`Fetching fresh catalog data from ${cleanGitlabInstance}`);

    try {
      const apiBaseUrl = `https://${cleanGitlabInstance}/api/v4`;
      let ref = version || 'main';
      let token = await this.tokenManager.getTokenForProject(cleanGitlabInstance);
      let fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      // **PARALLEL OPTIMIZATION with GRACEFUL DEGRADATION** - Fetch project info and templates in parallel
      const [projectInfoResult] = await Promise.allSettled([
        this.httpClient.fetchJson<GitLabProjectInfo>(
          `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`,
          fetchOptions
        ),
        this.httpClient.fetchJson<GitLabTreeItem[]>(
          `${apiBaseUrl}/projects/${encodeURIComponent(
            projectPath
          )}/repository/tree?path=templates&ref=${ref}`,
          fetchOptions
        )
      ]);

      let projectInfo: GitLabProjectInfo;

      // Handle authentication errors and retry if needed
      if (projectInfoResult.status === 'rejected') {
        const err = projectInfoResult.reason;
        if (isAuthError(err)) {
          // Prompt for token and retry
          token = await promptForTokenIfNeeded(context, this.tokenManager, cleanGitlabInstance, !!token);
          if (token) {
            fetchOptions = { headers: { 'PRIVATE-TOKEN': token } };
            const [retryProjectInfo] = await Promise.allSettled([
              this.httpClient.fetchJson<GitLabProjectInfo>(
                `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`,
                fetchOptions
              ),
              this.httpClient.fetchJson<GitLabTreeItem[]>(
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
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      } else {
        projectInfo = projectInfoResult.value;
      }

      // Fall back to the project's default branch only when no explicit ref was requested.
      if (!version && projectInfo && projectInfo.default_branch) {
        ref = projectInfo.default_branch;
      }
      this.logger.debug(`Found project: ${projectInfo.name} (ID: ${projectInfo.id}), using ref: ${ref}`);

      // Re-fetch templates with correct ref and include one subdirectory level.
      const yamlFiles = await fetchAllTemplateFiles(this.httpClient, apiBaseUrl, projectPath, ref, fetchOptions);
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
      const components = await buildCatalogComponents(
        this.httpClient,
        apiBaseUrl,
        projectInfo.id,
        yamlFiles,
        ref,
        batchSize,
        fetchOptions
      );
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
   * Fetch project information from GitLab API
   */
  public async fetchProjectInfo(
    gitlabInstance: string,
    projectPath: string
  ): Promise<GitLabProjectInfo> {
    const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
    const token = await this.tokenManager.getTokenForProject(gitlabInstance);
    const fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

    return this.httpClient.fetchJson<GitLabProjectInfo>(
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
