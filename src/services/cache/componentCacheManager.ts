import * as vscode from 'vscode';
import { getComponentService } from '../component';
import { Logger } from '../../utils/logger';
import { getPerformanceMonitor } from '../../utils/performanceMonitor';
import { CachedComponent, PersistentCacheData } from '../../types/cache';
import { ProjectCache } from './projectCache';
import { VersionCache } from './versionCache';
import { GroupCache } from './groupCache';
import {
  CACHE_LOCATION_GLOBAL_STATE,
  CACHE_LOCATION_MEMORY_ONLY,
  SOURCE_LOCAL,
  DEFAULT_COMPONENT_TYPE_PROJECT,
} from '../../constants/cache';

/**
 * ComponentCacheManager - Main orchestrator for component caching
 *
 * Responsibilities:
 * - Coordinate between ProjectCache, VersionCache, and GroupCache
 * - Manage component refresh lifecycle
 * - Handle persistence to VS Code global state
 * - Track source errors
 * - Provide singleton access pattern
 */
export class ComponentCacheManager {
  private logger = Logger.getInstance();
  private performanceMonitor = getPerformanceMonitor();
  private components: CachedComponent[] = [];
  private lastRefreshTime = 0;
  private refreshInProgress = false;
  private sourceErrors: Map<string, string> = new Map();
  private context: vscode.ExtensionContext | null = null;

  // Specialized cache modules
  private projectCache: ProjectCache;
  private versionCache: VersionCache;
  private groupCache: GroupCache;

