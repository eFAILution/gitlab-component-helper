import { Logger } from '../../utils/logger';
import { HttpClient } from '../../utils/httpClient';
import { TokenManager } from './tokenManager';
import { scopeTagsToComponent } from './tagScoping';
import type { GitLabProjectInfo, GitLabTag, GitLabBranch } from '../../types/api';
import { NetworkError } from '../../errors';

/**
 * Manages fetching and sorting versions (tags and branches) for GitLab projects
 */
export class VersionManager {
  private logger = Logger.getInstance();
  private httpClient: HttpClient;
  private tokenManager: TokenManager;

  constructor(httpClient: HttpClient, tokenManager: TokenManager) {
    this.httpClient = httpClient;
    this.tokenManager = tokenManager;
  }

  /**
   * Fetch all tags/versions for a GitLab project with optimizations
   * @param gitlabInstance The GitLab instance hostname
   * @param projectPath The project path
   * @param scopeToComponent When set, the project is treated as a tag-per-component monorepo and tags are scoped to
   *                         this component using `tagPattern` (full tags retained as the version strings).
   * @param tagPattern The tag-version template for scoping (e.g. `{name}-{version}`); defaults to the house
   *                           convention when omitted.
   * @returns Array of version strings (tags and important branches)
   */
  public async fetchProjectVersions(
    gitlabInstance: string,
    projectPath: string,
    scopeToComponent?: string,
    tagPattern?: string
  ): Promise<string[]> {
    const startTime = Date.now();

    try {
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
      const encodedPath = encodeURIComponent(projectPath);

      this.logger.info(`Fetching versions for ${gitlabInstance}/${projectPath}`);

      // Try to get a token for this project/instance
      const token = await this.tokenManager.getTokenForProject(gitlabInstance);
      const fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      this.logger.debug(`Using token for versions fetch: ${token ? 'YES' : 'NO'}`);

      // First, get project info to get the project ID
      const projectInfo = await this.httpClient.fetchJson<GitLabProjectInfo>(
        `${apiBaseUrl}/projects/${encodedPath}`,
        fetchOptions
      );

      if (!projectInfo || !projectInfo.id) {
        this.logger.warn(`Could not get project info for ${projectPath}`);
        return ['main'];
      }

      // Fetch tags and branches in parallel. Both are fully paginated so neither is silently truncated on projects
      // with many tags/branches.
      const [tagsResult, branchesResult] = await Promise.allSettled([
        this.httpClient.fetchAllPages<GitLabTag>(
          `${apiBaseUrl}/projects/${projectInfo.id}/repository/tags?sort=desc`,
          fetchOptions
        ),
        this.httpClient.fetchAllPages<GitLabBranch>(
          `${apiBaseUrl}/projects/${projectInfo.id}/repository/branches`,
          fetchOptions
        )
      ]);

      const versions: string[] = [];

      // Process tags
      if (tagsResult.status === 'fulfilled' && Array.isArray(tagsResult.value)) {
        const tagNames = tagsResult.value
          .map(tag => tag.name)
          .filter(name => name);
        const tagVersions = scopeToComponent
          ? scopeTagsToComponent(tagNames, scopeToComponent, tagPattern)
          : tagNames;
        versions.push(...tagVersions);
        this.logger.debug(`Found ${tagVersions.length} tags`);
      } else {
        this.logger.warn(
          `Error fetching tags: ${
            tagsResult.status === 'rejected' ? tagsResult.reason : 'Unknown error'
          }`
        );
      }

      // Process branches
      if (branchesResult.status === 'fulfilled' && Array.isArray(branchesResult.value)) {
        const importantBranches = branchesResult.value
          .map(branch => branch.name)
          .filter(name => ['main', 'master', 'develop', 'dev'].includes(name));
        versions.push(...importantBranches);
        this.logger.debug(`Found ${importantBranches.length} important branches`);
      } else {
        this.logger.warn(
          `Error fetching branches: ${
            branchesResult.status === 'rejected' ? branchesResult.reason : 'Unknown error'
          }`
        );
      }

      // Remove duplicates and sort
      const uniqueVersions = Array.from(new Set(versions));
      const sortedVersions = this.sortVersionsByPriority(uniqueVersions);

      const result = sortedVersions.length > 0 ? sortedVersions : ['main'];

      this.logger.info(
        `Returning ${result.length} versions: ${result.slice(0, 5).join(', ')}${
          result.length > 5 ? '...' : ''
        }`
      );
      this.logger.logPerformance('fetchProjectVersions', Date.now() - startTime, {
        projectPath,
        versionCount: result.length
      });

      return result;
    } catch (error) {
      this.logger.error(`Error fetching project versions: ${error}`);
      return ['main'];
    }
  }

