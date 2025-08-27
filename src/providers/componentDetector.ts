import * as vscode from 'vscode';
import { getComponentService } from '../services/componentService';
import { getComponentCacheManager } from '../services/componentCacheManager';
import { GitLabCatalogComponent, GitLabCatalogVariable } from '../types/gitlab-catalog';
import { expandGitLabVariables, containsGitLabVariables, detectGitLabVariables, expandComponentUrl } from '../utils/gitlabVariables';
import { Logger } from '../utils/logger';
import { spawn } from 'child_process';

const logger = Logger.getInstance();

// Update your Component interface to include the context property
export interface Component {
  name: string;
  description: string;
  parameters: ComponentParameter[];
  version?: string;
  source?: string;
  documentationUrl?: string;
  readme?: string; // Add README content as separate field
  url?: string; // Component URL
  gitlabInstance?: string; // GitLab instance
  sourcePath?: string; // Source path
  originalUrl?: string; // Original URL with variables (if any)
  // Add this context property that's needed by the hover provider
  context?: {
    gitlabInstance: string;
    path: string;
  };
}

export interface ComponentParameter {
  name: string;
  description: string;
  required: boolean;
  type: string;
  default?: any;
}

/**
 * Detects if the current line includes a component
 */
export async function detectComponent(document: vscode.TextDocument, position: vscode.Position): Promise<Component | null> {
  const line = document.lineAt(position.line).text;
  const componentService = getComponentService();
  const components = await componentService.getComponents();

  // Simple detection - check if line contains component: syntax
  for (const component of components) {
    if (line.includes(`component: ${component.name}`)) {
      return component;
    }
  }

  return null;
}

/**
 * Get the component at the current cursor position
 */
export async function getComponentUnderCursor(document: vscode.TextDocument, position: vscode.Position): Promise<Component | null> {
  // Check current line and a few lines above to find component context
  let lineNum = position.line;
  const maxLines = 5; // Check up to 5 lines above

  for (let i = 0; i <= Math.min(lineNum, maxLines); i++) {
    const checkLine = lineNum - i;
    const component = await detectComponent(document, new vscode.Position(checkLine, 0));
    if (component) {
      return component;
    }
  }

  return null;
}

