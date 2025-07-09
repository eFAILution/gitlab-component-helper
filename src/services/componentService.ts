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

      // Declare these variables only once
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

      // Fetch project information
      const projectInfo = await this.fetchJson(projectApiUrl);

      // The component template is expected to be in templates/component-name.yml
      const templatePath = `templates/${componentName}.yml`;
      console.log(`Looking for component template at: ${templatePath}`);

      // Fetch the component template file
      try {
        const templateUrl = `${apiBaseUrl}/projects/${projectInfo.id}/repository/files/${encodeURIComponent(templatePath)}/raw?ref=${version}`;
        templateContent = await this.fetchText(templateUrl);
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
      } catch (error) {
        console.log(`Could not fetch component template: ${error}`);
      }

      // Try to find a README or documentation for the component
      try {
        // First check if there's a component-specific README
        const componentReadmePath = `docs/${componentName}/README.md`;
        try {
          const readmeUrl = `${apiBaseUrl}/projects/${projectInfo.id}/repository/files/${encodeURIComponent(componentReadmePath)}/raw?ref=${version}`;
          readmeContent = await this.fetchText(readmeUrl);
        } catch (e) {
          // Then try the project README
          const projectReadmeUrl = `${apiBaseUrl}/projects/${projectInfo.id}/repository/files/README.md/raw?ref=${version}`;
          readmeContent = await this.fetchText(projectReadmeUrl);
        }
      } catch (error) {
        console.log(`Could not fetch README: ${error}`);
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
          } else {
            reject(`HTTP error ${res.statusCode}`);
          }
        });
      }).on('error', reject);
    });
  }

  private fetchText(url: string): Promise<string> {
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
          } else {
            reject(`HTTP error ${res.statusCode}`);
          }
        });
      }).on('error', reject);
    });
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

  private catalogCache = new Map<string, any>();

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
      // First, get the project info to get the project ID
      const projectApiUrl = `https://${cleanGitlabInstance}/api/v4/projects/${encodeURIComponent(projectPath)}`;
      outputChannel.appendLine(`[ComponentService] Fetching project info from: ${projectApiUrl}`);
      const projectInfo = await this.fetchJson(projectApiUrl);
      outputChannel.appendLine(`[ComponentService] Found project: ${projectInfo.name} (ID: ${projectInfo.id})`);

      // Then look for components in the templates directory
      const ref = version || 'main'; // Use specific version or default to main
      const templatesUrl = `https://${cleanGitlabInstance}/api/v4/projects/${projectInfo.id}/repository/tree?path=templates&ref=${ref}`;
      outputChannel.appendLine(`[ComponentService] Fetching templates from: ${templatesUrl} (ref: ${ref})`);
      const templates = await this.fetchJson(templatesUrl) as GitLabTreeItem[];
      outputChannel.appendLine(`[ComponentService] Found ${templates.length} items in templates directory`);

      // Transform the templates into components
      const yamlFiles = templates.filter((file: GitLabTreeItem) => file.name.endsWith('.yml') || file.name.endsWith('.yaml'));
      outputChannel.appendLine(`[ComponentService] Found ${yamlFiles.length} YAML template files`);

      const components = await Promise.all(yamlFiles
        .map(async (file: GitLabTreeItem) => {
          // Remove the .yml extension to get component name
          const name = file.name.replace(/\.ya?ml$/, '');
          outputChannel.appendLine(`[ComponentService] Processing component: ${name} (${file.name})`);

          // Try to get component content to extract info
          const contentUrl = `https://${cleanGitlabInstance}/api/v4/projects/${projectInfo.id}/repository/files/${encodeURIComponent('templates/' + file.name)}/raw?ref=main`;
          let description = '';
          let variables: ComponentVariable[] = [];
          let readmeContent = '';

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

            // 3. Try to fetch README if available
            try {
              const readmeUrl = `https://${cleanGitlabInstance}/api/v4/projects/${projectInfo.id}/repository/files/README.md/raw?ref=main`;
              readmeContent = await this.fetchText(readmeUrl);
              outputChannel.appendLine(`[ComponentService] Fetched README for ${name} (${readmeContent.length} chars)`);

              // If no description yet, extract from README
              if (!description) {
                // Extract first meaningful line from README (skip title, get first paragraph)
                const readmeLines = readmeContent.split('\n').filter(line => line.trim());
                for (const line of readmeLines) {
                  const trimmed = line.trim();
                  if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('[') && trimmed.length > 20) {
                    description = trimmed;
                    outputChannel.appendLine(`[ComponentService] Found README description for ${name}: ${description.substring(0, 100)}...`);
                    break;
                  }
                }
              }
            } catch (readmeError) {
              outputChannel.appendLine(`[ComponentService] No README found for ${name}`);
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
            latest_version: 'main',
            readme: readmeContent
          };
        }));

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

      // Fetch both tags and branches
      const versions: string[] = [];

      // Fetch tags (releases)
      try {
        const tagsUrl = `${apiBaseUrl}/projects/${projectInfo.id}/repository/tags?per_page=100&sort=desc`;
        const tags = await this.fetchJson(tagsUrl);

        if (Array.isArray(tags)) {
          const tagVersions = tags.map((tag: any) => tag.name).filter((name: string) => name);
          versions.push(...tagVersions);
          outputChannel.appendLine(`[ComponentService] Found ${tagVersions.length} tags`);
        }
      } catch (error) {
        outputChannel.appendLine(`[ComponentService] Error fetching tags: ${error}`);
      }

      // Fetch main branches (main, master, develop)
      try {
        const branchesUrl = `${apiBaseUrl}/projects/${projectInfo.id}/repository/branches?per_page=20`;
        const branches = await this.fetchJson(branchesUrl);

        if (Array.isArray(branches)) {
          const importantBranches = branches
            .map((branch: any) => branch.name)
            .filter((name: string) => ['main', 'master', 'develop', 'dev'].includes(name));
          versions.push(...importantBranches);
          outputChannel.appendLine(`[ComponentService] Found ${importantBranches.length} important branches`);
        }
      } catch (error) {
        outputChannel.appendLine(`[ComponentService] Error fetching branches: ${error}`);
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
