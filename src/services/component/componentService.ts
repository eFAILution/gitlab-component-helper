import * as vscode from 'vscode';
import { Component } from '../../providers/componentDetector';
import { HttpClient } from '../../utils/httpClient';
import { Logger } from '../../utils/logger';
import { getPerformanceMonitor } from '../../utils/performanceMonitor';
import { TokenManager } from './tokenManager';
import { UrlParser } from './urlParser';
import { VersionManager } from './versionManager';
import { ComponentFetcher } from './componentFetcher';

// Service interface for component sources
export interface ComponentSource {
  getComponents(): Promise<Component[]>;
  getComponent(name: string): Promise<Component | undefined>;
}

// Enhanced cache with Map-based caching by source type
interface CacheEntry {
  components: Component[];
  timestamp: number;
}

const sourceCache = new Map<string, CacheEntry>();

/**
 * Main component service that orchestrates fetching and managing GitLab components
 * Delegates to specialized services for specific functionality
 */
export class ComponentService implements ComponentSource {
  public httpClient = new HttpClient();
  private logger = Logger.getInstance();
  private performanceMonitor = getPerformanceMonitor();
  private componentCache = new Map<string, Component>();

  // Specialized services
  private tokenManager: TokenManager;
  private urlParser: UrlParser;
  private versionManager: VersionManager;
  private componentFetcher: ComponentFetcher;

  constructor() {
    this.tokenManager = new TokenManager();
    this.urlParser = new UrlParser();
    this.versionManager = new VersionManager(this.httpClient, this.tokenManager);
    this.componentFetcher = new ComponentFetcher(
      this.httpClient,
      this.tokenManager,
      this.urlParser
    );
  }

  // Token management delegation
  public setSecretStorage(secretStorage: vscode.SecretStorage): void {
    this.tokenManager.setSecretStorage(secretStorage);
  }

  public async getTokenForProject(gitlabInstance: string): Promise<string | undefined> {
    return this.tokenManager.getTokenForProject(gitlabInstance);
  }

  public async setTokenForProject(gitlabInstance: string, token: string): Promise<void> {
    return this.tokenManager.setTokenForProject(gitlabInstance, token);
  }

  public async getTokenForInstance(gitlabInstance: string): Promise<string | undefined> {
    return this.tokenManager.getTokenForInstance(gitlabInstance);
  }

  // Component retrieval
  async getComponents(): Promise<Component[]> {
    return this.getLocalComponents();
  }

  async getComponent(name: string): Promise<Component | undefined> {
    const components = await this.getComponents();
    return components.find((c) => c.name === name);
  }

  // Component fetching delegation
  public async getComponentFromUrl(
    url: string,
    context?: vscode.ExtensionContext
  ): Promise<Component | null> {
    try {
      const component = await this.componentFetcher.fetchComponentMetadata(url, context);
      if (component) {
        // Parse the URL for context info
        const parsed = this.urlParser.parseCustomComponentUrl(url);
        if (parsed) {
          component.context = {
            gitlabInstance: parsed.gitlabInstance,
            path: parsed.path
          };
        }
      }
      return component;
    } catch (error) {
      this.logger.error(`Error fetching component from URL: ${error}`);
      throw error;
    }
  }

  // URL parsing delegation
  public parseCustomComponentUrl(url: string) {
    return this.urlParser.parseCustomComponentUrl(url);
  }

  // Version management delegation
  /**
   * Fetch all tags/versions for a GitLab project.
   *
   * @param gitlabInstance The GitLab instance hostname.
   * @param projectPath The project path.
   * @returns Array of version strings (tags and important branches).
   */
  public async fetchProjectVersions(
    gitlabInstance: string,
    projectPath: string
  ): Promise<string[]> {
    return this.versionManager.fetchProjectVersions(gitlabInstance, projectPath);
  }

  public async fetchProjectTags(gitlabInstance: string, projectPath: string) {
    return this.versionManager.fetchProjectTags(gitlabInstance, projectPath);
  }