export async function detectIncludeComponent(document: vscode.TextDocument, position: vscode.Position): Promise<Component | null> {
  const line = document.lineAt(position.line).text;
  logger.debug(`[ComponentDetector] Checking line for include component: ${line}`, 'ComponentDetector');

  // Extract component URL from the line - handle both absolute URLs and those with GitLab variables
  let componentUrl = line.match(/component:\s*([^\s]+)/)?.[1];
  if (!componentUrl) {
    logger.debug(`[ComponentDetector] No component URL found in line`, 'ComponentDetector');
    return null;
  }

  logger.debug(`[ComponentDetector] Detected component URL: ${componentUrl}`, 'ComponentDetector');
  const originalUrl = componentUrl; // Store original URL with variables
  if (containsGitLabVariables(componentUrl)) {
    const variables = detectGitLabVariables(componentUrl);
    logger.debug(`[ComponentDetector] Component URL contains GitLab variables: ${variables.join(', ')}`, 'ComponentDetector');

    // Try to get Git repository context first
    const gitContext = await getGitRepositoryContext();
    let expandedUrl = componentUrl;

    if (gitContext.gitlabInstance && gitContext.projectPath) {
      logger.debug(`[ComponentDetector] Using Git repository context: ${gitContext.gitlabInstance}/${gitContext.projectPath}`, 'ComponentDetector');
      const context = {
        gitlabInstance: gitContext.gitlabInstance,
        projectPath: gitContext.projectPath,
        serverUrl: `https://${gitContext.gitlabInstance}`,
        commitSha: gitContext.commitSha || 'main'
      };
      expandedUrl = expandComponentUrl(componentUrl, context);
      logger.debug(`[ComponentDetector] Expanded URL using Git context: ${expandedUrl}`, 'ComponentDetector');
    } else {
      logger.debug(`[ComponentDetector] No Git repository context found, checking for non-GitLab repository`, 'ComponentDetector');

      // Check if we're in a non-GitLab repository - if so, don't fall back to component sources
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        logger.debug(`[ComponentDetector] Found workspace folder: ${workspaceFolders[0].uri.fsPath}`, 'ComponentDetector');
        const nonGitlabInfo = await detectNonGitLabRepository(workspaceFolders[0]);
        logger.debug(`[ComponentDetector] Non-GitLab repository detection result: ${nonGitlabInfo ? JSON.stringify(nonGitlabInfo) : 'null'}`, 'ComponentDetector');

        if (nonGitlabInfo) {
          logger.debug(`[ComponentDetector] Detected non-GitLab repository (${nonGitlabInfo.hostname}), not using component sources for variable expansion`, 'ComponentDetector');
          // Return component with unresolved variables info
          const description = `This repository is hosted on ${nonGitlabInfo.hostname} (${nonGitlabInfo.type}). GitLab variables (${variables.join(', ')}) can only be expanded when working in a GitLab repository.`;

          return {
            name: `Component with unresolved variables`,
            description: description,
            parameters: [],
            source: 'Non-GitLab Repository',
            url: originalUrl,
            originalUrl: originalUrl,
            version: 'unknown',
            gitlabInstance: 'unknown',
            sourcePath: 'unknown'
          };
        }
      }

      logger.debug(`[ComponentDetector] No non-GitLab repository detected, falling back to configured component sources`, 'ComponentDetector');

      // Fallback to configured component sources only if we're not in a detected non-GitLab repository
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const componentSources = config.get<Array<{
        name: string;
        path: string;
        gitlabInstance?: string;
      }>>('componentSources', []);

      if (componentSources.length > 0) {
        const context = {
          gitlabInstance: componentSources[0].gitlabInstance || 'gitlab.com',
          projectPath: componentSources[0].path,
          serverUrl: `https://${componentSources[0].gitlabInstance || 'gitlab.com'}`
        };
        expandedUrl = expandComponentUrl(componentUrl, context);
        logger.debug(`[ComponentDetector] Expanded URL using configured sources: ${expandedUrl}`, 'ComponentDetector');
      } else {
        logger.debug(`[ComponentDetector] No Git context or component sources configured, cannot expand variables`, 'ComponentDetector');

        // Check if we're in a non-GitLab repository to provide better messaging
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let description = `Contains GitLab variables: ${variables.join(', ')}. `;

        if (workspaceFolders && workspaceFolders.length > 0) {
          const workspacePath = workspaceFolders[0].uri.fsPath;
          const rawGitContext = await getRawGitRepositoryContext(workspacePath);
          if (rawGitContext.gitlabInstance && !rawGitContext.gitlabInstance.includes('gitlab')) {
            description += `This project is hosted on ${rawGitContext.gitlabInstance}, not GitLab. GitLab Component Helper requires a GitLab repository to resolve CI/CD variables.`;
          } else {
            description += `No GitLab repository detected. Configure component sources or ensure this is a GitLab repository to resolve these variables.`;
          }
        } else {
          description += `No workspace folder found. Configure component sources to resolve GitLab variables.`;
        }

        // Return a fallback component with information about the variables
        return {
          name: `Component with variables`,
          description: description,
          parameters: [],
          source: 'GitLab Variables',
          url: originalUrl,
          originalUrl: originalUrl,
          version: 'unknown',
          gitlabInstance: 'unknown',
          sourcePath: 'unknown'
        };
      }
    }

    // Use the expanded URL for further processing
    componentUrl = expandedUrl;
  }

  // First, try to find the component in our cache
  const cacheManager = getComponentCacheManager();
  const cachedComponents = await cacheManager.getComponents();

  // Parse the requested component URL to extract name and details
  try {
    // GitLab component URLs are: https://gitlab.instance/project/path@version
    let requestedProjectPath: string;
    let requestedVersion: string | undefined;
    let requestedName: string;

    if (componentUrl.includes('@')) {
      // Split on @ to separate project path and version
      const urlParts = componentUrl.split('@');
      const baseUrl = urlParts[0];
      requestedVersion = urlParts[1];

      // Extract project path and component name from base URL
      const baseUrlObj = new URL(baseUrl);
      const fullPath = baseUrlObj.pathname.substring(1); // Remove leading slash
      const pathParts = fullPath.split('/');
      requestedName = pathParts.pop() || ''; // Component name is the last segment
      requestedProjectPath = pathParts.join('/'); // Project path is everything before the component name
    } else {
      // No version specified
      const requestedUrl = new URL(componentUrl);
      const fullPath = requestedUrl.pathname.substring(1); // Remove leading slash
      const pathParts = fullPath.split('/');
      requestedName = pathParts.pop() || ''; // Component name is the last segment
      requestedProjectPath = pathParts.join('/'); // Project path is everything before the component name
      requestedVersion = undefined;
    }

    const requestedGitlabInstance = new URL(componentUrl.split('@')[0]).hostname;

    logger.debug(`[ComponentDetector] Looking for component: ${requestedName} from ${requestedGitlabInstance}/${requestedProjectPath}${requestedVersion ? `@${requestedVersion}` : ''}`, 'ComponentDetector');

    // First, try to find an exact match (same name, project path, AND version)
    if (requestedVersion) {
      const exactMatch = cachedComponents.find(comp => {
        // For cached components, extract project path from sourcePath
        return (
          comp.gitlabInstance === requestedGitlabInstance &&
          comp.sourcePath === requestedProjectPath &&
          comp.name === requestedName &&
          comp.version === requestedVersion
        );
      });

      if (exactMatch) {
        logger.debug(`[ComponentDetector] Found exact version match in cache: ${exactMatch.name}@${exactMatch.version}`, 'ComponentDetector');
        return {
          name: exactMatch.name,
          description: exactMatch.description,
          parameters: exactMatch.parameters,
          version: exactMatch.version,
          source: `${exactMatch.gitlabInstance}/${exactMatch.sourcePath}`,
          url: componentUrl,
          originalUrl: originalUrl,
          gitlabInstance: exactMatch.gitlabInstance,
          sourcePath: exactMatch.sourcePath,
          context: {
            gitlabInstance: exactMatch.gitlabInstance,
            path: exactMatch.sourcePath
          }
        };
      }

      logger.debug(`[ComponentDetector] No exact version match found for ${requestedName}@${requestedVersion}`, 'ComponentDetector');
    }

    // If no exact match, look for any version of the same component
    const cachedComponent = cachedComponents.find(comp => {
      // Match by hostname, project path, and component name (ignoring version)
      return (
        comp.gitlabInstance === requestedGitlabInstance &&
        comp.sourcePath === requestedProjectPath &&
        comp.name === requestedName
      );
    });

    if (cachedComponent) {
      logger.debug(`[ComponentDetector] Found matching component in cache: ${cachedComponent.name}`, 'ComponentDetector');
      logger.debug(`[ComponentDetector] Cached version: ${cachedComponent.version}, Requested version: ${requestedVersion || 'unspecified'}`, 'ComponentDetector');

      // If the requested version matches the cached version, return cached data
      if (!requestedVersion || requestedVersion === cachedComponent.version) {
        logger.debug(`[ComponentDetector] Version matches cache, returning cached component`, 'ComponentDetector');
        return {
          name: cachedComponent.name,
          description: cachedComponent.description,
          parameters: cachedComponent.parameters,
          version: cachedComponent.version,
          source: `${cachedComponent.gitlabInstance}/${cachedComponent.sourcePath}`,
          url: componentUrl,
          originalUrl: originalUrl,
          gitlabInstance: cachedComponent.gitlabInstance,
          sourcePath: cachedComponent.sourcePath,
          context: {
            gitlabInstance: cachedComponent.gitlabInstance,
            path: cachedComponent.sourcePath
          }
        };
      }

      // If versions differ, try to fetch the specific version
      logger.debug(`[ComponentDetector] Version mismatch (cached: ${cachedComponent.version}, requested: ${requestedVersion}), attempting to fetch specific version`, 'ComponentDetector');

      try {
        const componentService = getComponentService();
        const specificVersionComponent = await componentService.getComponentFromUrl(componentUrl);

        if (specificVersionComponent) {
          logger.debug(`[ComponentDetector] Successfully fetched specific version ${requestedVersion} for ${cachedComponent.name}`, 'ComponentDetector');

          // Add the specific version to cache for future use
          cacheManager.addDynamicComponent({
            name: specificVersionComponent.name,
            description: specificVersionComponent.description,
            parameters: specificVersionComponent.parameters,
            version: requestedVersion || 'main',
            url: componentUrl,
            gitlabInstance: requestedGitlabInstance,
            sourcePath: requestedProjectPath,
            source: `${requestedGitlabInstance}/${requestedProjectPath}`
          });

          return specificVersionComponent;
        } else {
          logger.debug(`[ComponentDetector] Failed to fetch specific version, falling back to cached version with note`, 'ComponentDetector');
        }
      } catch (error) {
        logger.debug(`[ComponentDetector] Error fetching specific version: ${error}, falling back to cached version`, 'ComponentDetector');
      }

      // Fallback to cached version with a note about the version difference
      return {
        name: cachedComponent.name,
        description: cachedComponent.description +
                    `\n\n**Note:** Showing cached version ${cachedComponent.version}, but you requested ${requestedVersion}. Component details may differ between versions.`,
        parameters: cachedComponent.parameters,
        version: requestedVersion,
        source: `${cachedComponent.gitlabInstance}/${cachedComponent.sourcePath}`,
        context: {
          gitlabInstance: cachedComponent.gitlabInstance,
          path: cachedComponent.sourcePath
        }
      };
    }

    logger.debug(`[ComponentDetector] No matching component found in cache for ${requestedName} from ${requestedGitlabInstance}/${requestedProjectPath}`, 'ComponentDetector');
  } catch (urlError) {
    logger.debug(`[ComponentDetector] Error parsing component URL for cache lookup: ${urlError}`, 'ComponentDetector');

    // Fallback to exact URL matching if URL parsing fails
    const cachedComponent = cachedComponents.find(comp => comp.url === componentUrl);
    if (cachedComponent) {
      logger.debug(`[ComponentDetector] Found component via exact URL match: ${cachedComponent.name}`, 'ComponentDetector');
      return {
        name: cachedComponent.name,
        description: cachedComponent.description,
        parameters: cachedComponent.parameters,
        version: cachedComponent.version,
        source: `${cachedComponent.gitlabInstance}/${cachedComponent.sourcePath}`,
        url: componentUrl,
        originalUrl: originalUrl,
        gitlabInstance: cachedComponent.gitlabInstance,
        sourcePath: cachedComponent.sourcePath,
        context: {
          gitlabInstance: cachedComponent.gitlabInstance,
          path: cachedComponent.sourcePath
        }
      };
    }
  }

  logger.debug(`[ComponentDetector] Component not found in cache. Attempting dynamic fetch...`, 'ComponentDetector');

  // Try to fetch the component dynamically before falling back
  try {
    const dynamicComponent = await fetchComponentDynamically(componentUrl, originalUrl);
    if (dynamicComponent) {
      logger.debug(`[ComponentDetector] Successfully fetched component dynamically: ${dynamicComponent.name}`, 'ComponentDetector');
      return dynamicComponent;
    }
  } catch (fetchError) {
    logger.debug(`[ComponentDetector] Failed to fetch component dynamically: ${fetchError}`, 'ComponentDetector');
  }

  // Check if we can extract basic information from the URL for fallback display
  try {
    // Parse GitLab component URL correctly
    let projectPath: string;
    let version: string | undefined;
    let componentName: string;
    let gitlabInstance: string;

    if (componentUrl.includes('@')) {
      // Split on @ to separate project path and version
      const urlParts = componentUrl.split('@');
      const baseUrl = urlParts[0];
      version = urlParts[1];

      // Extract project path and component name from base URL
      const baseUrlObj = new URL(baseUrl);
      const fullPath = baseUrlObj.pathname.substring(1); // Remove leading slash
      const pathParts = fullPath.split('/');
      componentName = pathParts.pop() || ''; // Component name is the last segment
      projectPath = pathParts.join('/'); // Project path is everything before the component name
      gitlabInstance = baseUrlObj.hostname;
    } else {
      // No version specified
      const url = new URL(componentUrl);
      const fullPath = url.pathname.substring(1); // Remove leading slash
      const pathParts = fullPath.split('/');
      componentName = pathParts.pop() || ''; // Component name is the last segment
      projectPath = pathParts.join('/'); // Project path is everything before the component name
      gitlabInstance = url.hostname;
      version = undefined;
    }

    logger.debug(`[ComponentDetector] Providing basic fallback info for uncached component: ${componentName} from ${gitlabInstance}/${projectPath}`, 'ComponentDetector');

    return {
      name: componentName,
      description: `**Component not in cache**\n\nURL: ${componentUrl}\n\n❌ **Auto-fetch failed**: Could not retrieve component details automatically.\n\nThis could be due to:\n- Network connectivity issues\n- Private repository access restrictions\n- Component not found at the specified location\n\nTry refreshing the component cache using the "GitLab Component Helper: Refresh Components" command to get full details.`,
      parameters: [],
      version: version,
      source: `${gitlabInstance}/${projectPath}`,
      url: componentUrl,
      originalUrl: originalUrl,
      gitlabInstance: gitlabInstance,
      sourcePath: projectPath,
      context: {
        gitlabInstance: gitlabInstance,
        path: projectPath
      }
    };
  } catch (error) {
    logger.debug(`[ComponentDetector] Error parsing component URL ${componentUrl}: ${error}`, 'ComponentDetector');

    return {
      name: componentUrl,
      description: `**Component not in cache**\n\nURL: ${componentUrl}\n\n❌ **Auto-fetch failed**: Error parsing component URL.\n\nThe component URL format appears to be invalid. Please check the URL format and try refreshing the component cache using the "GitLab Component Helper: Refresh Components" command.`,
      parameters: [],
      url: componentUrl,
      originalUrl: originalUrl,
      context: {
        gitlabInstance: 'unknown',
        path: 'unknown'
      }
    };
  }
}

