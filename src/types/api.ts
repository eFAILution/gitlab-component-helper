/**
 * GitLab API response type definitions
 */

/**
 * GitLab Project information returned from /api/v4/projects/:id
 */
export interface GitLabProjectInfo {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description: string;
  default_branch: string;
  web_url: string;
  created_at: string;
  last_activity_at: string;
  namespace: {
    id: number;
    name: string;
    path: string;
    kind: string;
  };
  topics?: string[];
  visibility: 'private' | 'internal' | 'public';
}

/**
 * GitLab repository tree item returned from /api/v4/projects/:id/repository/tree
 */
export interface GitLabTreeItem {
  id: string;
  name: string;
  type: 'tree' | 'blob';
  path: string;
  mode: string;
}

/**
 * GitLab tag information returned from /api/v4/projects/:id/repository/tags
 */
export interface GitLabTag {
  name: string;
  message?: string;
  target: string;
  commit: {
    id: string;
    short_id: string;
    title: string;
    author_name: string;
    author_email: string;
    authored_date: string;
    committer_name: string;
    committer_email: string;
    committed_date: string;
    created_at: string;
    message: string;
    parent_ids: string[];
    web_url: string;
  };
  release?: {
    tag_name: string;
    description: string;
  };
  protected: boolean;
}

/**
 * GitLab branch information returned from /api/v4/projects/:id/repository/branches
 */
export interface GitLabBranch {
  name: string;
  merged: boolean;
  protected: boolean;
  default: boolean;
  developers_can_push: boolean;
  developers_can_merge: boolean;
  can_push: boolean;
  commit: {
    id: string;
    short_id: string;
    title: string;
    author_name: string;
    author_email: string;
    authored_date: string;
    committer_name: string;
    committer_email: string;
    committed_date: string;
    created_at: string;
    message: string;
    parent_ids: string[];
    web_url: string;
  };
  web_url: string;
}

/**
 * GitLab file content response from /api/v4/projects/:id/repository/files/:file_path/raw
 */
export interface GitLabFileContent {
  file_name: string;
  file_path: string;
  size: number;
  encoding: string;
  content_sha256: string;
  ref: string;
  blob_id: string;
  commit_id: string;
  last_commit_id: string;
}

/**
 * Component source configuration from settings
 */
export interface ComponentSource {
  name: string;
  path: string;
  gitlabInstance?: string;
  type?: 'project' | 'group';
}

/**
 * Component variable definition (used in component specs)
 */
export interface ComponentVariable {
  name: string;
  description: string;
  required: boolean;
  type: string;
  default?: string;
}

/**
 * Template fetch result with extracted metadata
 */
export interface TemplateFetchResult {
  content: string;
  parameters: ComponentVariable[];
}

/**
 * Template content fetch result with validation
 */
export interface TemplateContentResult {
  content: string;
  extractedVariables: ComponentVariable[];
  extractedDescription?: string;
  isValidComponent: boolean;
}

/**
 * Parsed component URL structure
 */
export interface ParsedComponentUrl {
  gitlabInstance: string;
  path: string;
  name: string;
  version?: string;
}

/**
 * HTTP request options for API calls
 */
export interface HttpRequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Parallel request configuration
 */
export interface ParallelRequest {
  url: string;
  options?: HttpRequestOptions;
}

/**
 * Result of a parallel request execution
 */
export interface ParallelRequestResult<T> {
  result?: T;
  error?: Error;
  url: string;
}

/**
 * Cache statistics for monitoring and debugging
 */
export interface CacheStats {
  catalogCacheSize: number;
  componentCacheSize: number;
  sourceCacheSize: number;
  catalogKeys: string[];
  componentKeys: string[];
  sourceKeys: string[];
}
