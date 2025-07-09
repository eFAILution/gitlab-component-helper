import * as vscode from 'vscode';
import * as https from 'https';
import { Component } from '../providers/componentDetector';
import { GitLabCatalogComponent, GitLabCatalogVariable, GitLabCatalogData } from '../types/gitlab-catalog';
import { outputChannel } from '../utils/outputChannel';

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

interface RateLimiter {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per second
}

interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

export interface ComponentSource {
  getComponents(): Promise<Component[]>;
  getComponent(name: string): Promise<Component | undefined>;
}

// Cache for components
let componentsCache: Component[] = [];
let lastFetchTime = 0;

export class ComponentService implements ComponentSource {
  // Add this property for URL-based component caching
  private componentCache = new Map<string, Component>();
  private catalogCache = new Map<string, any>();

  // Rate limiting properties
  private rateLimiter: RateLimiter = {
    tokens: 10, // Start with full tokens
    lastRefill: Date.now(),
    maxTokens: 10, // Max 10 requests
    refillRate: 2 // 2 tokens per second
  };

  private retryOptions: RetryOptions = {
    maxRetries: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 8000 // 8 seconds max
  };

  async getComponents(): Promise<Component[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const cacheTime = config.get<number>('cacheTime', 3600) * 1000; // Default 1 hour

    outputChannel.appendLine(`[ComponentService] getComponents() called`);
    outputChannel.appendLine(`[ComponentService] Cache time setting: ${cacheTime/1000}s`);
    outputChannel.appendLine(`[ComponentService] Components in cache: ${componentsCache.length}`);
    outputChannel.appendLine(`[ComponentService] Time since last fetch: ${(Date.now() - lastFetchTime)/1000}s`);

    // Return cached data if valid
    if (componentsCache.length > 0 && (Date.now() - lastFetchTime) < cacheTime) {
      outputChannel.appendLine(`[ComponentService] Returning cached components`);
      return componentsCache;
    }

    // Fetch based on configured source
    const sourceType = config.get<string>('componentSource', 'local');
    outputChannel.appendLine(`[ComponentService] Component source type: ${sourceType}`);

    try {
      let components: Component[] = [];

      switch (sourceType) {
        case 'gitlab':
          outputChannel.appendLine(`[ComponentService] Fetching from GitLab API`);
          components = await this.fetchFromGitLab();
          break;
        case 'url':
          outputChannel.appendLine(`[ComponentService] Fetching from URL`);
          components = await this.fetchFromUrl();
          break;
        case 'local':
        default:
          outputChannel.appendLine(`[ComponentService] Using local components`);
          components = this.getLocalComponents();
      }

      outputChannel.appendLine(`[ComponentService] Fetched ${components.length} components`);

      // Update cache
      componentsCache = components;
      lastFetchTime = Date.now();
      return components;
    } catch (error) {
      outputChannel.appendLine(`[ComponentService] Error fetching components: ${error}`);
      console.error(`Error fetching components: ${error}`);
      vscode.window.showErrorMessage(`Failed to fetch GitLab components: ${error}`);
      outputChannel.appendLine(`[ComponentService] Falling back to local components`);
      return this.getLocalComponents(); // Fallback to local components
    }
  }

  async getComponent(name: string): Promise<Component | undefined> {
    const components = await this.getComponents();
    return components.find(c => c.name === name);
  }