/**
 * Dynamically fetch a component that's not in the cache
 */
async function fetchComponentDynamically(componentUrl: string, originalUrl?: string): Promise<Component | null> {
  try {
    logger.debug(`[ComponentDetector] Attempting to fetch component: ${componentUrl}`, 'ComponentDetector');

    // Parse the component URL to extract information
    // GitLab component URLs are: https://gitlab.instance/project/path/component@version
    const url = new URL(componentUrl);

    // Split the pathname and check if it contains @ for version
    let projectPath: string;
    let version: string;
    let componentName: string;

    if (componentUrl.includes('@')) {
      // Split on @ to separate project path and version
      const urlParts = componentUrl.split('@');
      const baseUrl = urlParts[0];
      version = urlParts[1];

      // Extract project path from base URL
      const baseUrlObj = new URL(baseUrl);
      const fullPath = baseUrlObj.pathname.substring(1); // Remove leading slash
      const pathParts = fullPath.split('/');
      componentName = pathParts.pop() || ''; // Component name is the last segment
      projectPath = pathParts.join('/'); // Project path is everything before the component name
    } else {
      // No version specified, use main/latest
      const fullPath = url.pathname.substring(1); // Remove leading slash
      const pathParts = fullPath.split('/');
      componentName = pathParts.pop() || ''; // Component name is the last segment
      projectPath = pathParts.join('/'); // Project path is everything before the component name
      version = 'main';
    }

    const gitlabInstance = url.hostname;

    logger.debug(`[ComponentDetector] Parsed GitLab project: ${gitlabInstance}/${projectPath}@${version}`, 'ComponentDetector');
    logger.debug(`[ComponentDetector] Looking for component named: ${componentName}`, 'ComponentDetector');

    // Use the component service to fetch catalog data
    const componentService = getComponentService();
    const catalogData = await componentService.fetchCatalogData(gitlabInstance, projectPath, true);

    if (!catalogData || !catalogData.components) {
      logger.debug(`[ComponentDetector] No catalog data found for ${gitlabInstance}/${projectPath}`, 'ComponentDetector');
      return null;
    }

    // Find the specific component
    const foundComponent = catalogData.components.find((comp: GitLabCatalogComponent) => comp.name === componentName);
    if (!foundComponent) {
      logger.debug(`[ComponentDetector] Component ${componentName} not found in catalog. Available components: ${catalogData.components.map((c: GitLabCatalogComponent) => c.name).join(', ')}`, 'ComponentDetector');
      return null;
    }

    // Convert to our Component interface
    const dynamicComponent: Component = {
      name: foundComponent.name,
      description: foundComponent.description || `Component ${componentName} from ${projectPath}`,
      parameters: (foundComponent.variables || []).map((v: GitLabCatalogVariable) => ({
        name: v.name,
        description: v.description || `Parameter: ${v.name}`,
        required: v.required || false,
        type: v.type || 'string',
        default: v.default
      })),
      version: version,
      source: `${gitlabInstance}/${projectPath}`,
      url: componentUrl,
      originalUrl: originalUrl || componentUrl,
      gitlabInstance: gitlabInstance,
      sourcePath: projectPath,
      documentationUrl: foundComponent.documentation_url,
      readme: (foundComponent as any).readme, // Include README content
      context: {
        gitlabInstance: gitlabInstance,
        path: projectPath
      }
    };

    // Add to cache for future use
    try {
      const cacheManager = getComponentCacheManager();
      const cacheComponent = {
        name: foundComponent.name,
        description: foundComponent.description || `Component ${componentName} from ${projectPath}`,
        parameters: (foundComponent.variables || []).map((v: GitLabCatalogVariable) => ({
          name: v.name,
          description: v.description || `Parameter: ${v.name}`,
          required: v.required || false,
          type: v.type || 'string',
          default: v.default
        })),
        source: `${gitlabInstance}/${projectPath}`,
        sourcePath: projectPath,
        gitlabInstance: gitlabInstance,
        version: version,
        url: componentUrl
      };

      cacheManager.addDynamicComponent(cacheComponent);
      logger.debug(`[ComponentDetector] Added dynamically fetched component to cache: ${componentName}@${version}`, 'ComponentDetector');
    } catch (cacheError) {
      logger.debug(`[ComponentDetector] Could not add to cache: ${cacheError}`, 'ComponentDetector');
    }

    return dynamicComponent;

  } catch (error) {
    logger.debug(`[ComponentDetector] Error in dynamic fetch: ${error}`, 'ComponentDetector');
    return null;
  }
}

