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
let backgroundUpdateInProgress = false;

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

  public async getTokenForProject(
    gitlabInstance: string,
    projectPath: string
  ): Promise<string | undefined> {
    return this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
  }

  public async setTokenForProject(
    gitlabInstance: string,
    projectPath: string,
    token: string
  ): Promise<void> {
    return this.tokenManager.setTokenForProject(gitlabInstance, projectPath, token);
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
  public async fetchProjectVersions(
    gitlabInstance: string,
    projectPath: string
  ): Promise<string[]> {
    return this.versionManager.fetchProjectVersions(gitlabInstance, projectPath);
  }

  public async fetchProjectTags(gitlabInstance: string, projectPath: string) {
    return this.versionManager.fetchProjectTags(gitlabInstance, projectPath);
  }

  // Catalog data delegation
  public async fetchCatalogData(
    gitlabInstance: string,
    projectPath: string,
    forceRefresh: boolean = false,
    version?: string,
    context?: vscode.ExtensionContext
  ): Promise<any> {
    return this.componentFetcher.fetchCatalogData(
      gitlabInstance,
      projectPath,
      forceRefresh,
      version,
      context
    );
  }

  // HTTP client delegation
  public async fetchJson(url: string, options?: any): Promise<any> {
    return this.httpClient.fetchJson(url, options);
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

  // Legacy methods for backward compatibility
  private async fetchFromGitLab(): Promise<Component[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const gitlabUrl = config.get<string>('gitlabUrl', '');
    const projectId = config.get<string>('gitlabProjectId', '');
    const token = config.get<string>('gitlabToken', '');
    const filePath = config.get<string>('gitlabComponentsFilePath', 'components.json');

    if (!gitlabUrl || !projectId || !token) {
      throw new Error('GitLab URL, project ID, or token not configured');
    }

    const apiUrl = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(
      projectId
    )}/repository/files/${encodeURIComponent(filePath)}/raw`;

    try {
      const components = await this.httpClient.fetchJson(apiUrl, {
        headers: {
          'PRIVATE-TOKEN': token
        }
      });

      this.logger.info(`Successfully fetched ${components.length} components from GitLab`);
      return components;
    } catch (error) {
      this.logger.error(`GitLab fetch failed: ${error}`);
      throw error;
    }
  }

  private async fetchFromUrl(): Promise<Component[]> {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const url = config.get<string>('componentsUrl', '');

    if (!url) {
      throw new Error('Components URL not configured');
    }

    try {
      const components = await this.httpClient.fetchJson(url);
      this.logger.info(`Successfully fetched ${components.length} components from URL`);
      return components;
    } catch (error) {
      this.logger.error(`URL fetch failed: ${error}`);
      throw error;
    }
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
