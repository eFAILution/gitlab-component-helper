/**
 * GitLab CI/CD predefined variables and utilities for handling them
 */

export interface GitLabVariable {
  name: string;
  description: string;
  example: string;
  availableIn?: string[];
}

/**
 * Common GitLab CI/CD predefined variables
 * Reference: https://docs.gitlab.com/ee/ci/variables/predefined_variables.html
 */
export const GITLAB_PREDEFINED_VARIABLES: GitLabVariable[] = [
  {
    name: 'CI_API_V4_URL',
    description: 'The GitLab API v4 root URL',
    example: 'https://gitlab.example.com/api/v4'
  },
  {
    name: 'CI_BUILDS_DIR',
    description: 'The top-level directory where builds are executed',
    example: '/builds'
  },
  {
    name: 'CI_COMMIT_BRANCH',
    description: 'The commit branch name. Available in branch pipelines',
    example: 'main'
  },
  {
    name: 'CI_COMMIT_REF_NAME',
    description: 'The branch or tag name for which project is built',
    example: 'main'
  },
  {
    name: 'CI_COMMIT_REF_SLUG',
    description: 'CI_COMMIT_REF_NAME in lowercase, shortened to 63 bytes, and with everything except 0-9 and a-z replaced with -',
    example: 'main'
  },
  {
    name: 'CI_COMMIT_SHA',
    description: 'The commit revision the project is built for',
    example: '1ecfd275763eff1d6b4844ea3168962458c9f27a'
  },
  {
    name: 'CI_COMMIT_SHORT_SHA',
    description: 'The first eight characters of CI_COMMIT_SHA',
    example: '1ecfd275'
  },
  {
    name: 'CI_COMMIT_TAG',
    description: 'The commit tag name. Available only in pipelines for tags',
    example: 'v1.0.0'
  },
  {
    name: 'CI_COMMIT_TITLE',
    description: 'The title of the commit. The full first line of the message',
    example: 'Add new feature'
  },
  {
    name: 'CI_PROJECT_ID',
    description: 'The ID of the project',
    example: '42'
  },
  {
    name: 'CI_PROJECT_NAME',
    description: 'The name of the project',
    example: 'my-project'
  },
  {
    name: 'CI_PROJECT_NAMESPACE',
    description: 'The project namespace (username or group name)',
    example: 'my-group'
  },
  {
    name: 'CI_PROJECT_PATH',
    description: 'The project path with namespace',
    example: 'my-group/my-project'
  },
  {
    name: 'CI_PROJECT_PATH_SLUG',
    description: 'CI_PROJECT_PATH in lowercase, shortened to 63 bytes, and with everything except 0-9 and a-z replaced with -',
    example: 'my-group-my-project'
  },
  {
    name: 'CI_PROJECT_ROOT_NAMESPACE',
    description: 'The root project namespace (username or group name)',
    example: 'my-group'
  },
  {
    name: 'CI_PROJECT_URL',
    description: 'The HTTP(S) address to access project',
    example: 'https://gitlab.example.com/my-group/my-project'
  },
  {
    name: 'CI_REGISTRY',
    description: 'The address of the GitLab Container Registry',
    example: 'registry.gitlab.example.com'
  },
  {
    name: 'CI_REGISTRY_IMAGE',
    description: 'The address of the project\'s Container Registry',
    example: 'registry.gitlab.example.com/my-group/my-project'
  },
  {
    name: 'CI_SERVER_FQDN',
    description: 'The FQDN of the GitLab instance',
    example: 'gitlab.example.com'
  },
  {
    name: 'CI_SERVER_HOST',
    description: 'The host of the GitLab instance URL, without protocol and port',
    example: 'gitlab.example.com'
  },
  {
    name: 'CI_SERVER_NAME',
    description: 'The name of CI/CD server that coordinates jobs',
    example: 'GitLab'
  },
  {
    name: 'CI_SERVER_PORT',
    description: 'The port of the GitLab instance URL, without host and protocol',
    example: '443'
  },
  {
    name: 'CI_SERVER_PROTOCOL',
    description: 'The protocol of the GitLab instance URL, without host and port',
    example: 'https'
  },
  {
    name: 'CI_SERVER_REVISION',
    description: 'GitLab revision that schedules jobs',
    example: '70606bf'
  },
  {
    name: 'CI_SERVER_URL',
    description: 'The base URL of the GitLab instance, including protocol and port',
    example: 'https://gitlab.example.com:8080'
  },
  {
    name: 'CI_SERVER_VERSION',
    description: 'GitLab version that schedules jobs',
    example: '13.12.0'
  },
  {
    name: 'CI_SERVER_VERSION_MAJOR',
    description: 'GitLab major version that schedules jobs',
    example: '13'
  },
  {
    name: 'CI_SERVER_VERSION_MINOR',
    description: 'GitLab minor version that schedules jobs',
    example: '12'
  },
  {
    name: 'CI_SERVER_VERSION_PATCH',
    description: 'GitLab patch version that schedules jobs',
    example: '0'
  }
];

