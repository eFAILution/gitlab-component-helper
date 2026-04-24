/**
 * API-related constants for GitLab instance URLs and API paths.
 */

// GitLab Instances
export const DEFAULT_GITLAB_INSTANCE = 'gitlab.com' as const;

// Default Git Branches
export const DEFAULT_GIT_BRANCH_MAIN = 'main' as const;
export const DEFAULT_GIT_BRANCH_MASTER = 'master' as const;

// Common Git Branches
export const COMMON_GIT_BRANCHES = ['main', 'master', 'develop', 'dev'] as const;

// Default Versions
export const DEFAULT_VERSION_LATEST = 'latest' as const;
export const DEFAULT_VERSION_MAIN = 'main' as const;
export const DEFAULT_VERSION_MASTER = 'master' as const;

// API URLs and Paths
export const GITLAB_API_VERSION = 'v4' as const;
export const GITLAB_API_TAGS_ENDPOINT = 'repository/tags' as const;
export const GITLAB_API_GROUPS_ENDPOINT = 'groups' as const;
export const GITLAB_API_PROJECTS_ENDPOINT = 'projects' as const;

// API Query Parameters
export const API_PARAM_PER_PAGE = 'per_page' as const;
export const API_PARAM_SORT = 'sort' as const;
export const API_PARAM_ORDER_BY = 'order_by' as const;
export const API_PARAM_INCLUDE_SUBGROUPS = 'include_subgroups' as const;

// API Sort Orders
export const API_SORT_DESC = 'desc' as const;
export const API_SORT_UPDATED = 'updated' as const;

// HTTP Status Codes
export const HTTP_STATUS_OK_MIN = 200 as const;
export const HTTP_STATUS_OK_MAX = 300 as const;
export const HTTP_STATUS_RATE_LIMIT = 429 as const;
export const HTTP_STATUS_SERVER_ERROR_MIN = 500 as const;

// HTTP Headers
export const HEADER_USER_AGENT = 'User-Agent' as const;
export const HEADER_PRIVATE_TOKEN = 'PRIVATE-TOKEN' as const;
export const USER_AGENT_VALUE = 'VSCode-GitLabComponentHelper' as const;

// Documentation URLs
export const GITLAB_CI_VARIABLES_DOCS_URL = 'https://docs.gitlab.com/ee/ci/variables/predefined_variables.html' as const;
export const GITLAB_COMPONENTS_DOCS_URL = 'https://docs.gitlab.com/ee/ci/components/' as const;

// URL Protocols
export const PROTOCOL_HTTPS = 'https://' as const;
export const PROTOCOL_HTTP = 'http://' as const;
export const PROTOCOL_SSH_GIT = 'git@' as const;

// GitLab URL Examples (for placeholders)
export const GITLAB_URL_EXAMPLE = 'https://gitlab.com/mygroup/myproject' as const;
export const GITLAB_INSTANCE_EXAMPLE = 'gitlab.com' as const;

// Cache Version
export const CACHE_FORMAT_VERSION = '1.0.0' as const;