/**
 * Get Git repository context for variable expansion
 */
async function getGitRepositoryContext(): Promise<{
  gitlabInstance?: string;
  projectPath?: string;
  commitSha?: string;
}> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return {};
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;

    // Use VS Code's Git extension API if available
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
      const git = gitExtension.exports.getAPI(1);
      if (git && git.repositories.length > 0) {
        const repo = git.repositories.find((r: any) =>
          workspacePath.startsWith(r.rootUri.fsPath)
        ) || git.repositories[0];

        if (repo) {
          // Get remote URLs
          const remotes = repo.state.remotes;
          const origin = remotes.find((r: any) => r.name === 'origin') || remotes[0];

          if (origin && origin.fetchUrl) {
            const gitlabInfo = parseGitLabRemoteUrl(origin.fetchUrl);
            if (gitlabInfo) {
              // Try to get current commit SHA
              let commitSha = 'main';
              try {
                if (repo.state.HEAD && repo.state.HEAD.commit) {
                  commitSha = repo.state.HEAD.commit;
                } else if (repo.state.HEAD && repo.state.HEAD.name) {
                  commitSha = repo.state.HEAD.name;
                }
              } catch (error) {
                logger.debug(`[ComponentDetector] Could not get commit SHA: ${error}`, 'ComponentDetector');
              }

              return {
                gitlabInstance: gitlabInfo.gitlabInstance,
                projectPath: gitlabInfo.projectPath,
                commitSha: commitSha
              };
            }
          }
        }
      }
    }

    return {};
  } catch (error) {
    logger.debug(`[ComponentDetector] Error getting Git repository context: ${error}`, 'ComponentDetector');
    return {};
  }
}

