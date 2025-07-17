import * as vscode from 'vscode';
import { getComponentService } from '../services/componentService';
import { Logger } from '../utils/logger';

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
  private logger = Logger.getInstance();
  private components: CachedComponent[] = [];
  private lastRefreshTime = 0;
  private refreshInProgress = false;
  private sourceErrors: Map<string, string> = new Map(); // Track errors per source
  // Cache for project versions: key = `${gitlabInstance}|${sourcePath}`
  private projectVersionsCache: Map<string, string[]> = new Map();
  private context: vscode.ExtensionContext | null = null;

  constructor(context?: vscode.ExtensionContext) {
    this.logger.debug('[ComponentCache] Constructor called', 'ComponentCache');

    // Store the extension context for storage access
    this.context = context || null;

    // Log cache location info
    const cacheInfo = this.getCacheInfo();
    this.logger.debug(`[ComponentCache] Cache location: ${cacheInfo.location}`, 'ComponentCache');

    // Load cache from disk first, then check if refresh is needed
    this.initializeCache().catch(error => {
      this.logger.debug(`[ComponentCache] Error during initial cache check: ${error}`, 'ComponentCache');
    });

    // Listen for configuration changes to refresh cache
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gitlabComponentHelper.componentSources')) {
        this.logger.debug('[ComponentCache] Configuration changed, forcing refresh...', 'ComponentCache');
        this.forceRefresh().catch(error => {
          this.logger.debug(`[ComponentCache] Error during config refresh: ${error}`, 'ComponentCache');
        });
      }
    });
  }

  public async getComponents(): Promise<CachedComponent[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const cacheTime = config.get<number>('cacheTime', 3600) * 1000; // Default 1 hour

    // Check if cache needs refresh
    if (Date.now() - this.lastRefreshTime > cacheTime && !this.refreshInProgress) {
      this.logger.debug('[ComponentCache] Cache expired, refreshing components...', 'ComponentCache');
      this.refreshComponents().catch(error => {
        this.logger.debug(`[ComponentCache] Error during refresh: ${error}`, 'ComponentCache');
      });
    } else if (this.components.length > 0) {
      // Components are cached and fresh, but maybe check if we need to refresh versions
      this.refreshVersions().catch(error => {
        this.logger.debug(`[ComponentCache] Error during version refresh: ${error}`, 'ComponentCache');
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
        this.logger.debug(`[ComponentCache] Updated existing dynamic component: ${component.name}@${component.version}`, 'ComponentCache');
      } else {
        // Add new component
        this.components.push(component);
        this.logger.debug(`[ComponentCache] Added new dynamic component: ${component.name}@${component.version} from ${component.gitlabInstance}/${component.sourcePath}`, 'ComponentCache');
      }
    } catch (error) {
      this.logger.debug(`[ComponentCache] Error adding dynamic component: ${error}`, 'ComponentCache');
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
      this.logger.debug('[ComponentCache] Refresh already in progress, skipping...', 'ComponentCache');
      return;
    }

    this.refreshInProgress = true;
    this.logger.debug('[ComponentCache] Starting component refresh...', 'ComponentCache');

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

      this.logger.debug(`[ComponentCache] Found ${sources.length} configured sources`, 'ComponentCache');

      const newComponents: CachedComponent[] = [];
      this.sourceErrors.clear(); // Clear previous errors

      if (sources.length === 0) {
        this.logger.debug('[ComponentCache] No sources configured, using local components', 'ComponentCache');
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
            this.logger.debug(`[ComponentCache] Fetching from ${source.name} (${sourceType}: ${gitlabInstance}/${source.path})`, 'ComponentCache');

            if (sourceType === 'group') {
              // Fetch all projects from the group and then get components from each
              return await this.fetchComponentsFromGroup(gitlabInstance, source.path, source.name);
            } else {
              // Original project-based fetching
              return await this.fetchComponentsFromProject(gitlabInstance, source.path, source.name);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[ComponentCache] Error fetching from ${source.name}: ${errorMessage}`, 'ComponentCache');
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

      this.logger.info(`[ComponentCache] Cache updated with ${this.components.length} total components`, 'ComponentCache');
      this.components.forEach(comp => {
        this.logger.debug(`[ComponentCache]   - ${comp.name} from ${comp.source}`, 'ComponentCache');
      });

      // Fetch available versions for components that don't have them yet
      // Only fetch versions for new components or those without cached versions
      this.logger.debug(`[ComponentCache] Checking which components need version fetching...`, 'ComponentCache');
      const componentsNeedingVersions = this.components.filter(comp =>
        !comp.availableVersions || comp.availableVersions.length === 0
      );

      if (componentsNeedingVersions.length > 0) {
        this.logger.info(`[ComponentCache] Fetching versions for ${componentsNeedingVersions.length} components...`, 'ComponentCache');
        for (const component of componentsNeedingVersions) {
          try {
            await this.fetchComponentVersions(component);
          } catch (error) {
            this.logger.error(`[ComponentCache] Error fetching versions for ${component.name}: ${error}`, 'ComponentCache');
            // Don't fail the whole refresh for version fetch errors
          }
        }
      } else {
        this.logger.info(`[ComponentCache] All components already have cached versions`, 'ComponentCache');
      }

      // Save updated cache to disk
      await this.saveCacheToDisk();

    } catch (error) {
      this.logger.error(`[ComponentCache] Error during refresh: ${error}`, 'ComponentCache');
    } finally {
      this.refreshInProgress = false;
    }
  }

  public async forceRefresh(): Promise<void> {
    this.lastRefreshTime = 0; // Force cache invalidation
    await this.refreshComponents();
  }

  public addComponentToCache(component: CachedComponent): void {
    this.logger.debug(`[ComponentCache] Adding component to cache: ${component.name}@${component.version}`, 'ComponentCache');

    // Check if component already exists (same name, source, and version)
    const existingIndex = this.components.findIndex(c =>
      c.name === component.name &&
      c.gitlabInstance === component.gitlabInstance &&
      c.sourcePath === component.sourcePath &&
      c.version === component.version
    );

    if (existingIndex >= 0) {
      // Update existing component
      this.logger.debug(`[ComponentCache] Updating existing component: ${component.name}@${component.version}`, 'ComponentCache');
      this.components[existingIndex] = component;
    } else {
      // Add new component
      this.logger.debug(`[ComponentCache] Adding new component: ${component.name}@${component.version}`, 'ComponentCache');
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
        this.logger.info(`[ComponentCache] [CACHE HIT] Reusing cached versions for project ${component.gitlabInstance}/${component.sourcePath}`, 'ComponentCache');
      } else {
        const componentService = getComponentService();
        const tags = await componentService.fetchProjectTags(component.gitlabInstance, component.sourcePath);
        // Extract version names and add common branch names
        const versions = ['main', 'master', ...tags.map(tag => tag.name)];
        // Remove duplicates and sort by priority
        const uniqueVersions = Array.from(new Set(versions));
        sortedVersions = this.sortVersionsByPriority(uniqueVersions);
        this.projectVersionsCache.set(cacheKey, sortedVersions);
        this.logger.info(`[ComponentCache] [API FETCH] Fetched ${sortedVersions.length} versions for project ${component.gitlabInstance}/${component.sourcePath}`, 'ComponentCache');
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
      this.logger.debug(`[ComponentCache] Available versions for ${component.name}: ${sortedVersions.slice(0, 5).join(', ')}${sortedVersions.length > 5 ? '...' : ''}`, 'ComponentCache');
      return sortedVersions;
    } catch (error) {
      this.logger.error(`[ComponentCache] Error fetching versions for ${component.name}: ${error}`, 'ComponentCache');
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
      this.logger.info(`[ComponentCache] Fetching specific version ${version} of ${componentName} from ${sourcePath}`, 'ComponentCache');

      const componentService = getComponentService();

      // Check if this version is already cached
      const existingComponent = this.components.find(c =>
        c.name === componentName &&
        c.sourcePath === sourcePath &&
        c.gitlabInstance === gitlabInstance &&
        c.version === version
      );

      if (existingComponent) {
        this.logger.info(`[ComponentCache] Version ${version} already cached`, 'ComponentCache');
        return existingComponent;
      }

      // First, validate that the version exists by fetching project tags
      this.logger.debug(`[ComponentCache] Validating version ${version} exists...`, 'ComponentCache');
      const projectTags = await componentService.fetchProjectTags(gitlabInstance, sourcePath);
      const availableVersions = ['main', 'master', ...projectTags.map(tag => tag.name)];

      if (!availableVersions.includes(version)) {
        this.logger.warn(`[ComponentCache] Version ${version} does not exist. Available versions: ${availableVersions.slice(0, 10).join(', ')}`, 'ComponentCache');
        return null;
      }

      // Fetch the component data for this specific version
      const catalogData = await componentService.fetchCatalogData(gitlabInstance, sourcePath, true, version);

      if (!catalogData || !catalogData.components || catalogData.components.length === 0) {
        this.logger.warn(`[ComponentCache] No component data found for version ${version}`, 'ComponentCache');
        return null;
      }

      // Find the matching component in the catalog
      const catalogComponent = catalogData.components.find((c: any) => c.name === componentName);
      if (!catalogComponent) {
        this.logger.warn(`[ComponentCache] Component ${componentName} not found in version ${version}`, 'ComponentCache');
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

      this.logger.info(`[ComponentCache] Successfully cached version ${version} of ${componentName}`, 'ComponentCache');
      return cachedComponent;

    } catch (error) {
      this.logger.error(`[ComponentCache] Error fetching specific version: ${error}`, 'ComponentCache');
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
        this.logger.info(`[ComponentCache] Found ${catalogData.components.length} components in ${sourceName}`, 'ComponentCache');

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

        this.logger.debug(`[ComponentCache] Processed ${sourceComponents.length} components from ${sourceName}`, 'ComponentCache');
        return sourceComponents;
      } else {
        this.logger.info(`[ComponentCache] No components found in ${sourceName}`, 'ComponentCache');
        // Don't set this as an error - just no components found
        this.sourceErrors.delete(sourceName);
        return [];
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[ComponentCache] Error fetching project ${projectPath}: ${errorMessage}`, 'ComponentCache');
      throw error;
    }
  }

  private async fetchComponentsFromGroup(gitlabInstance: string, groupPath: string, sourceName: string): Promise<CachedComponent[]> {
    this.logger.info(`[ComponentCache] Fetching projects from group: ${gitlabInstance}/${groupPath}`, 'ComponentCache');

    try {
      // First, get all projects in the group
      const groupProjects = await this.fetchGroupProjects(gitlabInstance, groupPath);
      this.logger.info(`[ComponentCache] Found ${groupProjects.length} projects in group ${groupPath}`, 'ComponentCache');

      if (groupProjects.length === 0) {
        this.logger.info(`[ComponentCache] No projects found in group ${groupPath}`, 'ComponentCache');
        this.sourceErrors.delete(sourceName);
        return [];
      }

      // Fetch components from each project in parallel (but with some concurrency control)
      this.logger.debug(`[ComponentCache] Checking ${groupProjects.length} projects for components (this may take a moment)...`, 'ComponentCache');

      // Process projects in batches to avoid overwhelming the API
      const batchSize = 5;
      const allComponents: CachedComponent[] = [];
      let projectsWithComponents = 0;

      for (let i = 0; i < groupProjects.length; i += batchSize) {
        const batch = groupProjects.slice(i, i + batchSize);
        this.logger.debug(`[ComponentCache] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(groupProjects.length/batchSize)} (projects ${i + 1}-${Math.min(i + batchSize, groupProjects.length)})`, 'ComponentCache');

        const batchPromises = batch.map(async (project: any) => {
          try {
            this.logger.debug(`[ComponentCache] Checking ${project.path_with_namespace}...`, 'ComponentCache');

            // Try to fetch components from this project
            const components = await this.fetchComponentsFromProject(
              gitlabInstance,
              project.path_with_namespace,
              `${sourceName}/${project.name}`
            );

            if (components.length > 0) {
              this.logger.info(`[ComponentCache] ✓ Found ${components.length} components in ${project.path_with_namespace}`, 'ComponentCache');
              return { project, components };
            } else {
              this.logger.debug(`[ComponentCache] - No components in ${project.path_with_namespace}`, 'ComponentCache');
              return { project, components: [] };
            }
          } catch (error) {
            // Log but don't fail the whole group if one project fails
            this.logger.error(`[ComponentCache] ✗ Error checking ${project.path_with_namespace}: ${error}`, 'ComponentCache');
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

      this.logger.info(`[ComponentCache] Group scan complete!`, 'ComponentCache');
      this.logger.info(`[ComponentCache] Projects scanned: ${groupProjects.length}`, 'ComponentCache');
      this.logger.info(`[ComponentCache] Projects with components: ${projectsWithComponents}`, 'ComponentCache');
      this.logger.info(`[ComponentCache] Total components found: ${allComponents.length}`, 'ComponentCache');

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
      this.logger.error(`[ComponentCache] Error fetching group ${groupPath}: ${errorMessage}`, 'ComponentCache');
      throw error;
    }
  }

  private async fetchGroupProjects(gitlabInstance: string, groupPath: string): Promise<any[]> {
    const componentService = getComponentService();

    try {
      // Use GitLab Groups API to get all projects in the group
      const groupApiUrl = `https://${gitlabInstance}/api/v4/groups/${encodeURIComponent(groupPath)}/projects?per_page=100&include_subgroups=true`;
      this.logger.info(`[ComponentCache] Fetching group projects from: ${groupApiUrl}`, 'ComponentCache');

      // Get token for this GitLab instance
      const token = await componentService.getTokenForInstance(gitlabInstance);
      const fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      this.logger.debug(`[ComponentCache] Using token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`, 'ComponentCache');

      // Use the fetchJson method with authentication options
      const projects = await componentService.fetchJson(groupApiUrl, fetchOptions);

      this.logger.info(`[ComponentCache] Found ${projects.length} total projects in group ${groupPath}`, 'ComponentCache');

      // Instead of filtering here, let's check each project for actual components
      // This is more accurate than guessing based on names/topics
      this.logger.debug(`[ComponentCache] Will check all ${projects.length} projects for components (no pre-filtering)`, 'ComponentCache');

      return projects;
    } catch (error) {
      this.logger.error(`[ComponentCache] Error fetching group projects: ${error}`, 'ComponentCache');
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
      this.logger.info(`[ComponentCache] Cache is still valid (${this.components.length} components, ${Math.round((Date.now() - this.lastRefreshTime) / 1000)}s old), skipping refresh`, 'ComponentCache');
      this.logger.debug(`[ComponentCache] Cache location: ${cacheInfo.location}`, 'ComponentCache');
      return;
    }

    // If cache is empty or expired, do initial refresh
    this.logger.info('[ComponentCache] Cache is empty or expired, performing initial refresh...', 'ComponentCache');
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
      this.logger.info('[ComponentCache] Version cache is still fresh, skipping version refresh', 'ComponentCache');
      return;
    }

    this.logger.info('[ComponentCache] Refreshing versions for all components...', 'ComponentCache');
    for (const component of this.components) {
      try {
        // Clear cached versions to force refresh
        component.availableVersions = undefined;
        await this.fetchComponentVersions(component);
      } catch (error) {
        this.logger.error(`[ComponentCache] Error refreshing versions for ${component.name}: ${error}`, 'ComponentCache');
      }
    }
  }

  /**
   * Load cache from extension global state
   */
  private async loadCacheFromDisk(): Promise<void> {
    try {
      if (!this.context) {
        this.logger.warn('[ComponentCache] No extension context available, starting with empty cache', 'ComponentCache');
        return;
      }

      const cacheData = this.context.globalState.get<any>('componentCache');      if (cacheData && cacheData.components && Array.isArray(cacheData.components)) {
        this.components = cacheData.components;
        this.lastRefreshTime = cacheData.lastRefreshTime || 0;
        this.projectVersionsCache = new Map(cacheData.projectVersionsCache || []);

        this.logger.info(`[ComponentCache] Loaded ${this.components.length} components from global state`, 'ComponentCache');
        this.logger.debug(`[ComponentCache] Cache last updated: ${new Date(this.lastRefreshTime).toISOString()}`, 'ComponentCache');
        this.logger.debug(`[ComponentCache] Cache storage: VS Code Global State (persists across sessions)`, 'ComponentCache');
      } else {
        this.logger.info('[ComponentCache] No cached data found in global state, will create new cache', 'ComponentCache');
        this.logger.debug('[ComponentCache] Cache storage: VS Code Global State (persists across sessions)', 'ComponentCache');
      }
    } catch (error) {
      this.logger.error(`[ComponentCache] Error loading cache from global state: ${error}`, 'ComponentCache');
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
        this.logger.warn('[ComponentCache] No extension context available, cannot save cache', 'ComponentCache');
        return;
      }

      const cacheData = {
        components: this.components,
        lastRefreshTime: this.lastRefreshTime,
        projectVersionsCache: Array.from(this.projectVersionsCache.entries()),
        version: '1.0.0' // For future cache format migrations
      };

      await this.context.globalState.update('componentCache', cacheData);
      this.logger.info(`[ComponentCache] Saved cache to global state (${this.components.length} components)`, 'ComponentCache');
      this.logger.debug(`[ComponentCache] Cache storage: VS Code Global State (persists across sessions)`, 'ComponentCache');
    } catch (error) {
      this.logger.error(`[ComponentCache] Error saving cache to global state: ${error}`, 'ComponentCache');
    }
  }

  /**
   * Set the extension context (for cases where cache manager is created before context is available)
   */
  public setContext(context: vscode.ExtensionContext): void {
    if (!this.context) {
      this.context = context;
      this.logger.info('[ComponentCache] Extension context set, cache persistence now enabled', 'ComponentCache');
      this.logger.debug('[ComponentCache] Cache storage: VS Code Global State (persists across sessions)', 'ComponentCache');
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