  constructor(context?: vscode.ExtensionContext) {
    this.logger.debug('[ComponentCache] Constructor called', 'ComponentCache');

    // Initialize specialized cache modules
    this.projectCache = new ProjectCache();
    this.versionCache = new VersionCache();
    this.groupCache = new GroupCache(this.projectCache);

    // Store the extension context for storage access
    this.context = context || null;

    // Log cache location info
    const cacheInfo = this.getCacheInfo();
    this.logger.debug(`[ComponentCache] Cache location: ${cacheInfo.location}`, 'ComponentCache');

    // Load cache from disk first, then check if refresh is needed
    this.initializeCache().catch(error => {
      this.logger.debug(
        `[ComponentCache] Error during initial cache check: ${error}`,
        'ComponentCache'
      );
    });

    // Listen for configuration changes to refresh cache
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gitlabComponentHelper.componentSources')) {
        this.logger.debug(
          '[ComponentCache] Configuration changed, forcing refresh...',
          'ComponentCache'
        );
        this.forceRefresh().catch(error => {
          this.logger.debug(
            `[ComponentCache] Error during config refresh: ${error}`,
            'ComponentCache'
          );
        });
      }
    });
  }

  /**
   * Get cached components, refreshing if expired
   */
  public async getComponents(): Promise<CachedComponent[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const cacheTime = config.get<number>('cacheTime', 3600) * 1000; // Default 1 hour

    // Check if cache needs refresh
    if (Date.now() - this.lastRefreshTime > cacheTime && !this.refreshInProgress) {
      this.logger.debug(
        '[ComponentCache] Cache expired, refreshing components...',
        'ComponentCache'
      );
      this.refreshComponents().catch(error => {
        this.logger.debug(`[ComponentCache] Error during refresh: ${error}`, 'ComponentCache');
      });
    } else if (this.components.length > 0) {
      // Components are cached and fresh, but maybe check if we need to refresh versions
      this.refreshVersions().catch(error => {
        this.logger.debug(
          `[ComponentCache] Error during version refresh: ${error}`,
          'ComponentCache'
        );
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
      const existingIndex = this.components.findIndex(
        comp =>
          comp.name === component.name &&
          comp.sourcePath === component.sourcePath &&
          comp.gitlabInstance === component.gitlabInstance &&
          comp.version === component.version
      );

      if (existingIndex >= 0) {
        // Update existing component
        this.components[existingIndex] = component;
        this.logger.debug(
          `[ComponentCache] Updated existing dynamic component: ${component.name}@${component.version}`,
          'ComponentCache'
        );
      } else {
        // Add new component
        this.components.push(component);
        this.logger.debug(
          `[ComponentCache] Added new dynamic component: ${component.name}@${component.version} from ${component.gitlabInstance}/${component.sourcePath}`,
          'ComponentCache'
        );
      }
    } catch (error) {
      this.logger.debug(
        `[ComponentCache] Error adding dynamic component: ${error}`,
        'ComponentCache'
      );
    }
  }

  public getSourceErrors(): Map<string, string> {
    return new Map(this.sourceErrors); // Return a copy
  }

  public hasErrors(): boolean {
    return this.sourceErrors.size > 0;
  }

  /**
   * Refresh all components from configured sources
   */
  public async refreshComponents(): Promise<void> {
    return this.performanceMonitor.track(
      'refreshComponents',
      async () => {
        return this.refreshComponentsInternal();
      }
    );
  }

  private async refreshComponentsInternal(): Promise<void> {
    if (this.refreshInProgress) {
      this.logger.debug(
        '[ComponentCache] Refresh already in progress, skipping...',
        'ComponentCache'
      );
      return;
    }

    this.refreshInProgress = true;
    this.logger.debug('[ComponentCache] Starting component refresh...', 'ComponentCache');

    // Clear project versions cache on full refresh
    this.versionCache.clearCache();

    try{
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const sources = config.get<
        Array<{
          name: string;
          path: string;
          gitlabInstance?: string;
          type?: 'project' | 'group';
        }>
      >('componentSources', []);

      this.logger.debug(
        `[ComponentCache] Found ${sources.length} configured sources`,
        'ComponentCache'
      );

      const newComponents: CachedComponent[] = [];
      this.sourceErrors.clear(); // Clear previous errors

      if (sources.length === 0) {
        this.logger.debug(
          '[ComponentCache] No sources configured, using local components',
          'ComponentCache'
        );
        // Add local fallback components
        newComponents.push(...this.getLocalFallbackComponents());
      } else {
        // Fetch from all configured sources in parallel
        const fetchPromises = sources.map(async source => {
          try {
            // Handle both hostname and full URL formats
            let gitlabInstance = source.gitlabInstance || 'gitlab.com';
            if (gitlabInstance.startsWith('https://')) {
              gitlabInstance = gitlabInstance.replace('https://', '');
            }
            if (gitlabInstance.startsWith('http://')) {
              gitlabInstance = gitlabInstance.replace('http://', '');
            }

            const sourceType = source.type || DEFAULT_COMPONENT_TYPE_PROJECT;
            this.logger.debug(
              `[ComponentCache] Fetching from ${source.name} (${sourceType}: ${gitlabInstance}/${source.path})`,
              'ComponentCache'
            );

            if (sourceType === 'group') {
              // Fetch all projects from the group and then get components from each
              return await this.groupCache.fetchComponentsFromGroup(
                gitlabInstance,
                source.path,
                source.name
              );
            } else {
              // Original project-based fetching
              return await this.projectCache.fetchComponentsFromProject(
                gitlabInstance,
                source.path,
                source.name
              );
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(
              `[ComponentCache] Error fetching from ${source.name}: ${errorMessage}`,
              'ComponentCache'
            );
            this.sourceErrors.set(source.name, errorMessage);
            return [];
          }
        });

        // **GRACEFUL DEGRADATION** - Use Promise.allSettled to handle partial failures
        const results = await Promise.allSettled(fetchPromises);

        // Flatten the results, handling both fulfilled and rejected promises
        for (const result of results) {
          if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            newComponents.push(...result.value);
          } else if (result.status === 'rejected') {
            this.logger.warn(`[ComponentCache] Source fetch rejected: ${result.reason}`, 'ComponentCache');
          }
        }
      }

      this.components = newComponents;
      this.lastRefreshTime = Date.now();

      // Save cache to disk after successful refresh
      await this.saveCacheToDisk();

      this.logger.info(
        `[ComponentCache] Cache updated with ${this.components.length} total components`,
        'ComponentCache'
      );
      this.components.forEach(comp => {
        this.logger.debug(`[ComponentCache]   - ${comp.name} from ${comp.source}`, 'ComponentCache');
      });

      // Fetch available versions for components that don't have them yet
      this.logger.debug(
        `[ComponentCache] Checking which components need version fetching...`,
        'ComponentCache'
      );
      const componentsNeedingVersions = this.components.filter(
        comp => !comp.availableVersions || comp.availableVersions.length === 0
      );

      if (componentsNeedingVersions.length > 0) {
        this.logger.info(
          `[ComponentCache] Fetching versions for ${componentsNeedingVersions.length} components...`,
          'ComponentCache'
        );
        for (const component of componentsNeedingVersions) {
          try {
            await this.fetchComponentVersions(component);
          } catch (error) {
            this.logger.error(
              `[ComponentCache] Error fetching versions for ${component.name}: ${error}`,
              'ComponentCache'
            );
            // Don't fail the whole refresh for version fetch errors
          }
        }
      } else {
        this.logger.info(
          `[ComponentCache] All components already have cached versions`,
          'ComponentCache'
        );
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
    this.logger.debug(
      `[ComponentCache] Adding component to cache: ${component.name}@${component.version}`,
      'ComponentCache'
    );

    // Check if component already exists (same name, source, and version)
    const existingIndex = this.components.findIndex(
      c =>
        c.name === component.name &&
        c.gitlabInstance === component.gitlabInstance &&
        c.sourcePath === component.sourcePath &&
        c.version === component.version
    );

    if (existingIndex >= 0) {
      // Update existing component
      this.logger.debug(
        `[ComponentCache] Updating existing component: ${component.name}@${component.version}`,
        'ComponentCache'
      );
      this.components[existingIndex] = component;
    } else {
      // Add new component
      this.logger.debug(
        `[ComponentCache] Adding new component: ${component.name}@${component.version}`,
        'ComponentCache'
      );
      this.components.push(component);
    }
  }

  /**
   * Fetch and cache all available versions for a specific component
   */
  public async fetchComponentVersions(component: CachedComponent): Promise<string[]> {
    try {
      const sortedVersions = await this.versionCache.fetchComponentVersions(component);

      // Update the component in cache with available versions
      const cachedComponent = this.components.find(
        c =>
          c.name === component.name &&
          c.sourcePath === component.sourcePath &&
          c.gitlabInstance === component.gitlabInstance
      );

      if (cachedComponent) {
        cachedComponent.availableVersions = sortedVersions;
        // Save cache after updating versions
        await this.saveCacheToDisk();
      }

      return sortedVersions;
    } catch (error) {
      this.logger.error(
        `[ComponentCache] Error fetching versions for ${component.name}: ${error}`,
        'ComponentCache'
      );
      return [component.version]; // Return current version as fallback
    }
  }

  /**
   * Fetch a specific version of a component and add it to cache
   */
  public async fetchSpecificVersion(
    componentName: string,
    sourcePath: string,
    gitlabInstance: string,
    version: string
  ): Promise<CachedComponent | null> {
    // Check if this version is already cached
    const existingComponent = this.components.find(
      c =>
        c.name === componentName &&
        c.sourcePath === sourcePath &&
        c.gitlabInstance === gitlabInstance &&
        c.version === version
    );

    if (existingComponent) {
      this.logger.info(`[ComponentCache] Version ${version} already cached`, 'ComponentCache');
      return existingComponent;
    }

    // Delegate to ProjectCache
    const cachedComponent = await this.projectCache.fetchSpecificVersion(
      componentName,
      sourcePath,
      gitlabInstance,
      version
    );

    if (cachedComponent) {
      this.components.push(cachedComponent);
    }

    return cachedComponent;
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
      this.logger.info(
        `[ComponentCache] Cache is still valid (${this.components.length} components, ${Math.round(
          (Date.now() - this.lastRefreshTime) / 1000
        )}s old), skipping refresh`,
        'ComponentCache'
      );
      this.logger.debug(`[ComponentCache] Cache location: ${cacheInfo.location}`, 'ComponentCache');
      return;
    }

    // If cache is empty or expired, do initial refresh
    this.logger.info(
      '[ComponentCache] Cache is empty or expired, performing initial refresh...',
      'ComponentCache'
    );
    await this.refreshComponents();
  }

  /**
   * Check if version cache needs refreshing (less frequent than component cache)
   */
  private shouldRefreshVersions(): boolean {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    // Use 4x the component cache time for version refreshes
    const versionRefreshInterval = config.get<number>('cacheTime', 3600) * 4 * 1000;
    return Date.now() - this.lastRefreshTime > versionRefreshInterval;
  }

  /**
   * Refresh versions for all components (can be called separately from component refresh)
   */
  public async refreshVersions(): Promise<void> {
    if (!this.shouldRefreshVersions()) {
      this.logger.info(
        '[ComponentCache] Version cache is still fresh, skipping version refresh',
        'ComponentCache'
      );
      return;
    }

    this.logger.info(
      '[ComponentCache] Refreshing versions for all components...',
      'ComponentCache'
    );

    for (const component of this.components) {
      try {
        // Clear cached versions to force refresh
        component.availableVersions = undefined;
        await this.fetchComponentVersions(component);
      } catch (error) {
        this.logger.error(
          `[ComponentCache] Error refreshing versions for ${component.name}: ${error}`,
          'ComponentCache'
        );
      }
    }
  }

  /**
   * Load cache from extension global state
   */
  private async loadCacheFromDisk(): Promise<void> {
    try {
      if (!this.context) {
        this.logger.warn(
          '[ComponentCache] No extension context available, starting with empty cache',
          'ComponentCache'
        );
        return;
      }

      const cacheData = this.context.globalState.get<PersistentCacheData>('componentCache');

      if (cacheData && cacheData.components && Array.isArray(cacheData.components)) {
        this.components = cacheData.components;
        this.lastRefreshTime = cacheData.lastRefreshTime || 0;

        // Restore version cache
        if (cacheData.projectVersionsCache) {
          this.versionCache.deserializeCache(cacheData.projectVersionsCache);
        }

        this.logger.info(
          `[ComponentCache] Loaded ${this.components.length} components from global state`,
          'ComponentCache'
        );
        this.logger.debug(
          `[ComponentCache] Cache last updated: ${new Date(this.lastRefreshTime).toISOString()}`,
          'ComponentCache'
        );
        this.logger.debug(
          `[ComponentCache] Cache storage: VS Code Global State (persists across sessions)`,
          'ComponentCache'
        );
      } else {
        this.logger.info(
          '[ComponentCache] No cached data found in global state, will create new cache',
          'ComponentCache'
        );
        this.logger.debug(
          '[ComponentCache] Cache storage: VS Code Global State (persists across sessions)',
          'ComponentCache'
        );
      }
    } catch (error) {
      this.logger.error(
        `[ComponentCache] Error loading cache from global state: ${error}`,
        'ComponentCache'
      );
      // Reset to empty cache on error
      this.components = [];
      this.lastRefreshTime = 0;
      this.versionCache.clearCache();
    }
  }

  /**
   * Save cache to extension global state
   */
  private async saveCacheToDisk(): Promise<void> {
    try {
      if (!this.context) {
        this.logger.warn(
          '[ComponentCache] No extension context available, cannot save cache',
          'ComponentCache'
        );
        return;
      }

      const cacheData: PersistentCacheData = {
        components: this.components,
        lastRefreshTime: this.lastRefreshTime,
        projectVersionsCache: this.versionCache.serializeCache(),
        version: '1.0.0', // For future cache format migrations
      };

      await this.context.globalState.update('componentCache', cacheData);

      this.logger.info(
        `[ComponentCache] Saved cache to global state (${this.components.length} components)`,
        'ComponentCache'
      );
      this.logger.debug(
        `[ComponentCache] Cache storage: VS Code Global State (persists across sessions)`,
        'ComponentCache'
      );
    } catch (error) {
      this.logger.error(
        `[ComponentCache] Error saving cache to global state: ${error}`,
        'ComponentCache'
      );
    }
  }

  /**
   * Set the extension context (for cases where cache manager is created before context is available)
   */
  public setContext(context: vscode.ExtensionContext): void {
    if (!this.context) {
      this.context = context;
      this.logger.info(
        '[ComponentCache] Extension context set, cache persistence now enabled',
        'ComponentCache'
      );
      this.logger.debug(
        '[ComponentCache] Cache storage: VS Code Global State (persists across sessions)',
        'ComponentCache'
      );
    }
  }

  /**
   * Get cache location information for debugging
   */
  public getCacheInfo(): {
    location: string;
    size: number;
    lastUpdate: string;
    hasContext: boolean;
  } {
    const lastUpdateDate =
      this.lastRefreshTime > 0 ? new Date(this.lastRefreshTime).toISOString() : 'Never';

    return {
      location: this.context ? CACHE_LOCATION_GLOBAL_STATE : CACHE_LOCATION_MEMORY_ONLY,
      size: this.components.length,
      lastUpdate: lastUpdateDate,
      hasContext: !!this.context,
    };
  }

  /**
   * Update cache - Forces refresh of all cached data
   */
  public async updateCache(): Promise<void> {
    this.logger.info('[ComponentCache] Updating cache - forcing refresh of all data');

    // Force refresh of components from all sources
    await this.forceRefresh();

    // Also trigger update on the ComponentService singleton
    const componentService = getComponentService();
    componentService.updateCache();

    this.logger.info('[ComponentCache] Cache update completed successfully');
  }

  /**
   * Reset cache - Completely clears all cached data
   */
  public async resetCache(): Promise<void> {
    this.logger.info('[ComponentCache] Resetting cache - clearing all cached data');

    // Clear in-memory caches
    this.components = [];
    this.versionCache.clearCache();
    this.sourceErrors.clear();
    this.lastRefreshTime = 0;

    // Clear persistent storage if available
    if (this.context) {
      try {
        await this.context.globalState.update('gitlabComponentHelper.cachedComponents', undefined);
        await this.context.globalState.update('gitlabComponentHelper.cacheTimestamp', undefined);
        this.logger.debug('[ComponentCache] Cleared persistent cache storage', 'ComponentCache');
      } catch (error) {
        this.logger.warn(
          `[ComponentCache] Failed to clear persistent storage: ${error}`,
          'ComponentCache'
        );
      }
    }

    // Also trigger reset on the ComponentService singleton
    const componentService = getComponentService();
    componentService.resetCache();

    this.logger.info('[ComponentCache] Cache reset completed successfully');
  }

  /**
   * Get detailed cache statistics
   */
  public getCacheStats(): {
    componentsCount: number;
    projectVersionsCacheCount: number;
    sourceErrorsCount: number;
    lastRefreshTime: number;
    memoryUsage: {
      components: string[];
      projectVersions: string[];
      sourceErrors: string[];
    };
    componentService: {
      catalogCacheSize: number;
      componentCacheSize: number;
      sourceCacheSize: number;
    };
  } {
    const componentService = getComponentService();
    const serviceStats = componentService.getCacheStats();
    const versionCacheStats = this.versionCache.getCacheStats();

    return {
      componentsCount: this.components.length,
      projectVersionsCacheCount: versionCacheStats.count,
      sourceErrorsCount: this.sourceErrors.size,
      lastRefreshTime: this.lastRefreshTime,
      memoryUsage: {
        components: this.components.map(c => `${c.name} (${c.source})`),
        projectVersions: versionCacheStats.keys,
        sourceErrors: Array.from(this.sourceErrors.keys()),
      },
      componentService: {
        catalogCacheSize: serviceStats.catalogCacheSize,
        componentCacheSize: serviceStats.componentCacheSize,
        sourceCacheSize: serviceStats.sourceCacheSize,
      },
    };
  }

  /**
   * Get local fallback components when no sources are configured
   */
  private getLocalFallbackComponents(): CachedComponent[] {
    return [
      {
        name: 'deploy-component',
        description: 'Deploys the application to the specified environment',
        parameters: [
          {
            name: 'environment',
            description: 'Target environment for deployment',
            required: true,
            type: 'string',
          },
          {
            name: 'version',
            description: 'Version to deploy',
            required: false,
            type: 'string',
            default: 'latest',
          },
        ],
        source: SOURCE_LOCAL,
        sourcePath: 'local',
        gitlabInstance: 'local',
        version: 'latest',
        url: 'deploy-component',
      },
      {
        name: 'test-component',
        description: 'Runs tests for the application',
        parameters: [
          {
            name: 'test_type',
            description: 'Type of tests to run',
            required: true,
            type: 'string',
          },
          {
            name: 'coverage',
            description: 'Whether to collect coverage information',
            required: false,
            type: 'boolean',
            default: false,
          },
        ],
        source: SOURCE_LOCAL,
        sourcePath: 'local',
        gitlabInstance: 'local',
        version: 'latest',
        url: 'test-component',
      },
    ];
  }
}

// Singleton instance
let cacheManager: ComponentCacheManager | null = null;

export function getComponentCacheManager(
  context?: vscode.ExtensionContext
): ComponentCacheManager {
  if (!cacheManager) {
    cacheManager = new ComponentCacheManager(context);
  } else if (context && !cacheManager['context']) {
    // Set context if it wasn't available during initial creation
    cacheManager.setContext(context);
  }
  return cacheManager;
}