/**
 * Parse GitLab remote URL to extract instance and project path
 */
function parseGitLabRemoteUrl(remoteUrl: string): { gitlabInstance: string; projectPath: string } | null {
  try {
    // Handle both HTTPS and SSH URLs
    // HTTPS: https://gitlab.com/owner/repo.git
    // SSH: git@gitlab.com:owner/repo.git

    let gitlabInstance: string;
    let projectPath: string;

    if (remoteUrl.startsWith('https://')) {
      const url = new URL(remoteUrl);
      gitlabInstance = url.hostname;
      projectPath = url.pathname.substring(1).replace(/\.git$/, '');
    } else if (remoteUrl.startsWith('git@')) {
      // git@gitlab.com:owner/repo.git
      const match = remoteUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
      if (match) {
        gitlabInstance = match[1];
        projectPath = match[2];
      } else {
        return null;
      }
    } else {
      return null;
    }

    // Only return for GitLab instances - this extension is specifically for GitLab
    if (gitlabInstance.includes('gitlab')) {
      return { gitlabInstance, projectPath };
    }

    // For non-GitLab repositories, log but don't use for GitLab variable expansion
    logger.debug(`[ComponentDetector] Detected non-GitLab repository: ${gitlabInstance}. GitLab Component Helper requires a GitLab repository.`, 'ComponentDetector');
    return null;
  } catch (error) {
    logger.debug(`[ComponentDetector] Error parsing Git remote URL: ${error}`, 'ComponentDetector');
    return null;
  }
}