/**
 * Detects GitLab predefined variables in a string
 */
export function detectGitLabVariables(text: string): string[] {
  const variablePattern = /\$([A-Z_][A-Z0-9_]*)/g;
  const matches = text.match(variablePattern);

  if (!matches) {
    return [];
  }

  const variables = matches.map(match => match.substring(1)); // Remove the $
  const predefinedVariableNames = GITLAB_PREDEFINED_VARIABLES.map(v => v.name);

  return variables.filter(variable => predefinedVariableNames.includes(variable));
}

/**
 * Checks if a string contains GitLab predefined variables
 */
export function containsGitLabVariables(text: string): boolean {
  return detectGitLabVariables(text).length > 0;
}

/**
 * Expands GitLab variables in a component URL using context from the current workspace/project
 * This is a best-effort expansion for development purposes
 */
export function expandGitLabVariables(text: string, context?: {
  gitlabInstance?: string;
  projectPath?: string;
  serverUrl?: string;
}): string {
  let expanded = text;

  if (context) {
    // Expand common variables based on context
    if (context.gitlabInstance) {
      expanded = expanded.replace(/\$CI_SERVER_FQDN/g, context.gitlabInstance);
      expanded = expanded.replace(/\$CI_SERVER_HOST/g, context.gitlabInstance);
      expanded = expanded.replace(/\$CI_SERVER_URL/g, context.serverUrl || `https://${context.gitlabInstance}`);
    }

    if (context.projectPath) {
      expanded = expanded.replace(/\$CI_PROJECT_PATH/g, context.projectPath);

      // Extract namespace and project name
      const parts = context.projectPath.split('/');
      if (parts.length >= 2) {
        const namespace = parts.slice(0, -1).join('/');
        const projectName = parts[parts.length - 1];

        expanded = expanded.replace(/\$CI_PROJECT_NAMESPACE/g, namespace);
        expanded = expanded.replace(/\$CI_PROJECT_NAME/g, projectName);
        expanded = expanded.replace(/\$CI_PROJECT_ROOT_NAMESPACE/g, parts[0]);
      }
    }
  }

  return expanded;
}

/**
 * Expands GitLab variables specifically in component URLs, ensuring proper URL formatting
 */
