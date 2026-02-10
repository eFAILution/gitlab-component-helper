import * as vscode from 'vscode';
import { getComponentService } from '../component';
import { Logger } from '../../utils/logger';
import { CachedComponent } from '../../types/cache';

/**
 * VersionCache - Handles version fetching and caching for components
 *
 * Responsibilities:
 * - Fetch available versions (tags + branches) for projects
 * - Cache project versions to avoid redundant API calls
 * - Sort versions by priority (semantic versioning)
 * - Update component availableVersions field
 */
export class VersionCache {
  private logger = Logger.getInstance();
  // Cache for project versions: key = `${gitlabInstance}|${sourcePath}`
  private projectVersionsCache: Map<string, string[]> = new Map();

  /**
   * Fetch and cache all available versions for a specific component
   *
   * @param component Component to fetch versions for
   * @returns Array of sorted version strings
   */
  async fetchComponentVersions(component: CachedComponent): Promise<string[]> {
    try {
      const cacheKey = `${component.gitlabInstance}|${component.sourcePath}`;
      let sortedVersions: string[] | undefined = this.projectVersionsCache.get(cacheKey);

      if (sortedVersions) {
        this.logger.info(
          `[VersionCache] [CACHE HIT] Reusing cached versions for project ${component.gitlabInstance}/${component.sourcePath}`,
          'VersionCache'
        );
      } else {
        const componentService = getComponentService();
        const tags = await componentService.fetchProjectTags(
          component.gitlabInstance,
          component.sourcePath
        );

        // Extract version names and add common branch names
        const versions = ['main', 'master', ...tags.map(tag => tag.name)];

        // Remove duplicates and sort by priority
        const uniqueVersions = Array.from(new Set(versions));
        sortedVersions = this.sortVersionsByPriority(uniqueVersions);

        this.projectVersionsCache.set(cacheKey, sortedVersions);

        this.logger.info(
          `[VersionCache] [API FETCH] Fetched ${sortedVersions.length} versions for project ${component.gitlabInstance}/${component.sourcePath}`,
          'VersionCache'
        );
      }

      this.logger.debug(
        `[VersionCache] Available versions for ${component.name}: ${sortedVersions
          .slice(0, 5)
          .join(', ')}${sortedVersions.length > 5 ? '...' : ''}`,
        'VersionCache'
      );

      return sortedVersions;
    } catch (error) {
      this.logger.error(
        `[VersionCache] Error fetching versions for ${component.name}: ${error}`,
        'VersionCache'
      );
      return [component.version]; // Return current version as fallback
    }
  }

  /**
   * Sort versions by priority (latest semantic versions first)
   *
   * Priority order:
   * 1. main branch (priority 1000)
   * 2. master branch (priority 900)
   * 3. Semantic versions (vX.Y.Z) sorted by version number descending
   * 4. Other versions (priority 0)
   *
   * @param versions Array of version strings
   * @returns Sorted array with highest priority first
   */
  sortVersionsByPriority(versions: string[]): string[] {
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
   * Clear the project versions cache
   */
  clearCache(): void {
    this.projectVersionsCache.clear();
    this.logger.debug('[VersionCache] Cleared project versions cache', 'VersionCache');
  }

  /**
   * Get cached project versions (if available)
   *
   * @param gitlabInstance GitLab instance hostname
   * @param sourcePath Project path
   * @returns Cached versions or undefined if not cached
   */
  getCachedVersions(gitlabInstance: string, sourcePath: string): string[] | undefined {
    const cacheKey = `${gitlabInstance}|${sourcePath}`;
    return this.projectVersionsCache.get(cacheKey);
  }

  /**
   * Get serializable cache data for persistence
   *
   * @returns Array of [key, versions] tuples
   */
  serializeCache(): Array<[string, string[]]> {
    return Array.from(this.projectVersionsCache.entries());
  }

  /**
   * Restore cache from serialized data
   *
   * @param data Array of [key, versions] tuples
   */
  deserializeCache(data: Array<[string, string[]]>): void {
    this.projectVersionsCache = new Map(data);
    this.logger.debug(
      `[VersionCache] Restored ${this.projectVersionsCache.size} cached version entries`,
      'VersionCache'
    );
  }

  /**
   * Get cache statistics
   *
   * @returns Cache stats object
   */
  getCacheStats(): {
    count: number;
    keys: string[];
  } {
    return {
      count: this.projectVersionsCache.size,
      keys: Array.from(this.projectVersionsCache.keys()),
    };
  }
}
