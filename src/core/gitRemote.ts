/**
 * Parse git remote URLs: the GitLab instance and project they point at, or the host when they're not on GitLab.
 */

import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

// A plain hostname with an optional port. Anything else (`gitlab.com@evil.example`) is not trusted as a GitLab host.
const PLAIN_HOST = /^[a-z0-9.-]+(:\d+)?$/i;

/** A repository remote hosted outside GitLab. */
export interface NonGitLabRemote {
  hostname: string;
  projectPath: string;
  type: string;
}

/**
 * Parse GitLab remote URL to extract instance and project path
 */
export function parseGitLabRemoteUrl(remoteUrl: string): { gitlabInstance: string; projectPath: string } | null {
  try {
    // Handle both HTTPS and SSH URLs
    // HTTPS: https://gitlab.com/owner/repo.git
    // SSH: git@gitlab.com:owner/repo.git

    let gitlabInstance: string;
    let projectPath: string;

    if (remoteUrl.startsWith('https://')) {
      const url = new URL(remoteUrl);
      gitlabInstance = url.hostname;
      projectPath = url.pathname.substring(1).replace(/\.git$/, '');
    } else if (remoteUrl.startsWith('git@')) {
      // git@gitlab.com:owner/repo.git
      const match = remoteUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
      if (match) {
        gitlabInstance = match[1];
        projectPath = match[2];
      } else {
        return null;
      }
    } else {
      return null;
    }

    if (!PLAIN_HOST.test(gitlabInstance)) {
      logger.debug(`[ComponentDetector] Ignoring Git remote with an unexpected host: ${gitlabInstance}`, 'ComponentDetector');
      return null;
    }

    // Only return for GitLab instances - this extension is specifically for GitLab
    if (gitlabInstance.includes('gitlab')) {
      return { gitlabInstance, projectPath };
    }

    // For non-GitLab repositories, log but don't use for GitLab variable expansion
    logger.debug(`[ComponentDetector] Detected non-GitLab repository: ${gitlabInstance}. GitLab Component Helper requires a GitLab repository.`, 'ComponentDetector');
    return null;
  } catch (error) {
    logger.debug(`[ComponentDetector] Error parsing Git remote URL: ${error}`, 'ComponentDetector');
    return null;
  }
}

/**
 * Parse and classify a Git remote URL
 */
export function classifyRemote(remoteUrl: string): NonGitLabRemote | null {
    try {
        const repoInfo = parseNonGitLabRemoteUrl(remoteUrl);
        if (!repoInfo) {
            logger.debug(`[ComponentDetector] Failed to parse remote URL: ${remoteUrl}`, 'ComponentDetector');
            return null;
        }

        logger.debug(`[ComponentDetector] Parsed repository info: hostname=${repoInfo.hostname}, projectPath=${repoInfo.projectPath}`, 'ComponentDetector');

        // Check if this is NOT a GitLab repository
        const isGitLab = repoInfo.hostname.toLowerCase().includes('gitlab');
        logger.debug(`[ComponentDetector] Is GitLab repository: ${isGitLab}`, 'ComponentDetector');

        if (!isGitLab) {
            let type = 'Git Repository';
            if (repoInfo.hostname.includes('github')) {
                type = 'GitHub';
            } else if (repoInfo.hostname.includes('bitbucket')) {
                type = 'Bitbucket';
            }

            logger.debug(`[ComponentDetector] Detected non-GitLab repository: ${repoInfo.hostname} (${type})`, 'ComponentDetector');
            return {
                hostname: repoInfo.hostname,
                projectPath: repoInfo.projectPath,
                type: type
            };
        }

        logger.debug(`[ComponentDetector] This is a GitLab repository, not returning non-GitLab info`, 'ComponentDetector');
        return null;
    } catch (error) {
        logger.debug(`[ComponentDetector] Error parsing and classifying repository: ${error}`, 'ComponentDetector');
        return null;
    }
}

/**
 * Parse any Git remote URL to extract hostname and project path (for detection purposes)
 */
function parseNonGitLabRemoteUrl(remoteUrl: string): { hostname: string; projectPath: string } | null {
    try {
        // Handle both HTTPS and SSH URLs
        let hostname: string;
        let projectPath: string;

        if (remoteUrl.startsWith('https://')) {
            const url = new URL(remoteUrl);
            hostname = url.hostname;
            projectPath = url.pathname.substring(1).replace(/\.git$/, '');
        } else if (remoteUrl.startsWith('git@')) {
            // git@github.com:owner/repo.git
            const match = remoteUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
            if (match) {
                hostname = match[1];
                projectPath = match[2];
            } else {
                return null;
            }
        } else {
            return null;
        }

        // Return any valid-looking Git repository info
        if (hostname && projectPath.includes('/')) {
            return { hostname, projectPath };
        }

        return null;
    } catch (error) {
        logger.debug(`[ComponentDetector] Error parsing remote URL for detection: ${error}`, 'ComponentDetector');
        return null;
    }
}