  /**
   * Fetch a project's default branch name (e.g. `main`) from its project info.
   *
   * @param gitlabInstance The GitLab instance hostname.
   * @param projectPath The project path; URL-encoded internally.
   * @returns The default branch name, or null if it can't be resolved (network error, no access).
   */
  public async fetchProjectDefaultBranch(gitlabInstance: string, projectPath: string) {
    return this.versionManager.fetchProjectDefaultBranch(gitlabInstance, projectPath);
  }

  /**
   * Resolve the HEAD commit SHA of a branch, used to detect when a branch ref has moved.
   *
   * @param gitlabInstance The GitLab instance hostname (e.g. `gitlab.com`).
   * @param projectPath The project path (e.g. `my-group/shared-ci`).
   * @param branch The branch name to resolve.
   * @returns The commit SHA, or null if the branch can't be resolved (network error, missing branch, no access).
   */
  public async resolveBranchSha(
    gitlabInstance: string,
    projectPath: string,
    branch: string
  ): Promise<string | null> {
    return this.versionManager.resolveBranchSha(gitlabInstance, projectPath, branch);
  }

  /**
   * Authoritatively determine whether a ref is a tag (taken as fixed, skips freshness checks) versus a branch.
   *
   * @param gitlabInstance The GitLab instance hostname (e.g. `gitlab.com`).
   * @param projectPath The project path (e.g. `my-group/shared-ci`).
   * @param ref The ref name to classify.
   * @returns `true` if a tag, `false` if definitively not a tag, or `null` when it can't be determined.
   */
  public async isRefATag(
    gitlabInstance: string,
    projectPath: string,
    ref: string
  ): Promise<boolean | null> {
    return this.versionManager.isRefATag(gitlabInstance, projectPath, ref);
  }

  // Catalog data delegation
  public async fetchCatalogData(
    gitlabInstance: string,
    projectPath: string,
    forceRefresh: boolean = false,
    version?: string,
    context?: vscode.ExtensionContext
  ): Promise<Awaited<ReturnType<ComponentFetcher['fetchCatalogData']>>> {
    return this.componentFetcher.fetchCatalogData(
      gitlabInstance,
      projectPath,
      forceRefresh,
      version,
      context
    );
  }

  public async fetchLinkedSecurityPolicyProject(
    gitlabInstance: string,
    projectPath: string,
    token: string
  ): Promise<string | undefined> {
    const cleanGitlabInstance = this.urlParser.cleanGitLabInstance(gitlabInstance);
    const apiBaseUrl = `https://${cleanGitlabInstance}/api/graphql`;
    
    const headers: Record<string, string> = {};
    if (token) {
      headers['PRIVATE-TOKEN'] = token;
    }

    try {
      // First try project level
      const projectQuery = `
        query getPolicyProject($fullPath: ID!) {
          project(fullPath: $fullPath) {
            securityPolicyProject {
              fullPath
            }
          }
        }
      `;

      let response = await this.httpClient.fetchGraphQL(
        apiBaseUrl, 
        projectQuery, 
        { fullPath: projectPath },
        { headers }
      );

      let policyProject = response?.data?.project?.securityPolicyProject?.fullPath;
      if (policyProject) {
        this.logger.debug(`[ComponentService] Found direct security policy project: ${policyProject}`);
        return policyProject;
      }

      // If not found, walk up the namespace (groups) to find inherited policies
      const pathSegments = projectPath.split('/');
      pathSegments.pop(); // Remove the project name to get the parent group

      const groupQuery = `
        query getPolicyGroup($fullPath: ID!) {
          group(fullPath: $fullPath) {
            securityPolicyProject {
              fullPath
            }
          }
        }
      `;

      while (pathSegments.length > 0) {
        const groupPath = pathSegments.join('/');
        this.logger.debug(`[ComponentService] Checking parent group for policy project: ${groupPath}`);
        
        response = await this.httpClient.fetchGraphQL(
          apiBaseUrl, 
          groupQuery, 
          { fullPath: groupPath },
          { headers }
        );

        policyProject = response?.data?.group?.securityPolicyProject?.fullPath;
        if (policyProject) {
          this.logger.debug(`[ComponentService] Found inherited security policy project from ${groupPath}: ${policyProject}`);
          return policyProject;
        }

        pathSegments.pop();
      }

      this.logger.debug(`[ComponentService] No security policy project found for ${projectPath} or its parent groups`);
      return undefined;
    } catch (error) {
      this.logger.error(`Error fetching linked security policy project: ${error}`);
      return undefined;
    }
  }