export function expandComponentUrl(componentUrl: string, context?: {
  gitlabInstance?: string;
  projectPath?: string;
  serverUrl?: string;
  commitSha?: string; // Optionally provide a commit SHA for expansion
}): string {
  let expanded = componentUrl;

  if (context) {
    // Handle URL expansion carefully to maintain proper URL structure
    if (context.gitlabInstance) {
      // For component URLs that start with $CI_SERVER_FQDN, we need to ensure https:// is added
      if (expanded.startsWith('$CI_SERVER_FQDN/')) {
        expanded = expanded.replace(/^\$CI_SERVER_FQDN\//, `https://${context.gitlabInstance}/`);
      } else {
        // For other cases, do normal replacement
        expanded = expanded.replace(/\$CI_SERVER_FQDN/g, context.gitlabInstance);
        expanded = expanded.replace(/\$CI_SERVER_HOST/g, context.gitlabInstance);
        expanded = expanded.replace(/\$CI_SERVER_URL/g, context.serverUrl || `https://${context.gitlabInstance}`);
      }
    }

    if (context.projectPath) {
      expanded = expanded.replace(/\$CI_PROJECT_PATH/g, context.projectPath);

      // Extract namespace and project name
      const parts = context.projectPath.split('/');
      if (parts.length >= 2) {
        const namespace = parts.slice(0, -1).join('/');
        const projectName = parts[parts.length - 1];

        expanded = expanded.replace(/\$CI_PROJECT_NAMESPACE/g, namespace);
        expanded = expanded.replace(/\$CI_PROJECT_NAME/g, projectName);
        expanded = expanded.replace(/\$CI_PROJECT_ROOT_NAMESPACE/g, parts[0]);
      }
    }

    // Support $CI_COMMIT_SHA expansion
    if (expanded.includes('$CI_COMMIT_SHA')) {
      // Use context.commitSha if provided, otherwise fallback to a placeholder or branch name
      const shaValue = context.commitSha || '[current-branch-or-sha]';
      expanded = expanded.replace(/\$CI_COMMIT_SHA/g, shaValue);
    }
  }

  // Ensure the URL starts with https:// if it doesn't already have a protocol
  if (!expanded.match(/^https?:\/\//)) {
    // If it looks like a domain/path pattern, add https://
    if (expanded.match(/^[a-zA-Z0-9.-]+\//)) {
      expanded = `https://${expanded}`;
    }
  }

  return expanded;
}

/**
 * Validates that a component URL with variables can be properly resolved
 */
export function validateComponentUrlWithVariables(url: string): {
  isValid: boolean;
  unresolvedVariables: string[];
  suggestions: string[];
} {
  const variables = detectGitLabVariables(url);
  const unresolvedVariables: string[] = [];
  const suggestions: string[] = [];

  for (const variable of variables) {
    const varInfo = GITLAB_PREDEFINED_VARIABLES.find(v => v.name === variable);
    if (varInfo) {
      // Check if this is a variable that can be reasonably resolved in development
      if (['CI_SERVER_FQDN', 'CI_SERVER_HOST', 'CI_SERVER_URL', 'CI_PROJECT_PATH', 'CI_PROJECT_NAMESPACE', 'CI_PROJECT_NAME'].includes(variable)) {
        suggestions.push(`Consider setting ${variable} context or using a literal value for development`);
      } else {
        unresolvedVariables.push(variable);
        suggestions.push(`${variable}: ${varInfo.description} (example: ${varInfo.example})`);
      }
    } else {
      unresolvedVariables.push(variable);
      suggestions.push(`Unknown variable: ${variable}`);
    }
  }

  return {
    isValid: unresolvedVariables.length === 0,
    unresolvedVariables,
    suggestions
  };
}

/**
 * Gets variable information for completion/documentation
 */
export function getVariableInfo(variableName: string): GitLabVariable | undefined {
  return GITLAB_PREDEFINED_VARIABLES.find(v => v.name === variableName);
}

/**
 * Provides completion suggestions for GitLab variables
 */
export function getVariableCompletions(prefix: string = ''): GitLabVariable[] {
  if (!prefix) {
    return GITLAB_PREDEFINED_VARIABLES;
  }

  const upperPrefix = prefix.toUpperCase();
  return GITLAB_PREDEFINED_VARIABLES.filter(v =>
    v.name.includes(upperPrefix) || v.description.toLowerCase().includes(prefix.toLowerCase())
  );
}