/**
 * Get raw Git repository context (including non-GitLab repositories)
 */
async function getRawGitRepositoryContext(workspacePath: string): Promise<{
  gitlabInstance?: string;
  projectPath?: string;
  commitSha?: string;
}> {
  try {
    // Use VS Code's Git extension API if available
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
      const git = gitExtension.exports.getAPI(1);
      if (git && git.repositories.length > 0) {
        const repo = git.repositories.find((r: any) =>
          workspacePath.startsWith(r.rootUri.fsPath)
        ) || git.repositories[0];

        if (repo) {
          // Get remote URLs
          const remotes = repo.state.remotes;
          const origin = remotes.find((r: any) => r.name === 'origin') || remotes[0];

          if (origin && origin.fetchUrl) {
            const repoInfo = parseAnyRemoteUrl(origin.fetchUrl);
            if (repoInfo) {
              return {
                gitlabInstance: repoInfo.gitlabInstance,
                projectPath: repoInfo.projectPath,
                commitSha: 'main'
              };
            }
          }
        }
      }
    }

    return {};
  } catch (error) {
    logger.debug(`[ComponentDetector] Error getting raw Git repository context: ${error}`, 'ComponentDetector');
    return {};
  }
}

/**
 * Parse any Git remote URL to extract instance and project path (not just GitLab)
 */
