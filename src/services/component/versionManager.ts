import { Logger } from '../../utils/logger';
import { HttpClient } from '../../utils/httpClient';
import { TokenManager } from './tokenManager';

interface GitLabTag {
  name: string;
  commit: any;
}

interface GitLabBranch {
  name: string;
}

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
   * @returns Array of version strings (tags and important branches)
   */
  public async fetchProjectVersions(
    gitlabInstance: string,
    projectPath: string
  ): Promise<string[]> {
    const startTime = Date.now();

    try {
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
      const encodedPath = encodeURIComponent(projectPath);

      this.logger.info(`Fetching versions for ${gitlabInstance}/${projectPath}`);

      // Try to get a token for this project/instance
      const token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
      const fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      this.logger.debug(`Using token for versions fetch: ${token ? 'YES' : 'NO'}`);

      // First, get project info to get the project ID
      const projectInfo = await this.httpClient.fetchJson(
        `${apiBaseUrl}/projects/${encodedPath}`,
        fetchOptions
      );

      if (!projectInfo || !projectInfo.id) {
        this.logger.warn(`Could not get project info for ${projectPath}`);
        return ['main'];
      }

      // Fetch tags and branches in parallel
      const [tagsResult, branchesResult] = await Promise.allSettled([
        this.httpClient.fetchJson(
          `${apiBaseUrl}/projects/${projectInfo.id}/repository/tags?per_page=100&sort=desc`,
          fetchOptions
        ),
        this.httpClient.fetchJson(
          `${apiBaseUrl}/projects/${projectInfo.id}/repository/branches?per_page=20`,
          fetchOptions
        )
      ]);

      const versions: string[] = [];

      // Process tags
      if (tagsResult.status === 'fulfilled' && Array.isArray(tagsResult.value)) {
        const tagVersions = tagsResult.value
          .map((tag: any) => tag.name)
          .filter((name: string) => name);
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
          .map((branch: any) => branch.name)
          .filter((name: string) => ['main', 'master', 'develop', 'dev'].includes(name));
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
      )}/repository/tags?per_page=100&order_by=updated&sort=desc`;

      const token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
      const options = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;
      const tags = await this.httpClient.fetchJson(apiUrl, options);

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
