import { Logger } from '../../utils/logger';

export interface ParsedComponentUrl {
  gitlabInstance: string;
  path: string;
  name: string;
  version?: string;
}

/**
 * Utility for parsing GitLab component URLs
 */
export class UrlParser {
  private logger = Logger.getInstance();

  /**
   * Parse a custom GitLab component URL
   * Handles URLs like: https://gitlab.com/components/proj/proj-template@1.0.0
   * @param url The GitLab component URL to parse
   * @returns Parsed URL components or null if invalid
   */
  public parseCustomComponentUrl(url: string): ParsedComponentUrl | null {
    try {
      const urlObj = new URL(url);
      const gitlabInstance = urlObj.hostname;

      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length < 2) {
        return null;
      }

      // The last part contains the component name and optional version in explicit URLs.
      const lastPart = pathParts[pathParts.length - 1];
      let name: string;
      let version: string | undefined;
      let path: string;

      if (lastPart.includes('@')) {
        // Split component name and version
        [name, version] = lastPart.split('@');
        path = pathParts.slice(0, pathParts.length - 1).join('/');
      } else if (pathParts.length >= 3) {
        name = lastPart;
        path = pathParts.slice(0, pathParts.length - 1).join('/');
      } else {
        // Project-only shorthand URL: default to main component on that project.
        name = 'main';
        version = 'main';
        path = pathParts.join('/');
      }

      this.logger.debug(
        `Parsed component URL: ${gitlabInstance}/${path}/${name}${version ? `@${version}` : ''}`,
        'UrlParser'
      );

      return { gitlabInstance, path, name, version };
    } catch (e) {
      this.logger.error(`Error parsing component URL: ${e}`, 'UrlParser');
      return null;
    }
  }

  /**
   * Clean GitLab instance URL by removing protocol prefix
   * @param gitlabInstance The GitLab instance URL (may contain protocol)
   * @returns Clean hostname without protocol
   */
  public cleanGitLabInstance(gitlabInstance: string): string {
    let clean = gitlabInstance;
    if (clean.startsWith('https://')) {
      clean = clean.replace('https://', '');
    }
    if (clean.startsWith('http://')) {
      clean = clean.replace('http://', '');
    }
    return clean;
  }
}