function parseAnyRemoteUrl(remoteUrl: string): { gitlabInstance: string; projectPath: string } | null {
  try {
    // Handle both HTTPS and SSH URLs
    // HTTPS: https://github.com/owner/repo.git
    // SSH: git@github.com:owner/repo.git

    let gitlabInstance: string;
    let projectPath: string;

    if (remoteUrl.startsWith('https://')) {
      const url = new URL(remoteUrl);
      gitlabInstance = url.hostname;
      projectPath = url.pathname.substring(1).replace(/\.git$/, '');
    } else if (remoteUrl.startsWith('git@')) {
      // git@github.com:owner/repo.git
      const match = remoteUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
      if (match) {
        gitlabInstance = match[1];
        projectPath = match[2];
      } else {
        return null;
      }
    } else {
      return null;
    }

    // Return any valid-looking Git repository info
    if (gitlabInstance && projectPath.includes('/')) {
      return { gitlabInstance, projectPath };
    }

    return null;
  } catch (error) {
    logger.debug(`[ComponentDetector] Error parsing any remote URL: ${error}`, 'ComponentDetector');
    return null;
  }
}

/**
 * Detect if we're in a non-GitLab repository (GitHub, Bitbucket, etc.)
 */
async function detectNonGitLabRepository(workspaceFolder: vscode.WorkspaceFolder): Promise<{ hostname: string; projectPath: string; type: string } | null> {
    try {
        logger.debug(`[ComponentDetector] Detecting non-GitLab repository for workspace: ${workspaceFolder.uri.fsPath}`, 'ComponentDetector');

        // First try VS Code's Git extension API
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            const git = gitExtension.exports.getAPI(1);
            if (git && git.repositories.length > 0) {
                logger.debug(`[ComponentDetector] Found ${git.repositories.length} Git repositories via VS Code Git API`, 'ComponentDetector');

                // Find a repository that contains or is contained by the workspace folder
                let repo = git.repositories.find((r: any) =>
                    workspaceFolder.uri.fsPath.startsWith(r.rootUri.fsPath) ||
                    r.rootUri.fsPath.startsWith(workspaceFolder.uri.fsPath)
                );

                if (!repo) {
                    repo = git.repositories[0];
                    logger.debug(`[ComponentDetector] No matching repository found, using first available: ${repo.rootUri.fsPath}`, 'ComponentDetector');
                } else {
                    logger.debug(`[ComponentDetector] Using Git repository: ${repo.rootUri.fsPath}`, 'ComponentDetector');
                }

                // Get remote URLs from VS Code Git API
                const remotes = repo.state.remotes;
                const origin = remotes.find((r: any) => r.name === 'origin') || remotes[0];

                if (origin && origin.fetchUrl) {
                    logger.debug(`[ComponentDetector] Found origin remote via VS Code Git API: ${origin.fetchUrl}`, 'ComponentDetector');
                    return await parseAndClassifyRepository(origin.fetchUrl);
                }
            }
        }

        // Fallback to direct Git commands if VS Code Git API doesn't work
        logger.debug(`[ComponentDetector] VS Code Git API not available or no repositories found, trying direct Git commands`, 'ComponentDetector');
        return await detectRepositoryViaGitCommands(workspaceFolder.uri.fsPath);

    } catch (error) {
        logger.debug(`[ComponentDetector] Error detecting non-GitLab repository: ${error}`, 'ComponentDetector');
        return null;
    }
}

/**
 * Use direct Git commands to detect repository information
 */