  // Update getComponentFromUrl to ensure it sets the context property
  public async getComponentFromUrl(url: string): Promise<Component | null> {
    try {
      // Existing code to fetch component
      const component = await this.fetchComponentMetadata(url);

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

  private async fetchComponentMetadata(url: string): Promise<Component> {
    try {
      // Parse the GitLab component URL
      const urlObj = new URL(url);
      const gitlabInstance = urlObj.hostname; // e.g., gitlab.com

      // Extract project path, component name, and version
      const pathParts = urlObj.pathname.split('/');
      let componentName: string, version: string, projectPath: string;

      // The last part contains the component name and possibly a version
      const lastPart = pathParts[pathParts.length - 1];

      if (lastPart.includes('@')) {
        // Split component name and version
        [componentName, version] = lastPart.split('@');
        // Project path is everything before the component name
        projectPath = pathParts.slice(1, pathParts.length - 1).join('/');
      } else {
        componentName = lastPart;
        version = 'main'; // Default branch
        projectPath = pathParts.slice(1, pathParts.length - 1).join('/');
      }

      console.log(`Parsed URL: Project=${projectPath}, Component=${componentName}, Version=${version}`);

      // Try GitLab CI/CD Catalog first
      try {
        // Extract the namespace and project from the path
        // Expected format: components/opentofu for https://gitlab.com/components/opentofu
        const namespaceProject = projectPath;
        const catalogApiUrl = `https://${gitlabInstance}/api/v4/ci/catalog/${encodeURIComponent(namespaceProject)}`;

        console.log(`Trying to fetch from GitLab Catalog API: ${catalogApiUrl}`);
        const catalogData = await this.fetchJson(catalogApiUrl) as GitLabCatalogData;

        // If we got catalog data, look for our component
        if (catalogData && catalogData.components) {
          const catalogComponent = catalogData.components.find((c: GitLabCatalogComponent) => c.name === componentName);
          if (catalogComponent) {
            console.log(`Found component in catalog: ${componentName}`);

            // Construct component from catalog data
            return {
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
          }
        }
      } catch (catalogError) {
        console.log(`Could not fetch from catalog: ${catalogError}`);
        // Continue with the regular approach if catalog fetch fails
      }

      // Fall back to API + repository approach
      // Construct API URL to get project info
      const encodedProjectPath = encodeURIComponent(projectPath);
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
      const projectApiUrl = `${apiBaseUrl}/projects/${encodedProjectPath}`;

      console.log(`Fetching project info from: ${projectApiUrl}`);

      // Fetch project information first
      const projectInfo = await this.fetchJson(projectApiUrl);

      // Prepare parallel requests for template and README
      const templatePath = `templates/${componentName}.yml`;
      console.log(`Looking for component template at: ${templatePath}`);

      const templateUrl = `${apiBaseUrl}/projects/${projectInfo.id}/repository/files/${encodeURIComponent(templatePath)}/raw?ref=${version}`;
      const componentReadmePath = `docs/${componentName}/README.md`;
      const componentReadmeUrl = `${apiBaseUrl}/projects/${projectInfo.id}/repository/files/${encodeURIComponent(componentReadmePath)}/raw?ref=${version}`;
      const projectReadmeUrl = `${apiBaseUrl}/projects/${projectInfo.id}/repository/files/README.md/raw?ref=${version}`;

      // Fetch template and README files in parallel
      const [templateResult, componentReadmeResult, projectReadmeResult] = await Promise.allSettled([
        this.fetchText(templateUrl),
        this.fetchText(componentReadmeUrl),
        this.fetchText(projectReadmeUrl)
      ]);

      // Process template content
      let templateContent = '';
      let parameters: Array<{
        name: string;
        description: string;
        required: boolean;
        type: string;
        default?: string;
      }> = [];

      if (templateResult.status === 'fulfilled') {
        templateContent = templateResult.value;
        console.log(`Found component template with length: ${templateContent.length}`);

        // Try to extract variables/parameters from the template
        const variableMatches = templateContent.match(/variables:[\s\S]*?(?=\n\w+:|$)/g);
        if (variableMatches && variableMatches.length > 0) {
          const variableSection = variableMatches[0];
          const varLines = variableSection.split('\n').slice(1); // Skip "variables:" line

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

          console.log(`Extracted ${parameters.length} parameters from template`);
        }
      } else {
        console.log(`Could not fetch component template: ${templateResult.reason}`);
      }

      // Process README content - prefer component-specific README
      let readmeContent = '';
      if (componentReadmeResult.status === 'fulfilled') {
        readmeContent = componentReadmeResult.value;
      } else if (projectReadmeResult.status === 'fulfilled') {
        readmeContent = projectReadmeResult.value;
      } else {
        console.log(`Could not fetch README: component=${componentReadmeResult.status === 'rejected' ? componentReadmeResult.reason : 'N/A'}, project=${projectReadmeResult.status === 'rejected' ? projectReadmeResult.reason : 'N/A'}`);
      }

      // Construct the component
      const component: Component = {
        name: componentName,
        description:
          `# ${componentName}\n\n` +
          `${projectInfo.description || 'GitLab Component'}\n\n` +
          `**Project:** [${projectPath}](${projectInfo.web_url})\n` +
          `**Version:** ${version}\n\n` +
          (readmeContent ? `## Documentation\n${readmeContent.substring(0, 800)}...\n\n` : '') +
          (templateContent ? `## Template Preview\n\`\`\`yaml\n${templateContent.substring(0, 300)}...\n\`\`\`` : ''),
        parameters,
        version,
        source: `${gitlabInstance}/${projectPath}`
      };

      return component;
    } catch (error) {
      console.error(`Error fetching component metadata: ${error}`);

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

  // Helper methods for HTTP requests
  public fetchJson(url: string): Promise<any> {
    return this.fetchWithRetry(() => this.makeFetchJsonRequest(url));
  }

  private makeFetchJsonRequest(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'User-Agent': 'VSCode-GitLabComponentHelper'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(`Error parsing JSON: ${e}`);
            }
          } else if (res.statusCode === 429) {
            // Rate limited - throw special error for retry logic
            reject(new Error(`RATE_LIMITED:${res.statusCode}`));
          } else {
            reject(`HTTP error ${res.statusCode}`);
          }
        });
      }).on('error', reject);
    });
  }

  private fetchText(url: string): Promise<string> {
    return this.fetchWithRetry(() => this.makeFetchTextRequest(url));
  }

  private makeFetchTextRequest(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'User-Agent': 'VSCode-GitLabComponentHelper'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else if (res.statusCode === 429) {
            // Rate limited - throw special error for retry logic
            reject(new Error(`RATE_LIMITED:${res.statusCode}`));
          } else {
            reject(`HTTP error ${res.statusCode}`);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Refills rate limiter tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const timePassed = (now - this.rateLimiter.lastRefill) / 1000; // seconds
    const tokensToAdd = Math.floor(timePassed * this.rateLimiter.refillRate);

    if (tokensToAdd > 0) {
      this.rateLimiter.tokens = Math.min(
        this.rateLimiter.maxTokens,
        this.rateLimiter.tokens + tokensToAdd
      );
      this.rateLimiter.lastRefill = now;
    }
  }

  /**
   * Waits for available rate limit token
   */
  private async waitForRateLimit(): Promise<void> {
    this.refillTokens();

    if (this.rateLimiter.tokens <= 0) {
      // Calculate wait time until next token is available
      const waitTime = Math.ceil(1000 / this.rateLimiter.refillRate);
      outputChannel.appendLine(`[ComponentService] Rate limit hit, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.refillTokens();
    }

    this.rateLimiter.tokens--;
  }

  /**
   * Fetches all pages of results from a paginated GitLab API endpoint
   */
  private async fetchAllPages<T>(baseUrl: string, perPage: number = 100): Promise<T[]> {
    const allResults: T[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}&per_page=${perPage}`;

      try {
        outputChannel.appendLine(`[ComponentService] Fetching page ${page}: ${url}`);
        const results = await this.fetchJson(url) as T[];

        if (Array.isArray(results) && results.length > 0) {
          allResults.push(...results);

          // If we got fewer results than per_page, we're done
          if (results.length < perPage) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        outputChannel.appendLine(`[ComponentService] Error fetching page ${page}: ${error}`);
        // Stop pagination on error
        hasMore = false;
      }
    }

    outputChannel.appendLine(`[ComponentService] Fetched ${allResults.length} total items across ${page} pages`);
    return allResults;
  }

  /**
   * Fetches multiple resources in parallel
   */
  private async fetchInParallel<T>(requests: Array<() => Promise<T>>): Promise<T[]> {
    // Limit concurrent requests to avoid overwhelming the server
    const concurrencyLimit = 5;
    const results: T[] = [];

    for (let i = 0; i < requests.length; i += concurrencyLimit) {
      const batch = requests.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.allSettled(batch.map(req => req()));

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          outputChannel.appendLine(`[ComponentService] Parallel request failed: ${result.reason}`);
        }
      }
    }

    return results;
  }

  /**
   * Executes a request with retry logic and rate limiting
   */
  private async fetchWithRetry<T>(requestFn: () => Promise<T>): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        // Wait for rate limit before making request
        await this.waitForRateLimit();

        return await requestFn();
      } catch (error: any) {
        lastError = error;

        // Check if this is a rate limit error or should be retried
        const isRateLimited = error?.message?.includes('RATE_LIMITED');
        const shouldRetry = isRateLimited || error?.message?.includes('ENOTFOUND') || error?.message?.includes('timeout');

        if (attempt < this.retryOptions.maxRetries && shouldRetry) {
          // Calculate exponential backoff delay
          const delay = Math.min(
            this.retryOptions.baseDelay * Math.pow(2, attempt),
            this.retryOptions.maxDelay
          );

          outputChannel.appendLine(`[ComponentService] Request failed (attempt ${attempt + 1}/${this.retryOptions.maxRetries + 1}), retrying in ${delay}ms. Error: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // If we're here, we've exhausted retries or it's not retryable
        break;
      }
    }

    throw lastError;
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

  private fetchFromGitLab(): Promise<Component[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const gitlabUrl = config.get<string>('gitlabUrl', '');
    const projectId = config.get<string>('gitlabProjectId', '');
    const token = config.get<string>('gitlabToken', '');
    const filePath = config.get<string>('gitlabComponentsFilePath', 'components.json');

    return new Promise((resolve, reject) => {
      if (!gitlabUrl || !projectId || !token) {
        reject('GitLab URL, project ID, or token not configured');
        return;
      }

      const apiUrl = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw`;

      const options = {
        headers: {
          'PRIVATE-TOKEN': token,
          'User-Agent': 'VSCode-GitLabComponentHelper'
        }
      };

      https.get(apiUrl, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const components = JSON.parse(data);
              resolve(components);
            } catch (error) {
              reject(`Error parsing GitLab response: ${error}`);
            }
          } else {
            reject(`GitLab API returned status ${res.statusCode}: ${data}`);
          }
        });
      }).on('error', (error) => {
        reject(`Error connecting to GitLab: ${error}`);
      });
    });
  }

  private fetchFromUrl(): Promise<Component[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const url = config.get<string>('componentsUrl', '');

    return new Promise((resolve, reject) => {
      if (!url) {
        reject('Components URL not configured');
        return;
      }

      https.get(url, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const components = JSON.parse(data);
              resolve(components);
            } catch (error) {
              reject(`Error parsing response: ${error}`);
            }
          } else {
            reject(`HTTP request returned status ${res.statusCode}: ${data}`);
          }
        });
      }).on('error', (error) => {
        reject(`Error connecting to URL: ${error}`);
      });
    });
  }

  /**
   * Fetch component catalog data from GitLab
   */
  async fetchCatalogData(gitlabInstance: string, projectPath: string, forceRefresh: boolean = false, version?: string): Promise<any> {
    const versionSuffix = version ? `@${version}` : '';
    const cacheKey = `catalog:${gitlabInstance}:${projectPath}${versionSuffix}`;

    outputChannel.appendLine(`[ComponentService] fetchCatalogData called for ${gitlabInstance}/${projectPath}${versionSuffix}`);
    outputChannel.appendLine(`[ComponentService] Force refresh: ${forceRefresh}`);

    // Clean up GitLab instance URL if it contains protocol
    let cleanGitlabInstance = gitlabInstance;
    if (cleanGitlabInstance.startsWith('https://')) {
      cleanGitlabInstance = cleanGitlabInstance.replace('https://', '');
    }
    if (cleanGitlabInstance.startsWith('http://')) {
      cleanGitlabInstance = cleanGitlabInstance.replace('http://', '');
    }

    outputChannel.appendLine(`[ComponentService] Cleaned GitLab instance: ${cleanGitlabInstance}`);

    // Check cache first
    if (!forceRefresh && this.catalogCache && this.catalogCache.has(cacheKey)) {
      outputChannel.appendLine(`[ComponentService] Returning cached catalog data for ${cacheKey}`);
      return this.catalogCache.get(cacheKey);
    }

    outputChannel.appendLine(`[ComponentService] Fetching fresh catalog data from ${cleanGitlabInstance}`);

    try {
      const ref = version || 'main'; // Use specific version or default to main
      const apiBaseUrl = `https://${cleanGitlabInstance}/api/v4`;
      const encodedPath = encodeURIComponent(projectPath);

      // Fetch project info and templates in parallel
      const [projectInfo, templates] = await Promise.allSettled([
        this.fetchJson(`${apiBaseUrl}/projects/${encodedPath}`),
        this.fetchJson(`${apiBaseUrl}/projects/${encodedPath}/repository/tree?path=templates&ref=${ref}`)
      ]);

      if (projectInfo.status === 'rejected') {
        throw new Error(`Failed to fetch project info: ${projectInfo.reason}`);
      }

      if (templates.status === 'rejected') {
        outputChannel.appendLine(`[ComponentService] Failed to fetch templates: ${templates.reason}`);
        return { components: [] };
      }

      const project = projectInfo.value;
      const templateFiles = templates.value as GitLabTreeItem[];

      outputChannel.appendLine(`[ComponentService] Found project: ${project.name} (ID: ${project.id})`);
      outputChannel.appendLine(`[ComponentService] Found ${templateFiles.length} items in templates directory`);

      // Filter YAML files
      const yamlFiles = templateFiles.filter((file: GitLabTreeItem) => file.name.endsWith('.yml') || file.name.endsWith('.yaml'));
      outputChannel.appendLine(`[ComponentService] Found ${yamlFiles.length} YAML template files`);

      if (yamlFiles.length === 0) {
        return { components: [] };
      }

      // Process all components in parallel with batching
      const componentRequests = yamlFiles.map((file: GitLabTreeItem) => {
        return async () => {
          const name = file.name.replace(/\.ya?ml$/, '');
          outputChannel.appendLine(`[ComponentService] Processing component: ${name} (${file.name})`);

          const contentUrl = `${apiBaseUrl}/projects/${project.id}/repository/files/${encodeURIComponent('templates/' + file.name)}/raw?ref=${ref}`;
          let description = '';
          let variables: ComponentVariable[] = [];

          try {
            const content = await this.fetchText(contentUrl);
            outputChannel.appendLine(`[ComponentService] Fetched content for ${name} (${content.length} chars)`);

            // Extract description from multiple sources (priority order)
            // 1. Try to get description from component spec
            const specDescMatch = content.match(/spec:\s*\n(?:\s*inputs:[\s\S]*?)?\n\s*description:\s*["']?(.*?)["']?\s*$/m);
            if (specDescMatch) {
              description = specDescMatch[1].trim();
              outputChannel.appendLine(`[ComponentService] Found spec description for ${name}: ${description}`);
            }

            // 2. If no spec description, try comment at top of file
            if (!description) {
              const commentMatch = content.match(/^#\s*(.+?)$/m);
              if (commentMatch && !commentMatch[1].toLowerCase().includes('gitlab') && !commentMatch[1].toLowerCase().includes('ci')) {
                description = commentMatch[1].trim();
                outputChannel.appendLine(`[ComponentService] Found comment description for ${name}: ${description}`);
              }
            }

            // 4. Fallback description
            if (!description) {
              description = `${name} component`;
            }

            // Extract variables from GitLab CI/CD component spec format
            let specMatches = content.match(/spec:\s*\n\s*inputs:([\s\S]*?)(?=\n\w+:|$)/);
            if (specMatches) {
              // Parse component spec format
              const inputsSection = specMatches[1];
              const inputLines = inputsSection.split('\n')
                .filter(line => line.trim() && !line.trim().startsWith('#'));

              let currentInput: any = null;
              variables = [];

              for (const line of inputLines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                // New input parameter (starts at column 4 spaces or 2 spaces after "inputs:")
                if (line.match(/^\s{4}[a-zA-Z_][a-zA-Z0-9_]*:/) || line.match(/^\s{2}[a-zA-Z_][a-zA-Z0-9_]*:/)) {
                  if (currentInput) {
                    variables.push(currentInput);
                  }
                  const inputName = trimmedLine.split(':')[0];
                  currentInput = {
                    name: inputName,
                    description: `Parameter: ${inputName}`,
                    required: false,
                    type: 'string',
                    default: undefined
                  };
                }
                // Property of current input
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
                variables.push(currentInput);
              }

              outputChannel.appendLine(`[ComponentService] Extracted ${variables.length} variables from component spec for ${name}`);
            } else {
              // Fallback to old format for backward compatibility
              const variableMatches = content.match(/variables:[\s\S]*?(?=\n\w+:|$)/);
              if (variableMatches) {
                const variableSection = variableMatches[0];
                const varLines = variableSection.split('\n').slice(1); // Skip "variables:" line

                variables = varLines
                  .filter(line => line.trim() && line.includes(':') && !line.trim().startsWith('#'))
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

                outputChannel.appendLine(`[ComponentService] Extracted ${variables.length} variables from legacy format for ${name}`);
              }
            }
          } catch (e) {
            outputChannel.appendLine(`[ComponentService] Error fetching content for ${name}: ${e}`);
            console.error(`Error fetching content for ${name}: ${e}`);
          }

          return {
            name,
            description: description || `${name} component`,
            variables,
            latest_version: ref,
            readme: '' // README fetching moved to separate method if needed
          };
        };
      });

      // Process components in parallel with controlled concurrency
      const components = await this.fetchInParallel(componentRequests);

      outputChannel.appendLine(`[ComponentService] Successfully processed ${components.length} components`);
      components.forEach((comp: any) => {
        outputChannel.appendLine(`[ComponentService]   - ${comp.name}: ${comp.variables.length} variables`);
      });

      const catalogData = { components };

      // Cache the result if we have a cache
      if (this.catalogCache) {
        this.catalogCache.set(cacheKey, catalogData);
        outputChannel.appendLine(`[ComponentService] Cached catalog data for ${cacheKey}`);
      }

      return catalogData;
    } catch (error) {
      outputChannel.appendLine(`[ComponentService] Error fetching catalog data for ${projectPath}: ${error}`);
      console.error(`Error fetching catalog data for ${projectPath}: ${error}`);
      throw error;
    }
  }

  /**
   * Fetch all tags/versions for a GitLab project
   */
  public async fetchProjectVersions(gitlabInstance: string, projectPath: string): Promise<string[]> {
    try {
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
      const encodedPath = encodeURIComponent(projectPath);

      outputChannel.appendLine(`[ComponentService] Fetching versions for ${gitlabInstance}/${projectPath}`);

      // First, get project info to get the project ID
      const projectUrl = `${apiBaseUrl}/projects/${encodedPath}`;
      const projectInfo = await this.fetchJson(projectUrl);

      if (!projectInfo || !projectInfo.id) {
        outputChannel.appendLine(`[ComponentService] Could not get project info for ${projectPath}`);
        return ['main']; // Fallback to main branch
      }

      // Fetch both tags and branches in parallel
      const versions: string[] = [];

      const [tags, branches] = await Promise.allSettled([
        // Fetch all tags with pagination
        this.fetchAllPages<any>(`${apiBaseUrl}/projects/${projectInfo.id}/repository/tags?sort=desc`),
        // Fetch branches (limit to first page for performance, we only need main branches)
        this.fetchJson(`${apiBaseUrl}/projects/${projectInfo.id}/repository/branches?per_page=20`)
      ]);

      // Process tags
      if (tags.status === 'fulfilled' && Array.isArray(tags.value)) {
        const tagVersions = tags.value.map((tag: any) => tag.name).filter((name: string) => name);
        versions.push(...tagVersions);
        outputChannel.appendLine(`[ComponentService] Found ${tagVersions.length} tags`);
      } else {
        outputChannel.appendLine(`[ComponentService] Error fetching tags: ${tags.status === 'rejected' ? tags.reason : 'No tags found'}`);
      }

      // Process branches
      if (branches.status === 'fulfilled' && Array.isArray(branches.value)) {
        const importantBranches = branches.value
          .map((branch: any) => branch.name)
          .filter((name: string) => ['main', 'master', 'develop', 'dev'].includes(name));
        versions.push(...importantBranches);
        outputChannel.appendLine(`[ComponentService] Found ${importantBranches.length} important branches`);
      } else {
        outputChannel.appendLine(`[ComponentService] Error fetching branches: ${branches.status === 'rejected' ? branches.reason : 'No branches found'}`);
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

      outputChannel.appendLine(`[ComponentService] Returning ${sortedVersions.length} versions: ${sortedVersions.slice(0, 5).join(', ')}${sortedVersions.length > 5 ? '...' : ''}`);
      return sortedVersions.length > 0 ? sortedVersions : ['main'];

    } catch (error) {
      outputChannel.appendLine(`[ComponentService] Error fetching project versions: ${error}`);
      return ['main']; // Fallback
    }
  }

  /**
   * Fetch all tags/versions for a GitLab project
   */
  public async fetchProjectTags(gitlabInstance: string, projectPath: string): Promise<Array<{name: string, commit: any}>> {
    outputChannel.appendLine(`[ComponentService] Fetching tags for ${gitlabInstance}/${projectPath}`);

    return new Promise<Array<{name: string, commit: any}>>((resolve, reject) => {
      const path = `/api/v4/projects/${encodeURIComponent(projectPath)}/repository/tags?per_page=100&order_by=updated&sort=desc`;

      const options = {
        hostname: gitlabInstance,
        port: 443,
        path: path,
        method: 'GET',
        headers: {
          'User-Agent': 'vscode-gitlab-component-helper'
        }
      };

      outputChannel.appendLine(`[ComponentService] Making request to: https://${gitlabInstance}${path}`);

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const tags = JSON.parse(data);
              outputChannel.appendLine(`[ComponentService] Found ${tags.length} tags for ${projectPath}`);
              resolve(tags);
            } else {
              outputChannel.appendLine(`[ComponentService] Failed to fetch tags: ${res.statusCode} - ${data}`);
              resolve([]); // Return empty array instead of rejecting
            }
          } catch (error) {
            outputChannel.appendLine(`[ComponentService] Error parsing tags response: ${error}`);
            resolve([]); // Return empty array instead of rejecting
          }
        });
      });

      req.on('error', (error) => {
        outputChannel.appendLine(`[ComponentService] Error fetching tags: ${error}`);
        resolve([]); // Return empty array instead of rejecting
      });

      req.end();
    });
  }

  // ...existing code...

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
}

// Singleton instance
let serviceInstance: ComponentService | null = null;

export function getComponentService(): ComponentService {
  if (!serviceInstance) {
    serviceInstance = new ComponentService();
  }
  return serviceInstance;
}
