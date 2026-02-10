import * as vscode from 'vscode';
import { getComponentService } from '../component';
import { Logger } from '../../utils/logger';
import { CachedComponent } from '../../types/cache';
import { SOURCE_COMPONENTS_PREFIX } from '../../constants/cache';

/**
 * ProjectCache - Handles fetching components from individual GitLab projects
 *
 * Responsibilities:
 * - Fetch catalog data from a project
 * - Transform catalog data to CachedComponent format
 * - Handle project-specific errors
 */
export class ProjectCache {
  private logger = Logger.getInstance();

  /**
   * Fetch components from a specific GitLab project
   *
   * @param gitlabInstance GitLab instance hostname
   * @param projectPath Full project path (e.g., 'group/project')
   * @param sourceName Display name for this source
   * @returns Array of cached components
   */
  async fetchComponentsFromProject(
    gitlabInstance: string,
    projectPath: string,
    sourceName: string
  ): Promise<CachedComponent[]> {
    const componentService = getComponentService();

    try {
      const catalogData = await componentService.fetchCatalogData(
        gitlabInstance,
        projectPath,
        false
      );

      if (catalogData && catalogData.components) {
        this.logger.info(
          `[ProjectCache] Found ${catalogData.components.length} components in ${sourceName}`,
          'ProjectCache'
        );

        const sourceComponents: CachedComponent[] = catalogData.components.map((c: any) => {
          const componentUrl = `https://${gitlabInstance}/${projectPath}/${c.name}@${
            c.latest_version || 'main'
          }`;

          return {
            name: c.name,
            description: c.description || `Component from ${sourceName}`,
            parameters: (c.variables || []).map((v: any) => ({
              name: v.name,
              description: v.description || `Parameter: ${v.name}`,
              required: v.required || false,
              type: v.type || 'string',
              default: v.default,
            })),
            source: sourceName,
            sourcePath: projectPath,
            gitlabInstance: gitlabInstance,
            version: c.latest_version || 'main',
            url: componentUrl,
          };
        });

        this.logger.debug(
          `[ProjectCache] Processed ${sourceComponents.length} components from ${sourceName}`,
          'ProjectCache'
        );
        return sourceComponents;
      } else {
        this.logger.info(`[ProjectCache] No components found in ${sourceName}`, 'ProjectCache');
        return [];
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[ProjectCache] Error fetching project ${projectPath}: ${errorMessage}`,
        'ProjectCache'
      );
      throw error;
    }
  }

  /**
   * Fetch a specific version of a component from a project
   *
   * @param componentName Component name
   * @param sourcePath Project path
   * @param gitlabInstance GitLab instance hostname
   * @param version Version to fetch
   * @returns Cached component or null if not found
   */
  async fetchSpecificVersion(
    componentName: string,
    sourcePath: string,
    gitlabInstance: string,
    version: string
  ): Promise<CachedComponent | null> {
    try {
      this.logger.info(
        `[ProjectCache] Fetching specific version ${version} of ${componentName} from ${sourcePath}`,
        'ProjectCache'
      );

      const componentService = getComponentService();

      // First, validate that the version exists by fetching project tags
      this.logger.debug(`[ProjectCache] Validating version ${version} exists...`, 'ProjectCache');
      const projectTags = await componentService.fetchProjectTags(gitlabInstance, sourcePath);
      const availableVersions = ['main', 'master', ...projectTags.map(tag => tag.name)];

      if (!availableVersions.includes(version)) {
        this.logger.warn(
          `[ProjectCache] Version ${version} does not exist. Available versions: ${availableVersions
            .slice(0, 10)
            .join(', ')}`,
          'ProjectCache'
        );
        return null;
      }

      // Fetch the component data for this specific version
      const catalogData = await componentService.fetchCatalogData(
        gitlabInstance,
        sourcePath,
        true,
        version
      );

      if (!catalogData || !catalogData.components || catalogData.components.length === 0) {
        this.logger.warn(
          `[ProjectCache] No component data found for version ${version}`,
          'ProjectCache'
        );
        return null;
      }

      // Find the matching component in the catalog
      const catalogComponent = catalogData.components.find((c: any) => c.name === componentName);
      if (!catalogComponent) {
        this.logger.warn(
          `[ProjectCache] Component ${componentName} not found in version ${version}`,
          'ProjectCache'
        );
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
          default: v.default,
        })),
        source: `${SOURCE_COMPONENTS_PREFIX} ${sourcePath}`,
        sourcePath: sourcePath,
        gitlabInstance: gitlabInstance,
        version: version,
        url: `https://${gitlabInstance}/${sourcePath}/${catalogComponent.name}@${version}`,
      };

      this.logger.info(
        `[ProjectCache] Successfully fetched version ${version} of ${componentName}`,
        'ProjectCache'
      );
      return cachedComponent;
    } catch (error) {
      this.logger.error(`[ProjectCache] Error fetching specific version: ${error}`, 'ProjectCache');
      return null;
    }
  }
}