async function detectRepositoryViaGitCommands(workspacePath: string): Promise<{ hostname: string; projectPath: string; type: string } | null> {
    try {
        // First, check if we're in a Git repository
        const isGitRepo = await new Promise<boolean>((resolve) => {
            const gitCheck = spawn('git', ['rev-parse', '--is-inside-work-tree'], {
                cwd: workspacePath,
                stdio: 'pipe'
            });

            gitCheck.on('exit', (code: number | null) => {
                resolve(code === 0);
            });

            gitCheck.on('error', () => {
                resolve(false);
            });
        });

        if (!isGitRepo) {
            logger.debug(`[ComponentDetector] Not inside a Git repository`, 'ComponentDetector');
            return null;
        }

        logger.debug(`[ComponentDetector] Confirmed we're in a Git repository`, 'ComponentDetector');

        // Get the remote origin URL
        const remoteUrl = await new Promise<string | null>((resolve) => {
            const gitRemote = spawn('git', ['remote', 'get-url', 'origin'], {
                cwd: workspacePath,
                stdio: 'pipe'
            });

            let output = '';
            gitRemote.stdout.on('data', (data: Buffer) => {
                output += data.toString();
            });

            gitRemote.on('exit', (code: number | null) => {
                if (code === 0 && output.trim()) {
                    resolve(output.trim());
                } else {
                    resolve(null);
                }
            });

            gitRemote.on('error', () => {
                resolve(null);
            });
        });

        if (!remoteUrl) {
            logger.debug(`[ComponentDetector] No origin remote found`, 'ComponentDetector');
            return null;
        }

        logger.debug(`[ComponentDetector] Found origin remote via Git command: ${remoteUrl}`, 'ComponentDetector');
        return await parseAndClassifyRepository(remoteUrl);

    } catch (error) {
        logger.debug(`[ComponentDetector] Error using Git commands: ${error}`, 'ComponentDetector');
        return null;
    }
}

/**
 * Parse and classify a Git remote URL
 */
async function parseAndClassifyRepository(remoteUrl: string): Promise<{ hostname: string; projectPath: string; type: string } | null> {
    try {
        const repoInfo = parseNonGitLabRemoteUrl(remoteUrl);
        if (!repoInfo) {
            logger.debug(`[ComponentDetector] Failed to parse remote URL: ${remoteUrl}`, 'ComponentDetector');
            return null;
        }

        logger.debug(`[ComponentDetector] Parsed repository info: hostname=${repoInfo.hostname}, projectPath=${repoInfo.projectPath}`, 'ComponentDetector');

        // Check if this is NOT a GitLab repository
        const isGitLab = repoInfo.hostname.toLowerCase().includes('gitlab');
        logger.debug(`[ComponentDetector] Is GitLab repository: ${isGitLab}`, 'ComponentDetector');

        if (!isGitLab) {
            let type = 'Git Repository';
            if (repoInfo.hostname.includes('github')) {
                type = 'GitHub';
            } else if (repoInfo.hostname.includes('bitbucket')) {
                type = 'Bitbucket';
            }

            logger.debug(`[ComponentDetector] Detected non-GitLab repository: ${repoInfo.hostname} (${type})`, 'ComponentDetector');
            return {
                hostname: repoInfo.hostname,
                projectPath: repoInfo.projectPath,
                type: type
            };
        }

        logger.debug(`[ComponentDetector] This is a GitLab repository, not returning non-GitLab info`, 'ComponentDetector');
        return null;
    } catch (error) {
        logger.debug(`[ComponentDetector] Error parsing and classifying repository: ${error}`, 'ComponentDetector');
        return null;
    }
}

/**
 * Parse any Git remote URL to extract hostname and project path (for detection purposes)
 */
function parseNonGitLabRemoteUrl(remoteUrl: string): { hostname: string; projectPath: string } | null {
    try {
        // Handle both HTTPS and SSH URLs
        let hostname: string;
        let projectPath: string;

        if (remoteUrl.startsWith('https://')) {
            const url = new URL(remoteUrl);
            hostname = url.hostname;
            projectPath = url.pathname.substring(1).replace(/\.git$/, '');
        } else if (remoteUrl.startsWith('git@')) {
            // git@github.com:owner/repo.git
            const match = remoteUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
            if (match) {
                hostname = match[1];
                projectPath = match[2];
            } else {
                return null;
            }
        } else {
            return null;
        }

        // Return any valid-looking Git repository info
        if (hostname && projectPath.includes('/')) {
            return { hostname, projectPath };
        }

        return null;
    } catch (error) {
        logger.debug(`[ComponentDetector] Error parsing remote URL for detection: ${error}`, 'ComponentDetector');
        return null;
    }
}
