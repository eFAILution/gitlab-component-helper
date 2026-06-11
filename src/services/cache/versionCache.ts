import { getComponentService } from '../component';
import { compileTagTemplate, scopeTagsToComponent } from '../component/tagScoping';
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
  // Cache for a project's raw tag names: key = `${gitlabInstance}|${sourcePath}`. Shared across every component in
  // the project so the tag list is fetched once, then scoped per component for monorepo sources.
  private projectTagsCache: Map<string, string[]> = new Map();
  // Cache for a project's default branch name (e.g. `main`), keyed the same way. `null` means "looked up, none found".
  private projectDefaultBranchCache: Map<string, string | null> = new Map();

  /**
   * Fetch and cache all available versions for a specific component.
   *
   * The project's tag list is fetched once and cached per project. For a monorepo source (one carrying a
   * `tagPattern`), the tags are then scoped to the component using that template so the component only
   * surfaces its own releases; otherwise the full project tag list is used (single-component behaviour).
   *
   * @param component Component to fetch versions for
   * @returns Array of sorted version strings (full prefixed tags for monorepo sources, plus `main`/`master`)
   */
  async fetchComponentVersions(component: CachedComponent): Promise<string[]> {
    try {
      const cacheKey = `${component.gitlabInstance}|${component.sourcePath}`;
      let projectTags: string[] | undefined = this.projectTagsCache.get(cacheKey);

      if (projectTags) {
        this.logger.info(
          `[VersionCache] [CACHE HIT] Reusing cached tags for project ${component.gitlabInstance}/${component.sourcePath}`,
          'VersionCache'
        );
      } else {
        const componentService = getComponentService();
        const [tags, defaultBranch] = await Promise.all([
          componentService.fetchProjectTags(component.gitlabInstance, component.sourcePath),
          componentService.fetchProjectDefaultBranch(component.gitlabInstance, component.sourcePath),
        ]);
        projectTags = tags.map(tag => tag.name).filter(Boolean);
        this.projectTagsCache.set(cacheKey, projectTags);
        this.projectDefaultBranchCache.set(cacheKey, defaultBranch);

        this.logger.info(
          `[VersionCache] [API FETCH] Fetched ${projectTags.length} tags for project ${component.gitlabInstance}/${component.sourcePath}`,
          'VersionCache'
        );
      }

      const scopedTags = component.tagPattern
        ? scopeTagsToComponent(projectTags, component.name, component.tagPattern)
        : projectTags;

      // Add the project's real default branch (if any); remove duplicates and sort by priority.
      const defaultBranch = this.projectDefaultBranchCache.get(cacheKey);
      const branches = defaultBranch ? [defaultBranch] : [];
      const uniqueVersions = Array.from(new Set([...branches, ...scopedTags]));
      const sortedVersions = this.sortVersionsByPriority(
        uniqueVersions,
        component.tagPattern ? component : undefined,
      );

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
   * Sort versions by priority (latest semantic versions first, branches last).
   *
   * Priority order:
   * 1. Semantic versions (vX.Y.Z) sorted by version number descending
   * 2. main branch
   * 3. master branch
   * 4. Other versions
   *
   * @param versions Array of version strings
   * @param monorepoComponent When set, each version is scored with its tag-version template applied (the `{version}`
   *                          capture), so monorepo tags (`<name>-1.1.0`, `apps/<name>/v1.1.0`) rank by their
   *                          underlying semver. The returned strings are the originals (full tags) — only the
   *                          scoring strips.
   * @returns Sorted array with highest priority first
   */
  sortVersionsByPriority(
    versions: string[],
    monorepoComponent?: { name: string; tagPattern?: string },
  ): string[] {
    const matcher = monorepoComponent
      ? compileTagTemplate(monorepoComponent.tagPattern, monorepoComponent.name)
      : null;
    const strip = (version: string): string => matcher?.extractVersion(version) ?? version;

    return versions.sort((a, b) => {
      // Branch names sort below all semantic versions; `main`/`master` keep a fixed order above other branches.
      const versionPriority = (version: string) => {
        if (version === 'main') return 2;
        if (version === 'master') return 1;

        const stripped = strip(version);

        // Full semantic versions get priority based on version number, well above the branch fallbacks.
        const semanticMatch = stripped.match(/^v?(\d+)\.(\d+)\.(\d+)/);
        if (semanticMatch) {
          const major = parseInt(semanticMatch[1]);
          const minor = parseInt(semanticMatch[2]);
          const patch = parseInt(semanticMatch[3]);
          return 1000 + major * 1000000 + minor * 1000 + patch;
        }

        // A bare `<major>` (the floating monorepo major-alias tag) ranks just below that major's pinned releases.
        const majorMatch = stripped.match(/^v?(\d+)$/);
        if (majorMatch) {
          return 1000 + parseInt(majorMatch[1]) * 1000000;
        }

        return 0; // Lowest priority for other versions
      };

      return versionPriority(b) - versionPriority(a); // Descending order
    });
  }

  /**
   * Clear the project tags and default-branch caches
   */
  clearCache(): void {
    this.projectTagsCache.clear();
    this.projectDefaultBranchCache.clear();
    this.logger.debug('[VersionCache] Cleared project tags cache', 'VersionCache');
  }

  /**
   * Get a project's cached raw tag names (if available)
   *
   * @param gitlabInstance GitLab instance hostname
   * @param sourcePath Project path
   * @returns Cached tag names or undefined if not cached
   */
  getCachedVersions(gitlabInstance: string, sourcePath: string): string[] | undefined {
    const cacheKey = `${gitlabInstance}|${sourcePath}`;
    return this.projectTagsCache.get(cacheKey);
  }

  /**
   * Get serializable cache data for persistence
   *
   * @returns Array of [key, tags] tuples
   */
  serializeCache(): Array<[string, string[]]> {
    return Array.from(this.projectTagsCache.entries());
  }

  /**
   * Restore cache from serialized data
   *
   * @param data Array of [key, tags] tuples
   */
  deserializeCache(data: Array<[string, string[]]>): void {
    this.projectTagsCache = new Map(data);
    this.logger.debug(
      `[VersionCache] Restored ${this.projectTagsCache.size} cached tag entries`,
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
      count: this.projectTagsCache.size,
      keys: Array.from(this.projectTagsCache.keys()),
    };
  }
}