  /**
   * Fetch all tags for a GitLab project
   * @param gitlabInstance The GitLab instance hostname
   * @param projectPath The project path
   * @returns Array of tag objects with name and commit info
   */
  public async fetchProjectTags(
    gitlabInstance: string,
    projectPath: string
  ): Promise<GitLabTag[]> {
    const startTime = Date.now();
    this.logger.info(`Fetching tags for ${gitlabInstance}/${projectPath}`);

    try {
      const apiUrl = `https://${gitlabInstance}/api/v4/projects/${encodeURIComponent(
        projectPath
      )}/repository/tags?order_by=updated&sort=desc`;

      const token = await this.tokenManager.getTokenForProject(gitlabInstance);
      const options = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;
      const tags = await this.httpClient.fetchAllPages<GitLabTag>(apiUrl, options);

      this.logger.info(`Found ${tags.length} tags for ${projectPath}`);
      this.logger.logPerformance('fetchProjectTags', Date.now() - startTime, {
        projectPath,
        tagCount: tags.length
      });

      return tags;
    } catch (error) {
      this.logger.warn(`Error fetching tags: ${error}`);
      return [];
    }
  }

  /**
   * Fetch a project's default branch name (e.g. `main`) from its project info.
   *
   * @param gitlabInstance The GitLab instance hostname.
   * @param projectPath The project path; URL-encoded internally.
   * @returns The default branch name, or null if it can't be resolved (network error, no access).
   */
  public async fetchProjectDefaultBranch(
    gitlabInstance: string,
    projectPath: string
  ): Promise<string | null> {
    try {
      const apiUrl = `https://${gitlabInstance}/api/v4/projects/${encodeURIComponent(projectPath)}`;
      const token = await this.tokenManager.getTokenForProject(gitlabInstance);
      const options = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;
      const projectInfo = await this.httpClient.fetchJson<GitLabProjectInfo>(apiUrl, options);
      return projectInfo?.default_branch || null;
    } catch (error) {
      this.logger.debug(
        `[VersionManager] Could not resolve default branch for ${projectPath}: ${error}`
      );
      return null;
    }
  }

  /**
   * Resolve the HEAD commit SHA of a branch in a single cheap API call.
   *
   * Used to revalidate cached components that are pinned to a (mutable) branch: if the branch HEAD still matches the
   * SHA stored alongside the cache entry, the cached data is still current and a full re-fetch can be skipped.
   *
   * @param gitlabInstance The GitLab instance hostname (e.g. `gitlab.com`).
   * @param projectPath The project path (e.g. `my-group/shared-ci`); URL-encoded internally.
   * @param branch The branch name to resolve; URL-encoded internally (supports `/`-containing names).
   * @returns The commit SHA, or null if the branch can't be resolved (network error, missing branch, no access) —
   *          callers should treat null as "unknown, keep serving cache" rather than "unchanged" or "changed".
   */
  public async resolveBranchSha(
    gitlabInstance: string,
    projectPath: string,
    branch: string
  ): Promise<string | null> {
    try {
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
      const encodedPath = encodeURIComponent(projectPath);
      const encodedBranch = encodeURIComponent(branch);
      const url = `${apiBaseUrl}/projects/${encodedPath}/repository/branches/${encodedBranch}`;

      const token = await this.tokenManager.getTokenForProject(gitlabInstance);
      const options = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      const branchInfo = await this.httpClient.fetchJson<GitLabBranch>(url, options);
      const sha = branchInfo?.commit?.id;

      if (!sha) {
        this.logger.debug(
          `[VersionManager] No commit SHA returned for ${projectPath}@${branch}`
        );
        return null;
      }

      this.logger.debug(
        `[VersionManager] Resolved ${projectPath}@${branch} to ${sha.slice(0, 8)}`
      );
      return sha;
    } catch (error) {
      this.logger.debug(
        `[VersionManager] Could not resolve branch SHA for ${projectPath}@${branch}: ${error}`
      );
      return null;
    }
  }

  /**
   * Determine whether a ref is a tag
   *
   * @param gitlabInstance The GitLab instance hostname (e.g. `gitlab.com`).
   * @param projectPath The project path (e.g. `my-group/shared-ci`);
   * @param ref The ref name to classify;
   * @returns `true` if the ref is a tag, `false` if it is definitively not a tag, or`null` when the answer can't be
   *          determined.
   */
  public async isRefATag(
    gitlabInstance: string,
    projectPath: string,
    ref: string
  ): Promise<boolean | null> {
    const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
    const encodedPath = encodeURIComponent(projectPath);
    const encodedRef = encodeURIComponent(ref);
    const url = `${apiBaseUrl}/projects/${encodedPath}/repository/tags/${encodedRef}`;

    try {
      const token = await this.tokenManager.getTokenForProject(gitlabInstance);
      const options = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      await this.httpClient.fetchJson<GitLabTag>(url, options);
      this.logger.debug(`[VersionManager] ${projectPath}@${ref} is a tag`);
      return true;
    } catch (error) {
      if (error instanceof NetworkError && error.details?.statusCode === 404) {
        // Definitive: no tag by this name exists, so the ref is a branch (or doesn't exist).
        this.logger.debug(`[VersionManager] ${projectPath}@${ref} is not a tag (404)`);
        return false;
      }
      // Anything else (offline, 401/403, 5xx) — we genuinely don't know.
      this.logger.debug(
        `[VersionManager] Could not determine tag status for ${projectPath}@${ref}: ${error}`
      );
      return null;
    }
  }

  /**
   * Sort versions with semantic versions first, then branches
   * Priority order: semantic versions (newest first) > other versions > main/master branches
   * @param versions Array of version strings to sort
   * @returns Sorted array of version strings
   */
  public sortVersionsByPriority(versions: string[]): string[] {
    return versions.sort((a, b) => {
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
  }
}
