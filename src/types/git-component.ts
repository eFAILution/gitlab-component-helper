/**
 * Generic Git Component Types
 *
 * This file defines platform-agnostic types for Git-based CI/CD components
 * that can work with GitLab, GitHub Actions, Bitbucket Pipelines, etc.
 */

export interface GitComponentParameter {
  name: string;
  description: string;
  required: boolean;
  type: string;
  default?: any;
}

export interface GitComponentSource {
  platform: 'gitlab' | 'github' | 'bitbucket' | 'local' | string;
  instance: string; // e.g., 'gitlab.com', 'github.com', 'bitbucket.org'
  path: string; // e.g., 'group/project' or 'owner/repo'
  type?: 'project' | 'group' | 'organization' | 'user';
}

export interface GitComponent {
  name: string;
  description: string;
  parameters: GitComponentParameter[];
  source: GitComponentSource;
  version: string;
  url: string;
  availableVersions?: string[];
  readme?: string;
  metadata?: {
    [key: string]: any; // Platform-specific metadata
  };
}

export interface GitComponentCache {
  components: GitComponent[];
  lastRefreshTime: number;
  sourceVersionCache: [string, string[]][]; // key: `${platform}:${instance}|${path}`
  version: string; // Cache format version for migrations
}

/**
 * Platform-specific adapters can extend this interface
 */
export interface GitPlatformAdapter {
  platform: string;

  /**
   * Fetch components from a project/repository
   */
  fetchProjectComponents(instance: string, projectPath: string, version?: string): Promise<GitComponent[]>;

  /**
   * Fetch available versions (tags/branches) for a project
   */
  fetchProjectVersions(instance: string, projectPath: string): Promise<string[]>;

  /**
   * Test if an instance URL belongs to this platform
   */
  supportsInstance(instance: string): boolean;

  /**
   * Get rate limiting configuration for this platform instance
   */
  getRateLimitConfig(instance: string): { maxTokens: number; refillRate: number };
}
