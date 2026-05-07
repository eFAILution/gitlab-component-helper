import * as vscode from 'vscode';
import { getComponentService } from '../component';
import { Logger } from '../../utils/logger';
import { CachedComponent } from '../../types/cache';
import { ProjectCache } from './projectCache';

/**
 * GroupCache - Handles fetching components from GitLab groups
 *
 * Responsibilities:
 * - Fetch all projects within a group (including subgroups)
 * - Scan projects in batches to avoid API overwhelming
 * - Delegate individual project fetching to ProjectCache
 * - Handle group-specific errors
 */
export class GroupCache {
  private logger = Logger.getInstance();
  private projectCache: ProjectCache;

  constructor(projectCache: ProjectCache) {
    this.projectCache = projectCache;
  }

  /**
   * Fetch components from all projects in a GitLab group
   *
   * @param gitlabInstance GitLab instance hostname
   * @param groupPath Group path (e.g., 'my-group' or 'my-group/subgroup')
   * @param sourceName Display name for this source
   * @returns Array of cached components from all projects in the group
   */
  async fetchComponentsFromGroup(
    gitlabInstance: string,
    groupPath: string,
    sourceName: string
  ): Promise<CachedComponent[]> {
    this.logger.info(
      `[GroupCache] Fetching projects from group: ${gitlabInstance}/${groupPath}`,
      'GroupCache'
    );

    try {
      // First, get all projects in the group
      const groupProjects = await this.fetchGroupProjects(gitlabInstance, groupPath);
      this.logger.info(
        `[GroupCache] Found ${groupProjects.length} projects in group ${groupPath}`,
        'GroupCache'
      );

      if (groupProjects.length === 0) {
        this.logger.info(`[GroupCache] No projects found in group ${groupPath}`, 'GroupCache');
        return [];
      }

      // Fetch components from each project in parallel (with concurrency control)
      this.logger.debug(
        `[GroupCache] Checking ${groupProjects.length} projects for components (this may take a moment)...`,
        'GroupCache'
      );

      // Process projects in batches to avoid overwhelming the API
      const batchSize = 5;
      const allComponents: CachedComponent[] = [];
      let projectsWithComponents = 0;

      for (let i = 0; i < groupProjects.length; i += batchSize) {
        const batch = groupProjects.slice(i, i + batchSize);
        this.logger.debug(
          `[GroupCache] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            groupProjects.length / batchSize
          )} (projects ${i + 1}-${Math.min(i + batchSize, groupProjects.length)})`,
          'GroupCache'
        );

        const batchPromises = batch.map(async (project: any) => {
          try {
            this.logger.debug(
              `[GroupCache] Checking ${project.path_with_namespace}...`,
              'GroupCache'
            );

            // Try to fetch components from this project using ProjectCache
            const components = await this.projectCache.fetchComponentsFromProject(
              gitlabInstance,
              project.path_with_namespace,
              `${sourceName}/${project.name}`
            );

            if (components.length > 0) {
              this.logger.info(
                `[GroupCache] ✓ Found ${components.length} components in ${project.path_with_namespace}`,
                'GroupCache'
              );
              return { project, components };
            } else {
              this.logger.debug(
                `[GroupCache] - No components in ${project.path_with_namespace}`,
                'GroupCache'
              );
              return { project, components: [] };
            }
          } catch (error) {
            // Log but don't fail the whole group if one project fails
            this.logger.error(
              `[GroupCache] ✗ Error checking ${project.path_with_namespace}: ${error}`,
              'GroupCache'
            );
            return { project, components: [] };
          }
        });

        // **GRACEFUL DEGRADATION** - Use Promise.allSettled for partial failures
        const batchResults = await Promise.allSettled(batchPromises);

        // Add successful components to the total
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value.components.length > 0) {
            allComponents.push(...result.value.components);
            projectsWithComponents++;
          } else if (result.status === 'rejected') {
            this.logger.warn(`[GroupCache] Project check failed: ${result.reason}`, 'GroupCache');
          }
        }
      }

      this.logger.info(`[GroupCache] Group scan complete!`, 'GroupCache');
      this.logger.info(`[GroupCache] Projects scanned: ${groupProjects.length}`, 'GroupCache');
      this.logger.info(
        `[GroupCache] Projects with components: ${projectsWithComponents}`,
        'GroupCache'
      );
      this.logger.info(
        `[GroupCache] Total components found: ${allComponents.length}`,
        'GroupCache'
      );

      return allComponents;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[GroupCache] Error fetching group ${groupPath}: ${errorMessage}`,
        'GroupCache'
      );
      throw error;
    }
  }

  /**
   * Fetch all projects in a GitLab group (including subgroups)
   *
   * @param gitlabInstance GitLab instance hostname
   * @param groupPath Group path
   * @returns Array of project objects from GitLab API
   */
  async fetchGroupProjects(gitlabInstance: string, groupPath: string): Promise<any[]> {
    const componentService = getComponentService();

    try {
      // Use GitLab Groups API to get all projects in the group
      const groupApiUrl = `https://${gitlabInstance}/api/v4/groups/${encodeURIComponent(
        groupPath
      )}/projects?per_page=100&include_subgroups=true`;

      this.logger.info(`[GroupCache] Fetching group projects from: ${groupApiUrl}`, 'GroupCache');

      // Get token for this GitLab instance
      const token = await componentService.getTokenForInstance(gitlabInstance);
      const fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;

      this.logger.debug(
        `[GroupCache] Using token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`,
        'GroupCache'
      );

      // Use the fetchJson method with authentication options
      const projects = await componentService.fetchJson(groupApiUrl, fetchOptions);

      this.logger.info(
        `[GroupCache] Found ${projects.length} total projects in group ${groupPath}`,
        'GroupCache'
      );

      // Check all projects for components (no pre-filtering)
      this.logger.debug(
        `[GroupCache] Will check all ${projects.length} projects for components (no pre-filtering)`,
        'GroupCache'
      );

      return projects;
    } catch (error) {
      this.logger.error(`[GroupCache] Error fetching group projects: ${error}`, 'GroupCache');
      throw error;
    }
  }
}
