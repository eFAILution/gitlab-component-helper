import * as vscode from 'vscode';
import { getComponentService } from '../services/componentService';
import { outputChannel } from '../utils/outputChannel';

interface CachedComponent {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    description: string;
    required: boolean;
    type: string;
    default?: any; // Allow any type for default values (string, boolean, number, etc.)
  }>;
  source: string;
  sourcePath: string;
  gitlabInstance: string;
  version: string;
  url: string;
  availableVersions?: string[]; // All available versions for this component
  readme?: string;
}

export class ComponentCacheManager {
  private components: CachedComponent[] = [];
  private lastRefreshTime = 0;
  private refreshInProgress = false;
  private sourceErrors: Map<string, string> = new Map(); // Track errors per source
  // Cache for project versions: key = `${gitlabInstance}|${sourcePath}`
  private projectVersionsCache: Map<string, string[]> = new Map();
  private context: vscode.ExtensionContext | null = null;

  constructor(context?: vscode.ExtensionContext) {
    outputChannel.appendLine('[ComponentCache] Constructor called');

    // Store the extension context for storage access
    this.context = context || null;

    // Log cache location info
    const cacheInfo = this.getCacheInfo();
    outputChannel.appendLine(`[ComponentCache] Cache location: ${cacheInfo.location}`);

    // Load cache from disk first, then check if refresh is needed
    this.initializeCache().catch(error => {
      outputChannel.appendLine(`[ComponentCache] Error during initial cache check: ${error}`);
    });

    // Listen for configuration changes to refresh cache
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gitlabComponentHelper.componentSources')) {
        outputChannel.appendLine('[ComponentCache] Configuration changed, forcing refresh...');
        this.forceRefresh().catch(error => {
          outputChannel.appendLine(`[ComponentCache] Error during config refresh: ${error}`);
        });
      }
    });
  }

  public async getComponents(): Promise<CachedComponent[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const cacheTime = config.get<number>('cacheTime', 3600) * 1000; // Default 1 hour

    // Check if cache needs refresh
    if (Date.now() - this.lastRefreshTime > cacheTime && !this.refreshInProgress) {
      outputChannel.appendLine('[ComponentCache] Cache expired, refreshing components...');
      this.refreshComponents().catch(error => {
        outputChannel.appendLine(`[ComponentCache] Error during refresh: ${error}`);
      });
    } else if (this.components.length > 0) {
      // Components are cached and fresh, but maybe check if we need to refresh versions
      this.refreshVersions().catch(error => {
        outputChannel.appendLine(`[ComponentCache] Error during version refresh: ${error}`);
      });
    }

    return this.components;
  }

  /**
   * Add a dynamically fetched component to the cache
   */
  public addDynamicComponent(component: {
    name: string;
    description: string;
    parameters: Array<{
      name: string;
      description: string;
      required: boolean;
      type: string;
      default?: any;
    }>;
    source: string;
    sourcePath: string;
    gitlabInstance: string;
    version: string;
    url: string;
  }): void {
    try {
      // Check if component already exists (avoid duplicates)
      const existingIndex = this.components.findIndex(comp =>
        comp.name === component.name &&
        comp.sourcePath === component.sourcePath &&
        comp.gitlabInstance === component.gitlabInstance &&
        comp.version === component.version
      );

      if (existingIndex >= 0) {
        // Update existing component
        this.components[existingIndex] = component;
        outputChannel.appendLine(`[ComponentCache] Updated existing dynamic component: ${component.name}@${component.version}`);
      } else {
        // Add new component
        this.components.push(component);
        outputChannel.appendLine(`[ComponentCache] Added new dynamic component: ${component.name}@${component.version} from ${component.gitlabInstance}/${component.sourcePath}`);
      }
    } catch (error) {
      outputChannel.appendLine(`[ComponentCache] Error adding dynamic component: ${error}`);
    }
  }

  public getSourceErrors(): Map<string, string> {
    return new Map(this.sourceErrors); // Return a copy
  }

  public hasErrors(): boolean {
    return this.sourceErrors.size > 0;
  }

  public async refreshComponents(): Promise<void> {
    if (this.refreshInProgress) {
      outputChannel.appendLine('[ComponentCache] Refresh already in progress, skipping...');
      return;
    }

    this.refreshInProgress = true;
    outputChannel.appendLine('[ComponentCache] Starting component refresh...');

    // Clear project versions cache on full refresh
    this.projectVersionsCache.clear();

    try {
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const sources = config.get<Array<{
        name: string;
        path: string;
        gitlabInstance?: string;
        type?: 'project' | 'group'; // Add support for group vs project sources
      }>>('componentSources', []);

      outputChannel.appendLine(`[ComponentCache] Found ${sources.length} configured sources`);

      const newComponents: CachedComponent[] = [];
      this.sourceErrors.clear(); // Clear previous errors

      if (sources.length === 0) {
        outputChannel.appendLine('[ComponentCache] No sources configured, using local components');
        // Add local fallback components
        newComponents.push(
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
            ],
            source: 'Local',
            sourcePath: 'local',
            gitlabInstance: 'local',
            version: 'latest',
            url: 'deploy-component'
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
            ],
            source: 'Local',
            sourcePath: 'local',
            gitlabInstance: 'local',
            version: 'latest',
            url: 'test-component'
          }
        );
      } else {
        const componentService = getComponentService();

        // Fetch from all configured sources in parallel
        const fetchPromises = sources.map(async (source) => {
          try {
            // Handle both hostname and full URL formats
            let gitlabInstance = source.gitlabInstance || 'gitlab.com';
            if (gitlabInstance.startsWith('https://')) {
              gitlabInstance = gitlabInstance.replace('https://', '');
            }
            if (gitlabInstance.startsWith('http://')) {
              gitlabInstance = gitlabInstance.replace('http://', '');
            }

            const sourceType = source.type || 'project'; // Default to project for backward compatibility
            outputChannel.appendLine(`[ComponentCache] Fetching from ${source.name} (${sourceType}: ${gitlabInstance}/${source.path})`);

            if (sourceType === 'group') {
              // Fetch all projects from the group and then get components from each
              return await this.fetchComponentsFromGroup(gitlabInstance, source.path, source.name);
            } else {
              // Original project-based fetching
              return await this.fetchComponentsFromProject(gitlabInstance, source.path, source.name);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(`[ComponentCache] Error fetching from ${source.name}: ${errorMessage}`);
            this.sourceErrors.set(source.name, errorMessage);
            return [];
          }
        });

        // Wait for all sources to complete
        const results = await Promise.all(fetchPromises);

        // Flatten the results
        for (const sourceComponents of results) {
          newComponents.push(...sourceComponents);
        }
      }

      this.components = newComponents;
      this.lastRefreshTime = Date.now();

      // Save cache to disk after successful refresh
      await this.saveCacheToDisk();

      outputChannel.appendLine(`[ComponentCache] Cache updated with ${this.components.length} total components`);
      this.components.forEach(comp => {
        outputChannel.appendLine(`[ComponentCache]   - ${comp.name} from ${comp.source}`);
      });

      // Fetch available versions for components that don't have them yet
      // Only fetch versions for new components or those without cached versions
      outputChannel.appendLine(`[ComponentCache] Checking which components need version fetching...`);
      const componentsNeedingVersions = this.components.filter(comp =>
        !comp.availableVersions || comp.availableVersions.length === 0
      );

      if (componentsNeedingVersions.length > 0) {
        outputChannel.appendLine(`[ComponentCache] Fetching versions for ${componentsNeedingVersions.length} components...`);
        for (const component of componentsNeedingVersions) {
          try {
            await this.fetchComponentVersions(component);
          } catch (error) {
            outputChannel.appendLine(`[ComponentCache] Error fetching versions for ${component.name}: ${error}`);
            // Don't fail the whole refresh for version fetch errors
          }
        }
      } else {
        outputChannel.appendLine(`[ComponentCache] All components already have cached versions`);
      }

      // Save updated cache to disk
      await this.saveCacheToDisk();

    } catch (error) {
      outputChannel.appendLine(`[ComponentCache] Error during refresh: ${error}`);
    } finally {
      this.refreshInProgress = false;
    }
  }

  public async forceRefresh(): Promise<void> {
    this.lastRefreshTime = 0; // Force cache invalidation
    await this.refreshComponents();
  }

  public addComponentToCache(component: CachedComponent): void {
    outputChannel.appendLine(`[ComponentCache] Adding component to cache: ${component.name}@${component.version}`);

    // Check if component already exists (same name, source, and version)
    const existingIndex = this.components.findIndex(c =>
      c.name === component.name &&
      c.gitlabInstance === component.gitlabInstance &&
      c.sourcePath === component.sourcePath &&
      c.version === component.version
    );

    if (existingIndex >= 0) {
      // Update existing component
      outputChannel.appendLine(`[ComponentCache] Updating existing component: ${component.name}@${component.version}`);
      this.components[existingIndex] = component;
    } else {
      // Add new component
      outputChannel.appendLine(`[ComponentCache] Adding new component: ${component.name}@${component.version}`);
      this.components.push(component);
    }
  }

  /**
   * Fetch and cache all available versions for a specific component
   */
  public async fetchComponentVersions(component: CachedComponent): Promise<string[]> {
    try {
      const cacheKey = `${component.gitlabInstance}|${component.sourcePath}`;
      let sortedVersions: string[] | undefined = this.projectVersionsCache.get(cacheKey);
      if (sortedVersions) {
        outputChannel.appendLine(`[ComponentCache] [CACHE HIT] Reusing cached versions for project ${component.gitlabInstance}/${component.sourcePath}`);
      } else {
        const componentService = getComponentService();
        const tags = await componentService.fetchProjectTags(component.gitlabInstance, component.sourcePath);
        // Extract version names and add common branch names
        const versions = ['main', 'master', ...tags.map(tag => tag.name)];
        // Remove duplicates and sort by priority
        const uniqueVersions = Array.from(new Set(versions));
        sortedVersions = this.sortVersionsByPriority(uniqueVersions);
        this.projectVersionsCache.set(cacheKey, sortedVersions);
        outputChannel.appendLine(`[ComponentCache] [API FETCH] Fetched ${sortedVersions.length} versions for project ${component.gitlabInstance}/${component.sourcePath}`);
      }

      // Update the component in cache with available versions
      const cachedComponent = this.components.find(c =>
        c.name === component.name &&
        c.sourcePath === component.sourcePath &&
        c.gitlabInstance === component.gitlabInstance
      );
      if (cachedComponent) {
        cachedComponent.availableVersions = sortedVersions;
        // Save cache after updating versions
        await this.saveCacheToDisk();
      }
      outputChannel.appendLine(`[ComponentCache] Available versions for ${component.name}: ${sortedVersions.slice(0, 5).join(', ')}${sortedVersions.length > 5 ? '...' : ''}`);
      return sortedVersions;
    } catch (error) {
      outputChannel.appendLine(`[ComponentCache] Error fetching versions for ${component.name}: ${error}`);
      return [component.version]; // Return current version as fallback
    }
  }

  /**
   * Sort versions by priority (latest semantic versions first)
   */
  private sortVersionsByPriority(versions: string[]): string[] {
    return versions.sort((a, b) => {
      // Helper function to determine version priority
      const versionPriority = (version: string) => {
        if (version === 'main') return 1000;
        if (version === 'master') return 900;

        // Semantic versions get priority based on version number
        const semanticMatch = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
        if (semanticMatch) {
          const major = parseInt(semanticMatch[1]);
          const minor = parseInt(semanticMatch[2]);
          const patch = parseInt(semanticMatch[3]);
          return major * 1000000 + minor * 1000 + patch;
        }

        return 0; // Lowest priority for other versions
      };

      return versionPriority(b) - versionPriority(a); // Descending order
    });
  }

  /**
   * Fetch a specific version of a component and add it to cache
   */
  public async fetchSpecificVersion(componentName: string, sourcePath: string, gitlabInstance: string, version: string): Promise<CachedComponent | null> {
    try {
      outputChannel.appendLine(`[ComponentCache] Fetching specific version ${version} of ${componentName} from ${sourcePath}`);

      const componentService = getComponentService();

      // Check if this version is already cached
      const existingComponent = this.components.find(c =>
        c.name === componentName &&
        c.sourcePath === sourcePath &&
        c.gitlabInstance === gitlabInstance &&
        c.version === version
      );

      if (existingComponent) {
        outputChannel.appendLine(`[ComponentCache] Version ${version} already cached`);
        return existingComponent;
      }

      // First, validate that the version exists by fetching project tags
      outputChannel.appendLine(`[ComponentCache] Validating version ${version} exists...`);
      const projectTags = await componentService.fetchProjectTags(gitlabInstance, sourcePath);
      const availableVersions = ['main', 'master', ...projectTags.map(tag => tag.name)];

      if (!availableVersions.includes(version)) {
        outputChannel.appendLine(`[ComponentCache] Version ${version} does not exist. Available versions: ${availableVersions.slice(0, 10).join(', ')}`);
        return null;
      }

      // Fetch the component data for this specific version
      const catalogData = await componentService.fetchCatalogData(gitlabInstance, sourcePath, true, version);

      if (!catalogData || !catalogData.components || catalogData.components.length === 0) {
        outputChannel.appendLine(`[ComponentCache] No component data found for version ${version}`);
        return null;
      }

      // Find the matching component in the catalog
      const catalogComponent = catalogData.components.find((c: any) => c.name === componentName);
      if (!catalogComponent) {
        outputChannel.appendLine(`[ComponentCache] Component ${componentName} not found in version ${version}`);
        return null;
      }

      // Create cached component entry
      const cachedComponent: CachedComponent = {
        name: catalogComponent.name,
        description: catalogComponent.description || `Component from ${sourcePath}`,
        parameters: (catalogComponent.variables || []).map((v: any) => ({
          name: v.name,
          description: v.description || `Parameter: ${v.name}`,
          required: v.required || false,
          type: v.type || 'string',
          default: v.default
        })),
        source: `Components from ${sourcePath}`,
        sourcePath: sourcePath,
        gitlabInstance: gitlabInstance,
        version: version,
        url: `https://${gitlabInstance}/${sourcePath}/${catalogComponent.name}@${version}`,
        readme: catalogComponent.readme
      };

      // Add to cache
      this.components.push(cachedComponent);

      outputChannel.appendLine(`[ComponentCache] Successfully cached version ${version} of ${componentName}`);
      return cachedComponent;

    } catch (error) {
      outputChannel.appendLine(`[ComponentCache] Error fetching specific version: ${error}`);
      return null;
    }
  }

  private async fetchComponentsFromProject(gitlabInstance: string, projectPath: string, sourceName: string): Promise<CachedComponent[]> {
    const componentService = getComponentService();

    try {
      const catalogData = await componentService.fetchCatalogData(
        gitlabInstance,
        projectPath,
        false
      );

      if (catalogData && catalogData.components) {
        outputChannel.appendLine(`[ComponentCache] Found ${catalogData.components.length} components in ${sourceName}`);

        // Clear any previous error for this source since it succeeded
        this.sourceErrors.delete(sourceName);

        const sourceComponents: CachedComponent[] = catalogData.components.map((c: any) => {
          const componentUrl = `https://${gitlabInstance}/${projectPath}/${c.name}@${c.latest_version || 'main'}`;

          return {
            name: c.name,
            description: c.description || `Component from ${sourceName}`,
            parameters: (c.variables || []).map((v: any) => ({
              name: v.name,
              description: v.description || `Parameter: ${v.name}`,
              required: v.required || false,
              type: v.type || 'string',
              default: v.default
            })),
            source: sourceName,
            sourcePath: projectPath,
            gitlabInstance: gitlabInstance,
            version: c.latest_version || 'main',
            url: componentUrl
          };
        });

        outputChannel.appendLine(`[ComponentCache] Processed ${sourceComponents.length} components from ${sourceName}`);
        return sourceComponents;
      } else {
        outputChannel.appendLine(`[ComponentCache] No components found in ${sourceName}`);
        // Don't set this as an error - just no components found
        this.sourceErrors.delete(sourceName);
        return [];
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[ComponentCache] Error fetching project ${projectPath}: ${errorMessage}`);
      throw error;
    }
  }

  private async fetchComponentsFromGroup(gitlabInstance: string, groupPath: string, sourceName: string): Promise<CachedComponent[]> {
    outputChannel.appendLine(`[ComponentCache] Fetching projects from group: ${gitlabInstance}/${groupPath}`);

    try {
      // First, get all projects in the group
      const groupProjects = await this.fetchGroupProjects(gitlabInstance, groupPath);
      outputChannel.appendLine(`[ComponentCache] Found ${groupProjects.length} projects in group ${groupPath}`);

      if (groupProjects.length === 0) {
        outputChannel.appendLine(`[ComponentCache] No projects found in group ${groupPath}`);
        this.sourceErrors.delete(sourceName);
        return [];
      }

      // Fetch components from each project in parallel (but with some concurrency control)
      outputChannel.appendLine(`[ComponentCache] Checking ${groupProjects.length} projects for components (this may take a moment)...`);

      // Process projects in batches to avoid overwhelming the API
      const batchSize = 5;
      const allComponents: CachedComponent[] = [];
      let projectsWithComponents = 0;

      for (let i = 0; i < groupProjects.length; i += batchSize) {
        const batch = groupProjects.slice(i, i + batchSize);
        outputChannel.appendLine(`[ComponentCache] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(groupProjects.length/batchSize)} (projects ${i + 1}-${Math.min(i + batchSize, groupProjects.length)})`);

        const batchPromises = batch.map(async (project: any) => {
          try {
            outputChannel.appendLine(`[ComponentCache] Checking ${project.path_with_namespace}...`);

            // Try to fetch components from this project
            const components = await this.fetchComponentsFromProject(
              gitlabInstance,
              project.path_with_namespace,
              `${sourceName}/${project.name}`
            );

            if (components.length > 0) {
              outputChannel.appendLine(`[ComponentCache] ✓ Found ${components.length} components in ${project.path_with_namespace}`);
              return { project, components };
            } else {
              outputChannel.appendLine(`[ComponentCache] - No components in ${project.path_with_namespace}`);
              return { project, components: [] };
            }
          } catch (error) {
            // Log but don't fail the whole group if one project fails
            outputChannel.appendLine(`[ComponentCache] ✗ Error checking ${project.path_with_namespace}: ${error}`);
            return { project, components: [] };
          }
        });

        const batchResults = await Promise.all(batchPromises);

        // Add successful components to the total
        for (const result of batchResults) {
          if (result.components.length > 0) {
            allComponents.push(...result.components);
            projectsWithComponents++;
          }
        }
      }

      outputChannel.appendLine(`[ComponentCache] Group scan complete!`);
      outputChannel.appendLine(`[ComponentCache] Projects scanned: ${groupProjects.length}`);
      outputChannel.appendLine(`[ComponentCache] Projects with components: ${projectsWithComponents}`);
      outputChannel.appendLine(`[ComponentCache] Total components found: ${allComponents.length}`);

      // Clear any previous error for this source since we got some results
      if (allComponents.length > 0) {
        this.sourceErrors.delete(sourceName);
      } else {
        // Set a helpful message if no components were found
        this.sourceErrors.set(sourceName, `No components found in any of the ${groupProjects.length} projects in group ${groupPath}`);
      }

      return allComponents;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[ComponentCache] Error fetching group ${groupPath}: ${errorMessage}`);
      throw error;
    }
  }

  private async fetchGroupProjects(gitlabInstance: string, groupPath: string): Promise<any[]> {
    const componentService = getComponentService();

    try {
      // Use GitLab Groups API to get all projects in the group
      const groupApiUrl = `https://${gitlabInstance}/api/v4/groups/${encodeURIComponent(groupPath)}/projects?per_page=100&include_subgroups=true`;
      outputChannel.appendLine(`[ComponentCache] Fetching group projects from: ${groupApiUrl}`);

      // Get token for this GitLab instance
      const token = await componentService.getTokenForInstance(gitlabInstance);
      const fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      outputChannel.appendLine(`[ComponentCache] Using token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`);

      // Use the fetchJson method with authentication options
      const projects = await componentService.fetchJson(groupApiUrl, fetchOptions);

      outputChannel.appendLine(`[ComponentCache] Found ${projects.length} total projects in group ${groupPath}`);

      // Instead of filtering here, let's check each project for actual components
      // This is more accurate than guessing based on names/topics
      outputChannel.appendLine(`[ComponentCache] Will check all ${projects.length} projects for components (no pre-filtering)`);

      return projects;
    } catch (error) {
      outputChannel.appendLine(`[ComponentCache] Error fetching group projects: ${error}`);
      throw error;
    }
  }

  /**
   * Initialize cache only if needed (smart startup)
   */
  private async initializeCache(): Promise<void> {
    // First, try to load cache from disk
    await this.loadCacheFromDisk();

    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const cacheTime = config.get<number>('cacheTime', 3600) * 1000; // Default 1 hour

    // If we have components and cache is still valid, don't refresh
    if (this.components.length > 0 && Date.now() - this.lastRefreshTime < cacheTime) {
      const cacheInfo = this.getCacheInfo();
      outputChannel.appendLine(`[ComponentCache] Cache is still valid (${this.components.length} components, ${Math.round((Date.now() - this.lastRefreshTime) / 1000)}s old), skipping refresh`);
      outputChannel.appendLine(`[ComponentCache] Cache location: ${cacheInfo.location}`);
      return;
    }

    // If cache is empty or expired, do initial refresh
    outputChannel.appendLine('[ComponentCache] Cache is empty or expired, performing initial refresh...');
    await this.refreshComponents();
  }

  /**
   * Check if version cache needs refreshing (less frequent than component cache)
   */
  private shouldRefreshVersions(): boolean {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const versionCacheTime = config.get<number>('versionCacheTime', 86400) * 1000; // Default 24 hours for versions

    // If we have a separate version cache timestamp, use it
    // For now, use 4x the component cache time for version refreshes
    const versionRefreshInterval = (config.get<number>('cacheTime', 3600) * 4) * 1000;

    return Date.now() - this.lastRefreshTime > versionRefreshInterval;
  }

  /**
   * Refresh versions for all components (can be called separately from component refresh)
   */
  public async refreshVersions(): Promise<void> {
    if (!this.shouldRefreshVersions()) {
      outputChannel.appendLine('[ComponentCache] Version cache is still fresh, skipping version refresh');
      return;
    }

    outputChannel.appendLine('[ComponentCache] Refreshing versions for all components...');
    for (const component of this.components) {
      try {
        // Clear cached versions to force refresh
        component.availableVersions = undefined;
        await this.fetchComponentVersions(component);
      } catch (error) {
        outputChannel.appendLine(`[ComponentCache] Error refreshing versions for ${component.name}: ${error}`);
      }
    }
  }

  /**
   * Load cache from extension global state
   */
  private async loadCacheFromDisk(): Promise<void> {
    try {
      if (!this.context) {
        outputChannel.appendLine('[ComponentCache] No extension context available, starting with empty cache');
        return;
      }

      const cacheData = this.context.globalState.get<any>('componentCache');      if (cacheData && cacheData.components && Array.isArray(cacheData.components)) {
        this.components = cacheData.components;
        this.lastRefreshTime = cacheData.lastRefreshTime || 0;
        this.projectVersionsCache = new Map(cacheData.projectVersionsCache || []);

        outputChannel.appendLine(`[ComponentCache] Loaded ${this.components.length} components from global state`);
        outputChannel.appendLine(`[ComponentCache] Cache last updated: ${new Date(this.lastRefreshTime).toISOString()}`);
        outputChannel.appendLine(`[ComponentCache] Cache storage: VS Code Global State (persists across sessions)`);
      } else {
        outputChannel.appendLine('[ComponentCache] No cached data found in global state, will create new cache');
        outputChannel.appendLine('[ComponentCache] Cache storage: VS Code Global State (persists across sessions)');
      }
    } catch (error) {
      outputChannel.appendLine(`[ComponentCache] Error loading cache from global state: ${error}`);
      // Reset to empty cache on error
      this.components = [];
      this.lastRefreshTime = 0;
      this.projectVersionsCache.clear();
    }
  }

  /**
   * Save cache to extension global state
   */
  private async saveCacheToDisk(): Promise<void> {
    try {
      if (!this.context) {
        outputChannel.appendLine('[ComponentCache] No extension context available, cannot save cache');
        return;
      }

      const cacheData = {
        components: this.components,
        lastRefreshTime: this.lastRefreshTime,
        projectVersionsCache: Array.from(this.projectVersionsCache.entries()),
        version: '1.0.0' // For future cache format migrations
      };

      await this.context.globalState.update('componentCache', cacheData);
      outputChannel.appendLine(`[ComponentCache] Saved cache to global state (${this.components.length} components)`);
      outputChannel.appendLine(`[ComponentCache] Cache storage: VS Code Global State (persists across sessions)`);
    } catch (error) {
      outputChannel.appendLine(`[ComponentCache] Error saving cache to global state: ${error}`);
    }
  }

  /**
   * Set the extension context (for cases where cache manager is created before context is available)
   */
  public setContext(context: vscode.ExtensionContext): void {
    if (!this.context) {
      this.context = context;
      outputChannel.appendLine('[ComponentCache] Extension context set, cache persistence now enabled');
      outputChannel.appendLine('[ComponentCache] Cache storage: VS Code Global State (persists across sessions)');
    }
  }

  /**
   * Get cache location information for debugging
   */
  public getCacheInfo(): { location: string; size: number; lastUpdate: string; hasContext: boolean } {
    const lastUpdateDate = this.lastRefreshTime > 0 ? new Date(this.lastRefreshTime).toISOString() : 'Never';

    return {
      location: this.context ? 'VS Code Global State (persistent across sessions)' : 'Memory only (will be lost when VS Code closes)',
      size: this.components.length,
      lastUpdate: lastUpdateDate,
      hasContext: !!this.context
    };
  }
}

// Singleton instance
let cacheManager: ComponentCacheManager | null = null;

export function getComponentCacheManager(context?: vscode.ExtensionContext): ComponentCacheManager {
  if (!cacheManager) {
    cacheManager = new ComponentCacheManager(context);
  } else if (context && !cacheManager['context']) {
    // Set context if it wasn't available during initial creation
    cacheManager.setContext(context);
  }
  return cacheManager;
}
