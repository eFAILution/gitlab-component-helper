import * as vscode from 'vscode';
import { getComponentService } from '../services/componentService';
import { getComponentCacheManager } from '../services/componentCacheManager';
import { outputChannel } from '../utils/outputChannel';
import { GitLabCatalogComponent, GitLabCatalogVariable } from '../types/gitlab-catalog';
import { expandGitLabVariables, containsGitLabVariables, detectGitLabVariables, expandComponentUrl } from '../utils/gitlabVariables';

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
  outputChannel.appendLine(`[ComponentDetector] Checking line for include component: ${line}`);

  // Extract component URL from the line - handle both absolute URLs and those with GitLab variables
  let componentUrl = line.match(/component:\s*([^\s]+)/)?.[1];
  if (!componentUrl) {
    outputChannel.appendLine(`[ComponentDetector] No component URL found in line`);
    return null;
  }

  outputChannel.appendLine(`[ComponentDetector] Detected component URL: ${componentUrl}`);  // Check if the URL contains GitLab variables
  const originalUrl = componentUrl; // Store original URL with variables
  if (containsGitLabVariables(componentUrl)) {
    const variables = detectGitLabVariables(componentUrl);
    outputChannel.appendLine(`[ComponentDetector] Component URL contains GitLab variables: ${variables.join(', ')}`);

    // Try to expand variables based on available context
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const componentSources = config.get<Array<{
      name: string;
      path: string;
      gitlabInstance?: string;
    }>>('componentSources', []);

    // Use the first configured source as context for variable expansion
    let expandedUrl = componentUrl;
    if (componentSources.length > 0) {
      const context = {
        gitlabInstance: componentSources[0].gitlabInstance || 'gitlab.com',
        projectPath: componentSources[0].path,
        serverUrl: `https://${componentSources[0].gitlabInstance || 'gitlab.com'}`
      };
      expandedUrl = expandComponentUrl(componentUrl, context);
      outputChannel.appendLine(`[ComponentDetector] Expanded URL: ${expandedUrl}`);
    } else {
      outputChannel.appendLine(`[ComponentDetector] No component sources configured, cannot expand variables`);
      // Return a fallback component with information about the variables
      return {
        name: `Component with variables`,
        description: `Contains GitLab variables: ${variables.join(', ')}. Configure component sources to resolve these variables.`,
        parameters: [],
        source: 'GitLab Variables',
        url: originalUrl,
        originalUrl: originalUrl,
        version: 'unknown',
        gitlabInstance: 'unknown',
        sourcePath: 'unknown'
      };
    }

    // Use the expanded URL for further processing
    componentUrl = expandedUrl;
  }

  // First, try to find the component in our cache
  const cacheManager = getComponentCacheManager();
  const cachedComponents = await cacheManager.getLegacyComponents(); // Use legacy format for backward compatibility

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

    outputChannel.appendLine(`[ComponentDetector] Looking for component: ${requestedName} from ${requestedGitlabInstance}/${requestedProjectPath}${requestedVersion ? `@${requestedVersion}` : ''}`);

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
        outputChannel.appendLine(`[ComponentDetector] Found exact version match in cache: ${exactMatch.name}@${exactMatch.version}`);
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

      outputChannel.appendLine(`[ComponentDetector] No exact version match found for ${requestedName}@${requestedVersion}`);
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
      outputChannel.appendLine(`[ComponentDetector] Found matching component in cache: ${cachedComponent.name}`);
      outputChannel.appendLine(`[ComponentDetector] Cached version: ${cachedComponent.version}, Requested version: ${requestedVersion || 'unspecified'}`);

      // If the requested version matches the cached version, return cached data
      if (!requestedVersion || requestedVersion === cachedComponent.version) {
        outputChannel.appendLine(`[ComponentDetector] Version matches cache, returning cached component`);
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
      outputChannel.appendLine(`[ComponentDetector] Version mismatch (cached: ${cachedComponent.version}, requested: ${requestedVersion}), attempting to fetch specific version`);

      try {
        const componentService = getComponentService();
        const specificVersionComponent = await componentService.getComponentFromUrl(componentUrl);

        if (specificVersionComponent) {
          outputChannel.appendLine(`[ComponentDetector] Successfully fetched specific version ${requestedVersion} for ${cachedComponent.name}`);

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
          outputChannel.appendLine(`[ComponentDetector] Failed to fetch specific version, falling back to cached version with note`);
        }
      } catch (error) {
        outputChannel.appendLine(`[ComponentDetector] Error fetching specific version: ${error}, falling back to cached version`);
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

    outputChannel.appendLine(`[ComponentDetector] No matching component found in cache for ${requestedName} from ${requestedGitlabInstance}/${requestedProjectPath}`);
  } catch (urlError) {
    outputChannel.appendLine(`[ComponentDetector] Error parsing component URL for cache lookup: ${urlError}`);

    // Fallback to exact URL matching if URL parsing fails
    const cachedComponent = cachedComponents.find(comp => comp.url === componentUrl);
    if (cachedComponent) {
      outputChannel.appendLine(`[ComponentDetector] Found component via exact URL match: ${cachedComponent.name}`);
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

  outputChannel.appendLine(`[ComponentDetector] Component not found in cache. Attempting dynamic fetch...`);

  // Try to fetch the component dynamically before falling back
  try {
    const dynamicComponent = await fetchComponentDynamically(componentUrl, originalUrl);
    if (dynamicComponent) {
      outputChannel.appendLine(`[ComponentDetector] Successfully fetched component dynamically: ${dynamicComponent.name}`);
      return dynamicComponent;
    }
  } catch (fetchError) {
    outputChannel.appendLine(`[ComponentDetector] Failed to fetch component dynamically: ${fetchError}`);
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

    outputChannel.appendLine(`[ComponentDetector] Providing basic fallback info for uncached component: ${componentName} from ${gitlabInstance}/${projectPath}`);

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
    outputChannel.appendLine(`[ComponentDetector] Error parsing component URL ${componentUrl}: ${error}`);

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
    outputChannel.appendLine(`[ComponentDetector] Attempting to fetch component: ${componentUrl}`);

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

    outputChannel.appendLine(`[ComponentDetector] Parsed GitLab project: ${gitlabInstance}/${projectPath}@${version}`);
    outputChannel.appendLine(`[ComponentDetector] Looking for component named: ${componentName}`);

    // Use the component service to fetch catalog data
    const componentService = getComponentService();
    const catalogData = await componentService.fetchCatalogData(gitlabInstance, projectPath, true);

    if (!catalogData || !catalogData.components) {
      outputChannel.appendLine(`[ComponentDetector] No catalog data found for ${gitlabInstance}/${projectPath}`);
      return null;
    }

    // Find the specific component
    const foundComponent = catalogData.components.find((comp: GitLabCatalogComponent) => comp.name === componentName);
    if (!foundComponent) {
      outputChannel.appendLine(`[ComponentDetector] Component ${componentName} not found in catalog. Available components: ${catalogData.components.map((c: GitLabCatalogComponent) => c.name).join(', ')}`);
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
      outputChannel.appendLine(`[ComponentDetector] Added dynamically fetched component to cache: ${componentName}@${version}`);
    } catch (cacheError) {
      outputChannel.appendLine(`[ComponentDetector] Could not add to cache: ${cacheError}`);
    }

    return dynamicComponent;

  } catch (error) {
    outputChannel.appendLine(`[ComponentDetector] Error in dynamic fetch: ${error}`);
    return null;
  }
}