  public async fetchPipelineExecutionPolicies(
    gitlabInstance: string,
    projectPath: string,
    token: string
  ): Promise<string[]> {
    const cleanGitlabInstance = this.urlParser.cleanGitLabInstance(gitlabInstance);
    const apiBaseUrl = `https://${cleanGitlabInstance}/api/graphql`;
    
    const query = `
      query getPolicies($fullPath: ID!) {
        project(fullPath: $fullPath) {
          pipelineExecutionPolicies {
            nodes {
              name
            }
          }
        }
      }
    `;

    const headers: Record<string, string> = {};
    if (token) {
      headers['PRIVATE-TOKEN'] = token;
    }

    try {
      const response = await this.httpClient.fetchGraphQL(
        apiBaseUrl, 
        query, 
        { fullPath: projectPath },
        { headers }
      );

      const nodes = response?.data?.project?.pipelineExecutionPolicies?.nodes || [];
      return nodes.map((node: any) => node.name).filter(Boolean);
    } catch (error) {
      this.logger.error(`Error fetching pipeline execution policies: ${error}`);
      return [];
    }
  }

  // HTTP client delegation
  public async fetchJson<T = unknown>(url: string, options?: { headers?: Record<string, string> }): Promise<T> {
    return this.httpClient.fetchJson<T>(url, options);
  }

  public async fetchRawFile(
    gitlabInstance: string,
    projectPath: string,
    filePath: string,
    ref: string = 'main'
  ): Promise<string> {
    const cleanGitlabInstance = this.urlParser.cleanGitLabInstance(gitlabInstance);
    const apiBaseUrl = `https://${cleanGitlabInstance}/api/v4`;
    const url = `${apiBaseUrl}/projects/${encodeURIComponent(
      projectPath
    )}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${ref}`;

    const token = await this.getTokenForProject(cleanGitlabInstance);
    const headers = token ? { 'PRIVATE-TOKEN': token } : undefined;

    return this.httpClient.fetchText(url, { headers });
  }

  private async fetchText(url: string): Promise<string> {
    return this.httpClient.fetchText(url);
  }

  // Local mock components (for fallback/testing)
  private getLocalComponents(): Component[] {
    return [
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
        ]
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
        ]
      }
    ];
  }

  // Cache management
  public updateCache(): void {
    this.logger.info('[ComponentService] Updating cache - forcing refresh of all data');
    this.componentFetcher.clearCache();
    this.componentCache.clear();
    sourceCache.clear();
    this.logger.info(
      '[ComponentService] Cache update completed - all cached data will be refreshed on next request'
    );
  }

  public resetCache(): void {
    this.logger.info('[ComponentService] Resetting cache - clearing all cached data');
    this.componentFetcher.clearCache();
    this.componentCache.clear();
    sourceCache.clear();
    this.logger.info('[ComponentService] Cache reset completed - all cached data cleared');
  }

  public getCacheStats(): {
    catalogCacheSize: number;
    componentCacheSize: number;
    sourceCacheSize: number;
    catalogKeys: string[];
    componentKeys: string[];
    sourceKeys: string[];
  } {
    const catalogStats = this.componentFetcher.getCatalogCacheStats();
    return {
      catalogCacheSize: catalogStats.size,
      componentCacheSize: this.componentCache.size,
      sourceCacheSize: sourceCache.size,
      catalogKeys: catalogStats.keys,
      componentKeys: Array.from(this.componentCache.keys()),
      sourceKeys: Array.from(sourceCache.keys())
    };
  }
}

// Singleton instance
let serviceInstance: ComponentService | null = null;

export function getComponentService(): ComponentService {
  if (!serviceInstance) {
    serviceInstance = new ComponentService();
  }
  return serviceInstance;
}
